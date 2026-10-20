import { http, HttpResponse, type PathParams } from 'msw';
import type {
  ConfirmRequestInput,
  CreateSignupInput,
  EvaluationStatus,
  ObservationRequest,
  ReportMissedInput,
  SendRequestsInput,
  SignedFormInput,
} from '../../api/types';
import {
  MAX_ACCEPTED,
  acceptedCount,
  addDays,
  checkEligibility,
  coursesTaught,
  cyclePhase,
  dueStatus,
  dueTermId,
  freeDates,
  isEligible,
  isLocked,
  lastCompletedTermId,
  requestExpiresAt,
  surveyOpensDate,
} from '../rules';
import type { EvalCycleRow, ObservationRequestRow, ProfessorRow } from '../schema';
import {
  currentCycleRow,
  currentTerm,
  cycle,
  cycleOr404,
  db,
  fail,
  found,
  newId,
  notify,
  now,
  observationDetail,
  observationSummary,
  person,
  proposedDates,
  section,
  signedIn,
  signup,
  signupRow,
  term,
  today,
} from '../store';

/** A pending request past its 48 hours reads as expired. */
const requestStatus = (r: ObservationRequestRow) => (r.status === 'pending' && requestExpiresAt(r.sent_date) <= now() ? 'expired' : r.status);

const toRequest = (r: ObservationRequestRow): ObservationRequest => {
  const s = signupRow(r.signup_id)!;
  return {
    signupId: r.signup_id,
    observer: person(r.observer_netid),
    observee: person(s.observee_netid),
    section: section(s.section_id),
    proposedDates: proposedDates(s.signup_id),
    status: requestStatus(r),
    sentDate: r.sent_date,
    respondedDate: r.responded_date,
    expiresAt: requestExpiresAt(r.sent_date),
  };
};

const mySignup = (c: EvalCycleRow | null, me: ProfessorRow) => c && db.sign_up.find((s) => s.cycle_id === c.cycle_id && s.observee_netid === me.netid);

/** My own sign-up, else 404. */
const ownSignup = (params: PathParams, me: ProfessorRow) => {
  const s = signupRow(String(params.signupId));
  return found(s && s.observee_netid === me.netid ? s : null, 'Sign-up not found.');
};

/** Observees reach their own records, observers only the ones they conducted; anything else is 404. */
const observationFor = (params: PathParams, me: ProfessorRow) => {
  const o = db.observation.find((x) => x.observation_id === params.observationId);
  const s = o && signupRow(o.signup_id);
  if (!o || !s || (s.observee_netid !== me.netid && o.observer_netid !== me.netid)) throw fail(404, 'NOT_FOUND', 'Observation not found.');
  return { o, s };
};

/** A request sent to me that is still pending. */
const pendingRequestTo = (params: PathParams, me: ProfessorRow) => {
  if (me.netid !== params.observerNetId) throw fail(403, 'FORBIDDEN', 'You can only answer requests sent to you.');
  const r = found(db.observation_request.find((x) => x.signup_id === params.signupId && x.observer_netid === me.netid), 'Request not found.');
  if (requestStatus(r) !== 'pending') throw fail(409, 'NOT_PENDING', `This request is ${requestStatus(r)}.`);
  return r;
};

const byDateDesc = <T extends { scheduledDate: string }>(rows: T[]) => rows.sort((a, b) => b.scheduledDate.localeCompare(a.scheduledDate));

export const facultyHandlers = [
  // ---------- Observee ----------

  http.get('/api/me/evaluation-status', ({ request }) => {
    const me = signedIn(request);
    const c = currentCycleRow();
    const termId = c?.term_id ?? currentTerm();
    const status = dueStatus(db, me, termId);
    const last = lastCompletedTermId(db, me.netid);
    const mine = mySignup(c, me);
    const body: EvaluationStatus = {
      status,
      rank: me.rank,
      evalIntervalYears: me.eval_interval_years,
      dueTerm: term(dueTermId(db, me, termId)),
      lastObservedTerm: last ? term(last) : null,
      cycle: c ? cycle(c) : null,
      canSignUp: Boolean(c && status !== 'NOT_DUE' && !mine && today() <= c.signup_deadline),
      signupId: mine?.signup_id ?? null,
    };
    return HttpResponse.json(body);
  }),

  http.get('/api/me/courses', ({ request }) => {
    const me = signedIn(request);
    const termId = new URL(request.url).searchParams.get('termId') ?? currentTerm();
    return HttpResponse.json(db.section.filter((s) => s.instructor_id === me.netid && s.term_id === termId).map((s) => section(s.section_id)));
  }),

  http.post('/api/signups', async ({ request }) => {
    const me = signedIn(request);
    const input = (await request.json()) as CreateSignupInput;
    const c = currentCycleRow();
    if (!c || today() > c.signup_deadline) return fail(409, 'SIGNUP_CLOSED', 'The sign-up window for this cycle is closed.');
    if (dueStatus(db, me, c.term_id) === 'NOT_DUE') return fail(409, 'NOT_DUE', 'You are not due for an observation this semester.');
    if (mySignup(c, me)) return fail(409, 'ALREADY_SIGNED_UP', 'You already signed up this semester.');
    const sec = db.section.find((s) => s.section_id === input.sectionId && s.instructor_id === me.netid && s.term_id === c.term_id);
    if (!sec) return fail(400, 'INVALID_SECTION', 'Choose one of the sections you teach this semester.');
    const window = [addDays(c.signup_deadline, 1), c.observation_deadline];
    if (!input.proposedDates?.length || input.proposedDates.some((d) => d < window[0] || d > window[1])) {
      return fail(400, 'INVALID_DATES', `Proposed dates must fall between ${window[0]} and ${window[1]}.`);
    }
    const row = { signup_id: newId('SU'), cycle_id: c.cycle_id, observee_netid: me.netid, section_id: sec.section_id, submit_date: today() };
    db.sign_up.push(row);
    for (const date of input.proposedDates) db.proposed_date.push({ signup_id: row.signup_id, date });
    return HttpResponse.json(signup(row), { status: 201 });
  }),

  http.get('/api/me/signup', ({ request }) => {
    const row = mySignup(currentCycleRow(), signedIn(request));
    return HttpResponse.json(row ? signup(row) : null);
  }),

  http.get('/api/signups/:signupId/candidates', ({ request, params }) => {
    const s = ownSignup(params, signedIn(request));
    const rows = db.observer_match
      .filter((m) => m.signup_id === s.signup_id)
      .map((m) => {
        const r = db.observation_request.find((x) => x.signup_id === s.signup_id && x.observer_netid === m.observer_netid);
        return {
          observer: person(m.observer_netid),
          roundNo: m.round_no,
          request: r ? { status: requestStatus(r), sentDate: r.sent_date } : null,
          teaches: coursesTaught(db, s, m.observer_netid),
          freeAtProposedTimes: freeDates(db, s, m.observer_netid).length === proposedDates(s.signup_id).length,
        };
      });
    return HttpResponse.json(rows);
  }),

  http.post('/api/signups/:signupId/requests', async ({ request, params }) => {
    const me = signedIn(request);
    const s = ownSignup(params, me);
    if (db.observation.some((o) => o.signup_id === s.signup_id)) return fail(409, 'ALREADY_PAIRED', 'You are already paired with an observer.');
    const input = ((await request.json().catch(() => ({}))) ?? {}) as SendRequestsInput;
    const candidates = db.observer_match.filter((m) => m.signup_id === s.signup_id).map((m) => m.observer_netid);
    const targets = input.observerNetids?.length ? input.observerNetids : candidates;
    if (targets.some((n) => !candidates.includes(n))) return fail(400, 'NOT_A_CANDIDATE', 'Requests can only go to observers on your list.');
    for (const netid of targets) {
      const existing = db.observation_request.find((r) => r.signup_id === s.signup_id && r.observer_netid === netid);
      if (existing && requestStatus(existing) !== 'expired') continue;
      if (existing) Object.assign(existing, { status: 'pending', sent_date: now(), responded_date: null });
      else db.observation_request.push({ signup_id: s.signup_id, observer_netid: netid, status: 'pending', sent_date: now(), responded_date: null });
      notify([netid], 'observation_request', `Observation request from ${person(me.netid).displayName}`, me.netid);
    }
    return HttpResponse.json(db.observation_request.filter((r) => r.signup_id === s.signup_id).map(toRequest), { status: 201 });
  }),

  http.get('/api/me/requests/outgoing', ({ request }) => {
    const me = signedIn(request);
    const mine = new Set(db.sign_up.filter((s) => s.observee_netid === me.netid).map((s) => s.signup_id));
    return HttpResponse.json(db.observation_request.filter((r) => mine.has(r.signup_id)).map(toRequest));
  }),

  http.get('/api/me/observations', ({ request }) => {
    const me = signedIn(request);
    const mine = new Set(db.sign_up.filter((s) => s.observee_netid === me.netid).map((s) => s.signup_id));
    return HttpResponse.json(byDateDesc(db.observation.filter((o) => mine.has(o.signup_id)).map(observationSummary)));
  }),

  http.get('/api/observations/:observationId', ({ request, params }) => {
    const { o } = observationFor(params, signedIn(request));
    return HttpResponse.json(observationDetail(o));
  }),

  http.post('/api/observations/:observationId/sign', ({ request, params }) => {
    const me = signedIn(request);
    const { o, s } = observationFor(params, me);
    if (isLocked(o)) return fail(409, 'LOCKED', 'This record is signed by both and locked.');
    if (o.status !== 'completed') return fail(409, 'FORM_NOT_SUBMITTED', 'The observer has not submitted the form yet.');
    if (s.observee_netid === me.netid) o.observee_signed_date = today();
    else o.observer_signed_date = today();
    return HttpResponse.json(observationDetail(o));
  }),

  http.post('/api/observations/:observationId/report-missed', async ({ request, params }) => {
    const { o } = observationFor(params, signedIn(request));
    if (o.status !== 'scheduled') return fail(409, 'NOT_SCHEDULED', 'Only a scheduled observation can be reported as missed.');
    const { reason } = (await request.json()) as ReportMissedInput;
    if (!reason?.trim()) return fail(400, 'REASON_REQUIRED', 'Say why the observation did not happen.');
    Object.assign(o, { status: 'not_completed', reason_not_completed: reason.trim() });
    return HttpResponse.json(observationDetail(o));
  }),

  http.post('/api/observations/:observationId/issue-file', async ({ request, params }) => {
    const { o } = observationFor(params, signedIn(request));
    const file = (await request.formData()).get('file');
    if (!(file instanceof File)) return fail(400, 'FILE_REQUIRED', 'Choose a file to upload.');
    if (file.size > 10 * 1024 * 1024) return fail(400, 'FILE_TOO_LARGE', 'Files can be up to 10 MB.');
    o.issue_file_key = `uploads/${o.observation_id}/${file.name}`;
    return HttpResponse.json(observationDetail(o));
  }),

  http.post('/api/cycles/:cycleId/survey-responses', async ({ request, params }) => {
    const me = signedIn(request);
    const c = cycleOr404(params.cycleId);
    if (cyclePhase(db, c, today()) !== 'feedback') return fail(409, 'SURVEY_CLOSED', `The survey is open from ${surveyOpensDate(c)} to ${c.feedback_deadline}.`);
    if (db.survey_response.some((r) => r.cycle_id === c.cycle_id && r.respondent_id === me.netid)) return fail(409, 'ALREADY_SUBMITTED', 'You already submitted the survey.');
    const form = await request.formData();
    const file = form.get('troubleFile');
    const responseId = newId('SR');
    db.survey_response.push({
      response_id: responseId,
      cycle_id: c.cycle_id,
      respondent_id: me.netid,
      respondent_role: form.get('respondentRole') === 'observer' ? 'observer' : 'observee',
      process_ok: form.get('processOk') === 'true',
      difficulties: String(form.get('difficulties') ?? ''),
      additional_feedback: String(form.get('additionalFeedback') ?? ''),
      trouble_file_key: file instanceof File ? `uploads/${responseId}/${file.name}` : null,
      submitted_date: today(),
    });
    return HttpResponse.json({ responseId }, { status: 201 });
  }),

  // ---------- Observer ----------

  http.get('/api/me/requests/incoming', ({ request }) => {
    const me = signedIn(request);
    const c = currentCycleRow();
    const rows = db.observation_request.filter((r) => r.observer_netid === me.netid && signupRow(r.signup_id)?.cycle_id === c?.cycle_id);
    return HttpResponse.json(rows.map(toRequest).sort((a, b) => b.sentDate.localeCompare(a.sentDate)));
  }),

  http.patch('/api/signups/:signupId/requests/:observerNetId/confirm', async ({ request, params }) => {
    const me = signedIn(request);
    const r = pendingRequestTo(params, me);
    const s = signupRow(r.signup_id)!;
    if (db.observation.some((o) => o.signup_id === s.signup_id)) return fail(409, 'ALREADY_PAIRED', 'Someone else accepted first.');
    if (!isEligible(checkEligibility(db, s, me.netid))) {
      return acceptedCount(db, me.netid, s.cycle_id) >= MAX_ACCEPTED
        ? fail(409, 'LIMIT_REACHED', `You have already accepted ${MAX_ACCEPTED} observations this semester.`)
        : fail(409, 'NOT_ELIGIBLE', 'You no longer meet the matching rules for this request.');
    }
    const { date } = (await request.json()) as ConfirmRequestInput;
    if (!db.proposed_date.some((p) => p.signup_id === s.signup_id && p.date === date)) return fail(400, 'INVALID_DATE', 'Pick one of the proposed dates.');
    const live = db.template_version.find((v) => v.status === 'live')!;
    db.observation.push({
      observation_id: newId('OB'), signup_id: s.signup_id, observer_netid: me.netid, version_id: live.version_id,
      scheduled_date: date, status: 'scheduled', observee_signed_date: null, observer_signed_date: null,
      reason_not_completed: null, issue_file_key: null, other_comments: '', last_saved_date: null,
    });
    Object.assign(r, { status: 'accepted', responded_date: now() });
    // The first to accept is paired automatically; everyone else's request is cancelled.
    for (const other of db.observation_request.filter((x) => x.signup_id === s.signup_id && x !== r && x.status === 'pending')) {
      other.status = 'cancelled';
      notify([other.observer_netid], 'request_cancelled', `${person(s.observee_netid).displayName} was paired with another colleague`, null);
    }
    if (acceptedCount(db, me.netid, s.cycle_id) >= MAX_ACCEPTED) {
      for (const other of db.observation_request.filter((x) => x.observer_netid === me.netid && x.status === 'pending')) other.status = 'cancelled';
    }
    return HttpResponse.json(toRequest(r));
  }),

  http.patch('/api/signups/:signupId/requests/:observerNetId/decline', ({ request, params }) => {
    const r = pendingRequestTo(params, signedIn(request));
    Object.assign(r, { status: 'declined', responded_date: now() });
    return HttpResponse.json(toRequest(r));
  }),

  http.get('/api/me/assignments', ({ request }) => {
    const me = signedIn(request);
    return HttpResponse.json(byDateDesc(db.observation.filter((o) => o.observer_netid === me.netid).map(observationSummary)));
  }),

  http.post('/api/observations/:observationId/signed-form', async ({ request, params }) => {
    const me = signedIn(request);
    const o = db.observation.find((x) => x.observation_id === params.observationId);
    if (!o || o.observer_netid !== me.netid) return fail(404, 'NOT_FOUND', 'Observation not found.');
    if (isLocked(o)) return fail(409, 'LOCKED', 'This record is signed by both and locked.');
    const input = (await request.json()) as SignedFormInput;
    const questions = db.template_question.filter((q) => q.version_id === o.version_id);
    const missing = questions.filter((q) => q.is_required && !input.answers.some((a) => a.questionId === q.question_id && a.rating >= q.rating_min && a.rating <= q.rating_max));
    if (missing.length) return fail(400, 'ANSWERS_REQUIRED', `Rate every question (missing: ${missing.map((q) => q.title).join(', ')}).`);
    db.observation_answer = db.observation_answer.filter((a) => a.observation_id !== o.observation_id);
    for (const a of input.answers) db.observation_answer.push({ observation_id: o.observation_id, question_id: a.questionId, rating: a.rating, comment: a.comment });
    // Submitting the form is the observer's signature; the observee signs next.
    Object.assign(o, { status: 'completed', other_comments: input.otherComments, observer_signed_date: today(), last_saved_date: today() });
    return HttpResponse.json(observationDetail(o));
  }),
];
