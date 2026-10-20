// Business rules from Weekly Report 6 (Business Logic sections 3, 9, 10), shared by the
// dummy-data generator and the mock API so both agree on DUE status, eligibility and KPIs.

import { addDays } from '../lib/dates';
import type { Db, EvalCycleRow, KpiResultRow, MeetingTimeRow, ObservationRow, ProfessorRow, SectionRow, SignupRow, TermRow } from './schema';

export { addDays };

// ---------- Numbers the team fixed ----------

/** Requests expire this many hours after they are sent. */
export const REQUEST_HOURS = 48;
/** An observer can accept this many observations a semester. */
export const MAX_ACCEPTED = 3;
/** Observer selection lists up to this many observers per sign-up. */
export const MAX_CANDIDATES = 5;
/**
 * Fewer eligible observers than this raises an "insufficient observers" alert (zero raises
 * "no observer"). The team has not fixed the number; 3 is an assumption to confirm.
 */
const INSUFFICIENT_BELOW = 3;

export const alertFor = (candidates: number) =>
  candidates === 0 ? ('no_observer' as const) : candidates < INSUFFICIENT_BELOW ? ('insufficient_observers' as const) : null;

// ---------- Dates ----------

export const addHours = (isoDateTime: string, hours: number) =>
  new Date(new Date(isoDateTime).getTime() + hours * 3_600_000).toISOString();

export const requestExpiresAt = (sentDate: string) => addHours(sentDate, REQUEST_HOURS);

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "Mon" for "2026-10-12". */
export const weekdayOf = (iso: string) => WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];

/** A section's meeting on that date, else its first meeting. */
export const meetingOn = (meetings: MeetingTimeRow[], date: string) =>
  meetings.find((m) => m.day_of_week === weekdayOf(date)) ?? meetings[0];

// ---------- People and records ----------

export const displayName = (p: Pick<ProfessorRow, 'first_name' | 'last_name'>) => `Dr. ${p.first_name} ${p.last_name}`;

/** Signed by both: the record is locked. */
export const isLocked = (o: ObservationRow) => Boolean(o.observee_signed_date && o.observer_signed_date);

/** A completed observation counts once it is signed by both and locked. */
export const isSignedOff = (o: ObservationRow | null | undefined) => Boolean(o && o.status === 'completed' && isLocked(o));

// ---------- Terms (only Fall and Spring count) ----------

/** Term ids in semester order; index arithmetic gives "N semesters later". */
export function termOrder(db: Pick<Db, 'term'>): string[] {
  return [...db.term].sort((a, b) => a.start_date.localeCompare(b.start_date)).map((t) => t.term_id);
}

export function termLabel(t: TermRow) {
  return `${t.season === 'fall' ? 'Fall' : 'Spring'} ${t.year}`;
}

/** The term whose dates contain `today`, or the next one to start. */
export function currentTermId(db: Pick<Db, 'term'>, today: string): string {
  const sorted = [...db.term].sort((a, b) => a.start_date.localeCompare(b.start_date));
  const inside = sorted.find((t) => t.start_date <= today && today <= t.end_date);
  return (inside ?? sorted.find((t) => t.start_date > today) ?? sorted[sorted.length - 1]).term_id;
}

/** The four semesters up to and including `termId` (two years). */
function twoYearWindow(db: Db, termId: string) {
  const order = termOrder(db);
  const end = order.indexOf(termId);
  return order.slice(Math.max(0, end - 3), end + 1);
}

// ---------- DUE / OVERDUE ----------

export function lastCompletedTermId(db: Db, netid: string, beforeOrAt?: string): string | null {
  const order = termOrder(db);
  const limit = beforeOrAt ? order.indexOf(beforeOrAt) : Infinity;
  let best = -1;
  for (const o of db.observation) {
    if (!isSignedOff(o)) continue;
    const s = db.sign_up.find((x) => x.signup_id === o.signup_id);
    if (!s || s.observee_netid !== netid) continue;
    const cycle = db.eval_cycle.find((c) => c.cycle_id === s.cycle_id)!;
    const idx = order.indexOf(cycle.term_id);
    if (idx <= limit && idx > best) best = idx;
  }
  if (best >= 0) return order[best];
  const prof = db.professor.find((p) => p.netid === netid);
  return prof?.baseline_last_eval_term ?? null;
}

/**
 * The due semester is the last completed observation's term moved forward by the professor's
 * evaluation interval. A new professor with no observation is due in the given term.
 */
export function dueTermId(db: Db, prof: ProfessorRow, currentTerm: string, last = lastCompletedTermId(db, prof.netid)): string {
  const order = termOrder(db);
  if (!last) return currentTerm;
  const idx = order.indexOf(last) + prof.eval_interval_years * 2;
  return order[Math.min(idx, order.length - 1)];
}

export function dueStatus(db: Db, prof: ProfessorRow, currentTerm: string): 'NOT_DUE' | 'DUE' | 'OVERDUE' {
  const order = termOrder(db);
  const due = order.indexOf(dueTermId(db, prof, currentTerm));
  const now = order.indexOf(currentTerm);
  if (now < due) return 'NOT_DUE';
  return now === due ? 'DUE' : 'OVERDUE';
}

export const intervalYears = (rank: ProfessorRow['rank']) => (rank === 'assistant' ? 1 : 2);

// ---------- Cycle phase ----------

export function surveyOpensDate(c: EvalCycleRow) {
  return addDays(c.observation_deadline, 1);
}

export function cyclePhase(db: Db, c: EvalCycleRow, today: string) {
  if (today <= c.signup_deadline) return 'signup' as const;
  if (today <= c.observation_deadline) {
    const matched = db.observer_match.some((m) => db.sign_up.find((s) => s.signup_id === m.signup_id)?.cycle_id === c.cycle_id);
    return matched ? ('observation' as const) : ('matching' as const);
  }
  if (today <= c.feedback_deadline) return 'feedback' as const;
  return 'closed' as const;
}

// ---------- Observer eligibility ----------

const courseLevel = (db: Db, s: SectionRow) => db.course.find((c) => c.course_id === s.course_id)!.course_level;

/** Course levels a professor taught in the two years up to and including `termId`. */
function levelsTaught(db: Db, netid: string, termId: string): Set<number> {
  const window = new Set(twoYearWindow(db, termId));
  return new Set(db.section.filter((s) => s.instructor_id === netid && window.has(s.term_id)).map((s) => courseLevel(db, s)));
}

/** Accepted (confirmed) observations an observer has in a cycle. */
export function acceptedCount(db: Db, observerNetid: string, cycleId: string) {
  return db.observation.filter(
    (o) => o.observer_netid === observerNetid && db.sign_up.find((s) => s.signup_id === o.signup_id)?.cycle_id === cycleId,
  ).length;
}

interface EligibilityCheck {
  inPool: boolean;
  sameDepartment: boolean;
  sameLevel: boolean;
  notSelf: boolean;
  underLimit: boolean;
}

/**
 * A candidate must be in the cycle's observer pool (has a sign-up), be in the observee's
 * department, have taught the same course level within two years, not be the observee,
 * and have fewer than MAX_ACCEPTED accepted observations. Availability is checked against
 * meeting times when requests are confirmed.
 */
export function checkEligibility(db: Db, signup: SignupRow, observerNetid: string): EligibilityCheck {
  const cycle = db.eval_cycle.find((c) => c.cycle_id === signup.cycle_id)!;
  const section = db.section.find((s) => s.section_id === signup.section_id)!;
  const observee = db.professor.find((p) => p.netid === signup.observee_netid)!;
  const observer = db.professor.find((p) => p.netid === observerNetid)!;
  return {
    inPool: db.sign_up.some((s) => s.cycle_id === signup.cycle_id && s.observee_netid === observerNetid),
    sameDepartment: observer.dept_id === observee.dept_id,
    sameLevel: levelsTaught(db, observerNetid, cycle.term_id).has(courseLevel(db, section)),
    notSelf: observerNetid !== observee.netid,
    underLimit: acceptedCount(db, observerNetid, cycle.cycle_id) < MAX_ACCEPTED,
  };
}

export const isEligible = (c: EligibilityCheck) => Object.values(c).every(Boolean);

/**
 * Proposed dates on which the observer has no class of their own overlapping the
 * observee's class (shown in E3 "Free at your times").
 */
export function freeDates(db: Db, signup: SignupRow, observerNetid: string): string[] {
  const cycle = db.eval_cycle.find((c) => c.cycle_id === signup.cycle_id)!;
  const theirs = db.meeting_time.filter((m) => m.section_id === signup.section_id);
  const mine = db.section
    .filter((s) => s.instructor_id === observerNetid && s.term_id === cycle.term_id && s.class_mode === 'in-person')
    .flatMap((s) => db.meeting_time.filter((m) => m.section_id === s.section_id));
  return db.proposed_date
    .filter((p) => p.signup_id === signup.signup_id)
    .map((p) => p.date)
    .filter((date) => {
      const slot = meetingOn(theirs, date);
      return !mine.some((m) => m.day_of_week === weekdayOf(date) && slot && m.start_time < slot.end_time && slot.start_time < m.end_time);
    });
}

/**
 * Courses the observer taught in the two-year window (E3 "Teaches"), as "CS 1336" labels:
 * the sign-up's course level first, then the rest, most recent first within each.
 */
export function coursesTaught(db: Db, signup: SignupRow, observerNetid: string): string[] {
  const cycle = db.eval_cycle.find((c) => c.cycle_id === signup.cycle_id)!;
  const level = courseLevel(db, db.section.find((s) => s.section_id === signup.section_id)!);
  const window = twoYearWindow(db, cycle.term_id);
  const sections = db.section
    .filter((s) => s.instructor_id === observerNetid && window.includes(s.term_id))
    .sort((a, b) => Number(courseLevel(db, b) === level) - Number(courseLevel(db, a) === level) || window.indexOf(b.term_id) - window.indexOf(a.term_id));
  const labels = sections.map((s) => {
    const course = db.course.find((c) => c.course_id === s.course_id)!;
    return `${course.dept_id} ${course.course_num}`;
  });
  return [...new Set(labels)];
}

/** Up to MAX_CANDIDATES eligible observers for a sign-up, in a stable order. */
export function eligibleObservers(db: Db, signup: SignupRow): string[] {
  return db.sign_up
    .filter((s) => s.cycle_id === signup.cycle_id)
    .map((s) => s.observee_netid)
    .filter((netid) => isEligible(checkEligibility(db, signup, netid)))
    .slice(0, MAX_CANDIDATES);
}

// ---------- KPIs (proposal section 7) ----------

export function computeKpis(db: Db, cycleId: string, computedDate: string): KpiResultRow[] {
  const due = db.eval_due.filter((d) => d.cycle_id === cycleId);
  const signups = db.sign_up.filter((s) => s.cycle_id === cycleId);
  const signupIds = new Set(signups.map((s) => s.signup_id));
  const observations = db.observation.filter((o) => signupIds.has(o.signup_id));
  const signedUp = new Set(signups.map((s) => s.observee_netid));
  const completedFor = new Set(
    observations.filter(isSignedOff).map((o) => signups.find((s) => s.signup_id === o.signup_id)!.observee_netid),
  );
  const ratio = (n: number, d: number) => (d === 0 ? null : n / d);
  const row = (kpi_code: KpiResultRow['kpi_code'], numerator: number, denominator: number, kpi_value = ratio(numerator, denominator)): KpiResultRow => ({
    cycle_id: cycleId,
    kpi_code,
    numerator,
    denominator,
    kpi_value,
    computed_date: computedDate,
  });

  const correct = observations.filter((o) => {
    const s = signups.find((x) => x.signup_id === o.signup_id)!;
    const c = checkEligibility(db, s, o.observer_netid);
    return c.inPool && c.sameDepartment && c.sameLevel && c.notSelf;
  }).length;
  const observersWhoObserved = new Set(observations.filter((o) => o.status !== 'not_completed').map((o) => o.observer_netid));
  const matches = db.observer_match.filter((m) => signupIds.has(m.signup_id) && m.round_no === 1).length;
  const surveyed = new Set(
    db.survey_response.filter((r) => r.cycle_id === cycleId && signedUp.has(r.respondent_id)).map((r) => r.respondent_id),
  );
  const overdue = due.filter((d) => !completedFor.has(d.netid)).length;
  const missed = observations.filter((o) => o.status === 'not_completed').length;

  return [
    row('1.1', correct, observations.length),
    row('1.2', overdue, due.length, overdue),
    row('2.1', due.filter((d) => signedUp.has(d.netid)).length, due.length),
    row('2.2', [...signedUp].filter((n) => observersWhoObserved.has(n)).length, signedUp.size),
    row('3.1', matches, signups.length, signups.length ? Math.round((matches / signups.length) * 10) / 10 : null),
    row('4.1', missed, observations.length, missed),
    row('4.2', surveyed.size, signedUp.size),
  ];
}
