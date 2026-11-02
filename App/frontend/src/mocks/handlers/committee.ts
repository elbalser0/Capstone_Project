import { http, HttpResponse } from 'msw';
import type {
  CreateCycleInput,
  CreateTemplateInput,
  CycleKpis,
  DueByRank,
  DueProfessor,
  DueRemindersInput,
  FacultyStatus,
  ForwardInput,
  ForwardResult,
  MatchingRow,
  OutstandingObservations,
  SurveyResponse,
  UnmatchedFaculty,
  UpdateCycleInput,
} from '../../api/types';
import { alertFor, checkEligibility, dueStatus, dueTermId, eligibleObservers, isEligible, isLocked, isSignedOff, lastCompletedTermId, termOrder } from '../rules';
import type { EvalCycleRow, SignupRow } from '../schema';
import {
  byRank,
  committeeMember,
  contact,
  currentCycleRow,
  cycle,
  cycleOr404,
  db,
  department,
  fail,
  found,
  newId,
  notify,
  now,
  observationOfSignup,
  person,
  professor,
  section,
  signup,
  signupRow,
  templateVersion,
  term,
  today,
} from '../store';

const RANK_ORDER = { assistant: 0, associate: 1, full: 2 };

const signupsOf = (c: EvalCycleRow) => db.sign_up.filter((s) => s.cycle_id === c.cycle_id);

const STATUS_ORDER = { OVERDUE: 0, DUE: 1, NOT_DUE: 2 };

/** Every active professor's status for a term: the cycle's eval_due list if it has one, else the rules. */
function facultyRows(termId: string, c: EvalCycleRow | undefined): FacultyStatus[] {
  const order = termOrder(db);
  const before = order[order.indexOf(termId) - 1];
  return db.professor
    .filter((p) => p.is_active)
    .map((p): FacultyStatus => {
      const due = c && db.eval_due.find((d) => d.cycle_id === c.cycle_id && d.netid === p.netid);
      const status = c ? (due ? (due.due_status === 'overdue' ? 'OVERDUE' : 'DUE') : 'NOT_DUE') : dueStatus(db, p, termId);
      const last = before ? lastCompletedTermId(db, p.netid, before) : null;
      return {
        professor: contact(p.netid),
        department: department(p.dept_id),
        dueStatus: status,
        lastObservedTerm: last ? term(last) : null,
        dueTerm: term(dueTermId(db, p, termId, last)),
      };
    })
    .sort((a, b) => STATUS_ORDER[a.dueStatus] - STATUS_ORDER[b.dueStatus] || a.professor.lastName.localeCompare(b.professor.lastName));
}

const matchingRow = (s: SignupRow): MatchingRow => {
  const alert = db.alert.filter((a) => a.signup_id === s.signup_id).sort((a, b) => b.created_date.localeCompare(a.created_date))[0];
  const matches = db.observer_match.filter((m) => m.signup_id === s.signup_id);
  return {
    signupId: s.signup_id,
    ranAt: matches.reduce<string | null>((latest, m) => (!latest || m.generated_date > latest ? m.generated_date : latest), null),
    observee: person(s.observee_netid),
    section: section(s.section_id),
    candidates: matches.map((m) => person(m.observer_netid)),
    alert: alert ? { alertId: alert.alert_id, alertType: alert.alert_type, createdDate: alert.created_date } : null,
  };
};

const checkDeadlines = (signupDeadline: string, observationDeadline: string, feedbackDeadline: string) => {
  if (!(signupDeadline < observationDeadline && observationDeadline < feedbackDeadline)) {
    throw fail(400, 'INVALID_DEADLINES', 'Deadlines must go sign-up, then observation, then feedback.');
  }
};

const currentCycleOr404 = () => found(currentCycleRow(), 'No cycle has started yet.', 'NO_CYCLE');

export const committeeHandlers = [
  // ---------- Cycle ----------

  http.post('/api/cycles', async ({ request }) => {
    const me = committeeMember(request);
    const input = (await request.json()) as CreateCycleInput;
    if (!db.term.some((t) => t.term_id === input.termId)) return fail(400, 'INVALID_TERM', 'Unknown term.');
    if (db.eval_cycle.some((c) => c.term_id === input.termId)) return fail(409, 'CYCLE_EXISTS', 'A cycle already exists for this term.');
    checkDeadlines(input.signupDeadline, input.observationDeadline, input.feedbackDeadline);
    const row: EvalCycleRow = {
      cycle_id: `C-${input.termId}`, term_id: input.termId, started_by: me.netid, start_date: today(),
      signup_deadline: input.signupDeadline, observation_deadline: input.observationDeadline, feedback_deadline: input.feedbackDeadline,
    };
    db.eval_cycle.push(row);
    for (const p of db.professor.filter((x) => x.is_active)) {
      const status = dueStatus(db, p, input.termId);
      if (status !== 'NOT_DUE') db.eval_due.push({ cycle_id: row.cycle_id, netid: p.netid, due_status: status === 'DUE' ? 'due' : 'overdue' });
    }
    return HttpResponse.json(cycle(row), { status: 201 });
  }),

  http.patch('/api/cycles/:cycleId', async ({ request, params }) => {
    committeeMember(request);
    const c = cycleOr404(params.cycleId);
    const input = (await request.json()) as UpdateCycleInput;
    const next = {
      signup_deadline: input.signupDeadline ?? c.signup_deadline,
      observation_deadline: input.observationDeadline ?? c.observation_deadline,
      feedback_deadline: input.feedbackDeadline ?? c.feedback_deadline,
    };
    checkDeadlines(next.signup_deadline, next.observation_deadline, next.feedback_deadline);
    Object.assign(c, next);
    return HttpResponse.json(cycle(c));
  }),

  http.get('/api/cycles/:cycleId/due-professors', ({ request, params }) => {
    committeeMember(request);
    const c = cycleOr404(params.cycleId);
    const order = termOrder(db);
    const cycleTermIndex = order.indexOf(c.term_id);
    const previousTerm = order[cycleTermIndex - 1];
    const rows: DueProfessor[] = db.eval_due
      .filter((d) => d.cycle_id === c.cycle_id)
      .filter((d) => professor(d.netid).is_active)
      .map((d): DueProfessor => {
        const p = professor(d.netid);
        const last = previousTerm ? lastCompletedTermId(db, p.netid, previousTerm) : null;
        return {
          professor: person(p.netid),
          department: department(p.dept_id),
          dueStatus: d.due_status === 'overdue' ? 'OVERDUE' : 'DUE',
          lastObservedTerm: last && order.indexOf(last) < cycleTermIndex ? term(last) : null,
        };
      })
      .sort((a, b) => RANK_ORDER[a.professor.rank] - RANK_ORDER[b.professor.rank] || a.professor.lastName.localeCompare(b.professor.lastName));
    return HttpResponse.json(rows);
  }),

  http.post('/api/cycles/:cycleId/notifications/due-reminders', async ({ request, params }) => {
    const me = committeeMember(request);
    const c = cycleOr404(params.cycleId);
    const { netids } = ((await request.json().catch(() => ({}))) ?? {}) as DueRemindersInput;
    const due = db.eval_due
      .filter((d) => d.cycle_id === c.cycle_id && (!netids?.length || netids.includes(d.netid)))
      .filter((d) => professor(d.netid).is_active)
      .map((d) => d.netid);
    return HttpResponse.json({ sent: notify(due, 'reminder', `Reminder: sign up to be observed by ${c.signup_deadline}`, me.netid, c.cycle_id) });
  }),

  // A3: every active professor, NOT DUE included, with DUE/OVERDUE as fixed at kickoff.
  http.get('/api/cycles/:cycleId/faculty', ({ request, params }) => {
    committeeMember(request);
    const c = cycleOr404(params.cycleId);
    return HttpResponse.json(facultyRows(c.term_id, c));
  }),

  // A2 before kickoff: who would be due if a cycle started for this term.
  http.get('/api/terms/:termId/due-preview', ({ request, params }) => {
    committeeMember(request);
    const termId = String(params.termId);
    if (!db.term.some((t) => t.term_id === termId)) return fail(404, 'NOT_FOUND', 'Term not found.');
    return HttpResponse.json(facultyRows(termId, db.eval_cycle.find((x) => x.term_id === termId)));
  }),

  // ---------- Sign-ups and observer selection ----------

  http.get('/api/cycles/:cycleId/signups', ({ request, params }) => {
    committeeMember(request);
    const c = cycleOr404(params.cycleId);
    return HttpResponse.json(signupsOf(c).map(signup));
  }),

  http.post('/api/cycles/:cycleId/matching', ({ request, params }) => {
    committeeMember(request);
    const c = cycleOr404(params.cycleId);
    if (today() <= c.signup_deadline) return fail(409, 'SIGNUP_OPEN', `Run observer selection after the sign-up deadline (${c.signup_deadline}).`);
    for (const s of signupsOf(c)) {
      if (observationOfSignup(s.signup_id)) continue;
      db.observer_match = db.observer_match.filter((m) => !(m.signup_id === s.signup_id && m.round_no === 1));
      db.alert = db.alert.filter((a) => a.signup_id !== s.signup_id || a.alert_type === 'no_acceptance');
      const list = eligibleObservers(db, s);
      for (const n of list) db.observer_match.push({ signup_id: s.signup_id, observer_netid: n, generated_date: now(), round_no: 1 });
      const alert = alertFor(list.length);
      if (alert) db.alert.push({ alert_id: newId('AL'), signup_id: s.signup_id, alert_type: alert, created_date: now(), resolved_by: null, resolved_date: null, resolution_note: null });
    }
    return HttpResponse.json(signupsOf(c).map(matchingRow));
  }),

  http.get('/api/cycles/:cycleId/matching', ({ request, params }) => {
    committeeMember(request);
    return HttpResponse.json(signupsOf(cycleOr404(params.cycleId)).map(matchingRow));
  }),

  http.post('/api/cycles/:cycleId/notifications/lists-ready', ({ request, params }) => {
    const me = committeeMember(request);
    const c = cycleOr404(params.cycleId);
    const ready = signupsOf(c).filter((s) => db.observer_match.some((m) => m.signup_id === s.signup_id)).map((s) => s.observee_netid);
    return HttpResponse.json({ sent: notify(ready, 'matches_ready', 'Your observer list is ready', me.netid, c.cycle_id) });
  }),

  // Stretch goal: add an observer by hand when the list came up short.
  http.post('/api/signups/:signupId/candidates', async ({ request, params }) => {
    committeeMember(request);
    const s = found(signupRow(String(params.signupId)), 'Sign-up not found.');
    const { observerNetid } = (await request.json()) as { observerNetid: string };
    if (!db.professor.some((p) => p.netid === observerNetid)) return fail(400, 'UNKNOWN_PROFESSOR', 'No professor with that NetID.');
    if (!isEligible(checkEligibility(db, s, observerNetid))) return fail(409, 'NOT_ELIGIBLE', 'That professor does not meet the matching rules for this sign-up.');
    if (!db.observer_match.some((m) => m.signup_id === s.signup_id && m.observer_netid === observerNetid)) {
      db.observer_match.push({ signup_id: s.signup_id, observer_netid: observerNetid, generated_date: now(), round_no: 2 });
    }
    return HttpResponse.json(matchingRow(s), { status: 201 });
  }),

  // ---------- Survey and results ----------

  http.post('/api/cycles/:cycleId/notifications/survey', ({ request, params }) => {
    const me = committeeMember(request);
    const c = cycleOr404(params.cycleId);
    const participants = new Set(signupsOf(c).map((s) => s.observee_netid));
    for (const s of signupsOf(c)) {
      const o = observationOfSignup(s.signup_id);
      if (o) participants.add(o.observer_netid);
    }
    return HttpResponse.json({ sent: notify([...participants], 'survey_open', 'The end-of-process survey is open', me.netid, c.cycle_id) });
  }),

  http.get('/api/cycles/:cycleId/survey-responses', ({ request, params }) => {
    committeeMember(request);
    const c = cycleOr404(params.cycleId);
    const rows: SurveyResponse[] = db.survey_response
      .filter((r) => r.cycle_id === c.cycle_id)
      .map((r) => ({
        responseId: r.response_id, respondent: person(r.respondent_id), respondentRole: r.respondent_role, processOk: r.process_ok,
        difficulties: r.difficulties, additionalFeedback: r.additional_feedback, troubleFileKey: r.trouble_file_key, submittedDate: r.submitted_date,
      }));
    return HttpResponse.json(rows);
  }),

  // "latest" returns the most recent cycle that has KPI results (they are generated after the feedback deadline).
  http.get('/api/cycles/:cycleId/kpis', ({ request, params }) => {
    committeeMember(request);
    const withKpis = new Set(db.kpi_result.map((k) => k.cycle_id));
    const latest = db.eval_cycle.filter((x) => withKpis.has(x.cycle_id)).sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
    const c = params.cycleId === 'latest' ? found(latest ?? currentCycleRow(), 'No cycle has started yet.') : cycleOr404(params.cycleId);
    const kpis = db.kpi_result.filter((k) => k.cycle_id === c.cycle_id);
    const body: CycleKpis = {
      cycle: cycle(c),
      computedDate: kpis[0]?.computed_date ?? null,
      kpis: kpis.map((k) => ({ kpiCode: k.kpi_code, numerator: k.numerator, denominator: k.denominator, kpiValue: k.kpi_value, computedDate: k.computed_date })),
    };
    return HttpResponse.json(body);
  }),

  // ---------- Executive reports (current cycle) ----------

  http.get('/api/dashboard/due-by-rank', ({ request }) => {
    committeeMember(request);
    const c = currentCycleOr404();
    const due = db.eval_due
      .filter((d) => d.cycle_id === c.cycle_id)
      .filter((d) => professor(d.netid).is_active)
      .map((d) => d.netid);
    return HttpResponse.json({ cycleId: c.cycle_id, total: due.length, byRank: byRank(due) } satisfies DueByRank);
  }),

  http.get('/api/dashboard/outstanding-observations', ({ request }) => {
    committeeMember(request);
    const c = currentCycleOr404();
    const open = signupsOf(c).filter((s) => !isSignedOff(observationOfSignup(s.signup_id)));
    const body: OutstandingObservations = {
      cycleId: c.cycle_id,
      total: open.length,
      byRank: byRank(open.map((s) => s.observee_netid)),
      items: open.map((s) => ({ signupId: s.signup_id, observee: person(s.observee_netid), section: section(s.section_id), observationStatus: observationOfSignup(s.signup_id)?.status ?? null })),
    };
    return HttpResponse.json(body);
  }),

  http.get('/api/dashboard/unmatched', ({ request }) => {
    committeeMember(request);
    const c = currentCycleOr404();
    const items = signupsOf(c)
      .filter((s) => !observationOfSignup(s.signup_id))
      .flatMap((s) => {
        const a = db.alert.find((x) => x.signup_id === s.signup_id && (x.alert_type === 'no_observer' || x.alert_type === 'no_acceptance'));
        return a ? [{ signupId: s.signup_id, observee: person(s.observee_netid), section: section(s.section_id), alertType: a.alert_type }] : [];
      });
    return HttpResponse.json({ cycleId: c.cycle_id, total: items.length, items } satisfies UnmatchedFaculty);
  }),

  // Email a read-only link to a signed and locked record; every forward is a Forwarded_observation row.
  http.post('/api/observations/:observationId/forward', async ({ request, params }) => {
    const me = committeeMember(request);
    const o = found(db.observation.find((x) => x.observation_id === params.observationId), 'Observation not found.');
    if (!isLocked(o)) return fail(409, 'NOT_LOCKED', 'Only signed and locked records can be forwarded.');
    const { email } = (await request.json()) as ForwardInput;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email ?? '')) return fail(400, 'INVALID_EMAIL', 'Enter a valid email address.');
    const row = {
      forward_id: newId('FW'),
      observation_id: o.observation_id,
      recipient_email: email.trim(),
      shared_by: me.netid,
      shared_date: now(),
      link_token: crypto.randomUUID(),
    };
    db.forwarded_observation.push(row);
    return HttpResponse.json({ forwardId: row.forward_id, sharedDate: row.shared_date } satisfies ForwardResult, { status: 201 });
  }),

  // ---------- Templates ----------

  http.get('/api/templates', ({ request }) => {
    committeeMember(request);
    return HttpResponse.json([...db.template_version].sort((a, b) => b.version_no - a.version_no).map(templateVersion));
  }),

  http.post('/api/templates', async ({ request }) => {
    const me = committeeMember(request);
    const input = (await request.json()) as CreateTemplateInput;
    if (!input.questions?.length) return fail(400, 'QUESTIONS_REQUIRED', 'A template needs at least one question.');
    // One draft at a time: saving replaces the previous draft.
    const old = db.template_version.find((v) => v.status === 'draft');
    if (old) {
      db.template_version = db.template_version.filter((v) => v !== old);
      db.template_question = db.template_question.filter((q) => q.version_id !== old.version_id);
    }
    const versionNo = Math.max(0, ...db.template_version.map((v) => v.version_no)) + 1;
    const row = { version_id: `TV-${versionNo}`, version_no: versionNo, status: 'draft' as const, change_note: input.changeNote, created_by: me.netid, created_date: today(), published_date: null };
    db.template_version.push(row);
    input.questions.forEach((q, i) =>
      db.template_question.push({
        question_id: `${row.version_id}-Q${i + 1}`, version_id: row.version_id, order_no: i + 1, title: q.title, wording: q.wording,
        rating_min: q.ratingMin, rating_max: q.ratingMax, min_label: q.minLabel, max_label: q.maxLabel, is_required: q.isRequired,
      }),
    );
    return HttpResponse.json(templateVersion(row), { status: 201 });
  }),

  http.patch('/api/templates/:versionId/publish', async ({ request, params }) => {
    committeeMember(request);
    const v = found(db.template_version.find((x) => x.version_id === params.versionId), 'Template version not found.');
    if (v.status !== 'draft') return fail(409, 'NOT_DRAFT', 'Only a draft can be published.');
    const { changeNote } = (await request.json()) as { changeNote: string };
    for (const live of db.template_version.filter((x) => x.status === 'live')) live.status = 'retired';
    Object.assign(v, { status: 'live', published_date: today(), change_note: changeNote || v.change_note });
    return HttpResponse.json(templateVersion(v));
  }),
];
