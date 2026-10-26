// In-memory copy of the dummy database plus the row-to-API mapping the mock handlers share.
// Changes made through the mock API last until the page reloads.

import { HttpResponse } from 'msw';
import type {
  CountByRank,
  CourseSection,
  Cycle,
  Department,
  ObservationDetail,
  ObservationSummary,
  PersonRef,
  ProposedDate,
  Signup,
  Term,
  TemplateVersion,
} from '../api/types';
import seed from './data/db.json';
import { currentTermId, cyclePhase, displayName, meetingOn, surveyOpensDate, termLabel } from './rules';
import type { Db, EvalCycleRow, NotificationRow, ObservationRow, ProfessorRow, SignupRow, TemplateVersionRow } from './schema';

export const db: Db = structuredClone(seed as Db);
export const today = () => db.meta.today;
/** "now" for timestamps written by the mock: the data's date at midday UTC. */
export const now = () => `${db.meta.today}T12:00:00.000Z`;

let counter = 0;
export const newId = (prefix: string) => `${prefix}-M${String(++counter).padStart(4, '0')}`;

// ---------- Errors and auth ----------

export const fail = (status: number, code: string, message: string) =>
  HttpResponse.json({ error: { code, message } }, { status });

/** The value, or a thrown 404 (MSW sends a thrown response as the reply). */
export function found<T>(value: T | null | undefined, message: string, code = 'NOT_FOUND'): T {
  if (value === null || value === undefined) throw fail(404, code, message);
  return value;
}

/**
 * Demo tokens look like "demo:maya.lin@demo.edu". The real backend verifies a Firebase ID
 * token instead and looks the email up the same way.
 */
export function signedIn(request: Request): ProfessorRow {
  const header = request.headers.get('Authorization') ?? '';
  const email = header.startsWith('Bearer demo:') ? header.slice('Bearer demo:'.length).toLowerCase() : null;
  const prof = email ? db.professor.find((p) => p.email === email && p.is_active) : undefined;
  if (!prof) throw fail(401, 'UNAUTHENTICATED', 'Sign in again. No active account matches this login.');
  return prof;
}

export const isAc = (netid: string) => db.ac_member.some((a) => a.netid === netid && a.is_active);

/** Assessment Committee endpoints: the server checks AC_Member, never the front-end toggle. */
export function committeeMember(request: Request): ProfessorRow {
  const prof = signedIn(request);
  if (!isAc(prof.netid)) throw fail(403, 'FORBIDDEN', 'Only Assessment Committee members can do this.');
  return prof;
}

// ---------- Row lookups ----------

export const professor = (netid: string) => db.professor.find((p) => p.netid === netid)!;
export const signupRow = (id: string) => db.sign_up.find((s) => s.signup_id === id);
const cycleRow = (id: string) => db.eval_cycle.find((c) => c.cycle_id === id);
export const cycleOr404 = (id: unknown) => found(cycleRow(String(id)), 'Cycle not found.');

/** The most recently started cycle. */
export function currentCycleRow(): EvalCycleRow | null {
  const started = db.eval_cycle.filter((c) => c.start_date <= today()).sort((a, b) => b.start_date.localeCompare(a.start_date));
  return started[0] ?? null;
}

export const currentTerm = () => currentTermId(db, today());

/** Writes one notification per recipient and returns how many were written (0 when there is no cycle). */
export function notify(recipients: string[], type: NotificationRow['notif_type'], subject: string, sentBy: string | null, cycleId = currentCycleRow()?.cycle_id) {
  if (!cycleId) return 0;
  for (const r of recipients) {
    db.notification.push({ notification_id: newId('N'), cycle_id: cycleId, recipient_netid: r, sent_by: sentBy, notif_type: type, subject, sent_date: now() });
  }
  return recipients.length;
}

// ---------- Mapping rows to API shapes ----------

export function term(termId: string): Term {
  const t = db.term.find((x) => x.term_id === termId)!;
  return { termId: t.term_id, season: t.season, year: t.year, label: termLabel(t), startDate: t.start_date, endDate: t.end_date };
}

export function department(deptId: string): Department {
  const d = db.department.find((x) => x.dept_id === deptId)!;
  return { deptId: d.dept_id, deptName: d.dept_name };
}

export function person(netid: string): PersonRef {
  const p = professor(netid);
  return { netid: p.netid, firstName: p.first_name, lastName: p.last_name, displayName: displayName(p), rank: p.rank };
}

/** A person plus their email. */
export const contact = (netid: string) => ({ ...person(netid), email: professor(netid).email });

export function section(sectionId: string): CourseSection {
  const s = db.section.find((x) => x.section_id === sectionId)!;
  const c = db.course.find((x) => x.course_id === s.course_id)!;
  return {
    sectionId: s.section_id,
    label: `${c.dept_id} ${c.course_num}.${s.section_num}`,
    courseNum: c.course_num,
    sectionNum: s.section_num,
    title: c.title,
    courseLevel: c.course_level,
    classMode: s.class_mode,
    enrollment: s.enrollment,
    term: term(s.term_id),
    meetings: db.meeting_time
      .filter((m) => m.section_id === sectionId)
      .map((m) => ({ dayOfWeek: m.day_of_week, startTime: m.start_time, endTime: m.end_time, room: m.room })),
  };
}

export function proposedDates(signupId: string): ProposedDate[] {
  const s = signupRow(signupId)!;
  const meetings = db.meeting_time.filter((m) => m.section_id === s.section_id);
  return db.proposed_date
    .filter((p) => p.signup_id === signupId)
    .map((p) => ({ date: p.date, startTime: meetingOn(meetings, p.date)?.start_time ?? '' }));
}

export function cycle(c: EvalCycleRow): Cycle {
  return {
    cycleId: c.cycle_id,
    term: term(c.term_id),
    startedBy: person(c.started_by),
    startDate: c.start_date,
    signupDeadline: c.signup_deadline,
    observationDeadline: c.observation_deadline,
    feedbackDeadline: c.feedback_deadline,
    surveyOpensDate: surveyOpensDate(c),
    phase: cyclePhase(db, c, today()),
  };
}

export const observationOfSignup = (signupId: string) => db.observation.find((o) => o.signup_id === signupId) ?? null;

export function signup(s: SignupRow): Signup {
  const o = observationOfSignup(s.signup_id);
  return {
    signupId: s.signup_id,
    cycleId: s.cycle_id,
    observee: contact(s.observee_netid),
    section: section(s.section_id),
    proposedDates: proposedDates(s.signup_id),
    submitDate: s.submit_date,
    observation: o
      ? {
          observationId: o.observation_id,
          observer: person(o.observer_netid),
          status: o.status,
          scheduledDate: o.scheduled_date,
        }
      : null,
  };
}

export function observationSummary(o: ObservationRow): ObservationSummary {
  const s = signupRow(o.signup_id)!;
  return {
    observationId: o.observation_id,
    term: term(cycleRow(s.cycle_id)!.term_id),
    observer: person(o.observer_netid),
    observee: person(s.observee_netid),
    section: section(s.section_id),
    scheduledDate: o.scheduled_date,
    status: o.status,
    observeeSignedDate: o.observee_signed_date,
    observerSignedDate: o.observer_signed_date,
  };
}

/** A template version's questions in order. */
const questionsOf = (versionId: string) =>
  db.template_question.filter((q) => q.version_id === versionId).sort((a, b) => a.order_no - b.order_no);

export function observationDetail(o: ObservationRow): ObservationDetail {
  const v = db.template_version.find((x) => x.version_id === o.version_id)!;
  return {
    ...observationSummary(o),
    templateVersion: { versionId: v.version_id, versionNo: v.version_no },
    answers: questionsOf(o.version_id).map((q) => {
      const a = db.observation_answer.find((x) => x.observation_id === o.observation_id && x.question_id === q.question_id);
      return {
        questionId: q.question_id, title: q.title, wording: q.wording, ratingMin: q.rating_min, ratingMax: q.rating_max,
        minLabel: q.min_label, maxLabel: q.max_label, isRequired: q.is_required, rating: a?.rating ?? null, comment: a?.comment ?? '',
      };
    }),
    otherComments: o.other_comments,
    lastSavedDate: o.last_saved_date ?? new Date().toISOString(),
    reasonNotCompleted: o.reason_not_completed,
    issueFileName: o.issue_file_key ? o.issue_file_key.split('/').pop()! : null,
  };
}

export function templateVersion(v: TemplateVersionRow): TemplateVersion {
  return {
    versionId: v.version_id,
    versionNo: v.version_no,
    status: v.status,
    changeNote: v.change_note,
    createdBy: person(v.created_by),
    createdDate: v.created_date,
    publishedDate: v.published_date,
    observationsCount: db.observation.filter((o) => o.version_id === v.version_id).length,
    questions: questionsOf(v.version_id).map((q) => ({
      questionId: q.question_id, orderNo: q.order_no, title: q.title, wording: q.wording, ratingMin: q.rating_min,
      ratingMax: q.rating_max, minLabel: q.min_label, maxLabel: q.max_label, isRequired: q.is_required,
    })),
  };
}

export const byRank = (netids: string[]): CountByRank => {
  const counts = { assistant: 0, associate: 0, full: 0 };
  for (const n of netids) counts[professor(n).rank]++;
  return counts;
};
