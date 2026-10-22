// Generates the dummy database the mock API serves (src/mocks/data/db.json).
//
//   npm run data                       snapshot of 2026-09-08 (sign-up window open)
//   npm run data -- --today 2026-10-20 a later snapshot (matching done, observations under way)
//   npm run data -- --seed 7           different random details, same overall story
//
// Tables and columns follow the team's entity list (Oct 15), so the output can also be
// loaded into PostgreSQL. Observer eligibility, DUE status and KPIs come from
// src/mocks/rules.ts, the same rules the mock API uses.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AlertRow,
  CourseRow,
  Db,
  EvalCycleRow,
  MeetingTimeRow,
  NotificationRow,
  ObservationRow,
  ProfessorRow,
  SectionRow,
  SignupRow,
  TermRow,
} from '../src/mocks/schema';
import {
  MAX_ACCEPTED,
  MAX_CANDIDATES,
  REQUEST_HOURS,
  acceptedCount,
  addDays,
  addHours,
  alertFor,
  computeKpis,
  displayName,
  dueStatus,
  eligibleObservers,
  intervalYears,
  requestExpiresAt,
  surveyOpensDate,
  weekdayOf,
} from '../src/mocks/rules';

// ---------- Arguments ----------

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const TODAY = args.get('today') ?? '2026-09-08';
const SEED = Number(args.get('seed') ?? 6);
const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '..', args.get('out') ?? 'src/mocks/data/db.json');
if (!/^\d{4}-\d{2}-\d{2}$/.test(TODAY)) throw new Error('--today must look like 2026-09-08');
const NOW = `${TODAY}T12:00:00.000Z`;

// ---------- Seeded random numbers (same seed, same data) ----------

let state = SEED >>> 0;
const rand = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
const shuffle = <T>(xs: readonly T[]) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const pad = (n: number, w = 3) => String(n).padStart(w, '0');

const db: Db = {
  meta: { today: TODAY, seed: SEED, generatedAt: new Date().toISOString() },
  professor: [], ac_member: [], department: [], course: [], term: [], section: [], meeting_time: [],
  eval_cycle: [], eval_due: [], sign_up: [], observer_match: [], observation_request: [], proposed_date: [],
  notification: [], alert: [], template_version: [], template_question: [], observation: [],
  observation_answer: [], survey_response: [], kpi_result: [], forwarded_observation: [],
};

// ---------- Terms, department, courses ----------

db.term = [
  ['FA23', 'fall', 2023, '2023-08-21', '2023-12-14'],
  ['SP24', 'spring', 2024, '2024-01-16', '2024-05-09'],
  ['FA24', 'fall', 2024, '2024-08-19', '2024-12-12'],
  ['SP25', 'spring', 2025, '2025-01-21', '2025-05-15'],
  ['FA25', 'fall', 2025, '2025-08-25', '2025-12-18'],
  ['SP26', 'spring', 2026, '2026-01-20', '2026-05-14'],
  ['FA26', 'fall', 2026, '2026-08-24', '2026-12-17'],
  ['SP27', 'spring', 2027, '2027-01-19', '2027-05-13'],
  ['FA27', 'fall', 2027, '2027-08-23', '2027-12-16'],
  ['SP28', 'spring', 2028, '2028-01-18', '2028-05-11'],
  ['FA28', 'fall', 2028, '2028-08-21', '2028-12-14'],
  ['SP29', 'spring', 2029, '2029-01-16', '2029-05-10'],
].map(([term_id, season, year, start_date, end_date]) => ({ term_id, season, year, start_date, end_date }) as TermRow);
const TEACHING_TERMS = ['FA23', 'SP24', 'FA24', 'SP25', 'FA25', 'SP26', 'FA26'];

db.department = [{ dept_id: 'CS', dept_name: 'Computer Science' }];

const courses: [string, string, number][] = [
  ['1200', 'Introduction to Computer Science and Software Engineering', 1000],
  ['1336', 'Programming Fundamentals', 1000],
  ['1337', 'Computer Science I', 1000],
  ['2305', 'Discrete Mathematics for Computing I', 2000],
  ['2336', 'Computer Science II', 2000],
  ['2340', 'Computer Architecture', 2000],
  ['3305', 'Discrete Mathematics for Computing II', 3000],
  ['3341', 'Probability and Statistics in Computer Science', 3000],
  ['3345', 'Data Structures and Introduction to Algorithmic Analysis', 3000],
  ['3354', 'Software Engineering', 3000],
  ['3377', 'Systems Programming in UNIX', 3000],
  ['4337', 'Programming Language Paradigms', 4000],
  ['4347', 'Database Systems', 4000],
  ['4348', 'Operating Systems Concepts', 4000],
  ['4349', 'Advanced Algorithm Design and Analysis', 4000],
  ['4384', 'Automata Theory', 4000],
  ['4485', 'Computer Science Project', 4000],
  ['6350', 'Big Data Management and Analytics', 6000],
  ['6360', 'Database Design', 6000],
  ['6363', 'Design and Analysis of Computer Algorithms', 6000],
  ['6375', 'Machine Learning', 6000],
];
db.course = courses.map(([num, title, level]): CourseRow => ({
  course_id: `CS${num}`, dept_id: 'CS', course_num: num, title, course_level: level,
}));
const coursesAt = (level: number) => db.course.filter((c) => c.course_level === level);

// ---------- Professors ----------
// The FA26 targets match the Figma: 15 DUE, 3 OVERDUE, 24 NOT DUE (42 faculty);
// DUE or OVERDUE by rank: Assistant 8, Associate 6, Full 4.
// `last` is the term of the professor's last completed observation in the data.

type Plan = {
  name: string;
  rank: ProfessorRow['rank'];
  target: 'DUE' | 'OVERDUE' | 'NOT_DUE';
  last: string | null;
  baseline?: string;
  levels?: number[];
  ac?: 'active' | 'inactive';
  /** How the SP26 cycle went for someone who is now OVERDUE. */
  failed?: 'no_signup' | 'not_completed' | 'no_acceptance';
  /** FA26 sign-up date, or null for someone who never signs up. */
  fa26Signup?: string | null;
  /** Fixed sections in FA26 [courseNum, sectionNum] (first one is the one they sign up). */
  fa26Sections?: [string, string][];
  /** Fixed sections in FA24, where the Figma's past observation happened. */
  fa24Sections?: [string, string][];
};

const plans: Plan[] = [
  // Demo personas from the Figma
  { name: 'Maya Lin', rank: 'associate', target: 'DUE', last: 'FA24', levels: [1000, 3000], fa26Signup: '2026-09-12', fa26Sections: [['1337', '002'], ['3345', '001']], fa24Sections: [['1337', '002'], ['3345', '001']] },
  { name: 'Elena Ruiz', rank: 'associate', target: 'DUE', last: 'FA24', levels: [1000, 2000], fa26Signup: '2026-09-03', fa26Sections: [['1336', '001'], ['2336', '003']] },
  { name: 'Linda Chen', rank: 'associate', target: 'DUE', last: 'FA24', levels: [2000, 3000], ac: 'active', fa26Signup: '2026-09-14', fa26Sections: [['2305', '001'], ['3354', '002']] },
  { name: 'Omar Haddad', rank: 'full', target: 'DUE', last: 'FA24', levels: [1000, 4000], fa26Signup: '2026-09-02', fa26Sections: [['1337', '001'], ['4348', '001']], fa24Sections: [['1337', '001'], ['4348', '001']] },
  { name: 'Ahmed Saleh', rank: 'assistant', target: 'DUE', last: 'FA25', levels: [1000, 2000], fa26Signup: '2026-09-04', fa26Sections: [['1200', '001'], ['2340', '001']] },
  { name: 'Sarah Kim', rank: 'assistant', target: 'DUE', last: 'FA25', levels: [6000], fa26Signup: '2026-09-10', fa26Sections: [['6363', '002'], ['6375', '001']] },
  // Assistant professors
  { name: 'Chidi Okafor', rank: 'assistant', target: 'DUE', last: null },
  { name: 'Priya Raman', rank: 'assistant', target: 'DUE', last: 'FA25' },
  { name: 'Kevin Liu', rank: 'assistant', target: 'DUE', last: 'FA25' },
  { name: 'Hannah Brooks', rank: 'assistant', target: 'DUE', last: 'FA25', fa26Signup: null },
  { name: 'Marcus Reed', rank: 'assistant', target: 'OVERDUE', last: 'SP25', failed: 'no_signup', fa26Signup: null },
  { name: 'Julia Novak', rank: 'assistant', target: 'OVERDUE', last: 'SP25', failed: 'not_completed' },
  { name: 'Tomas Silva', rank: 'assistant', target: 'NOT_DUE', last: 'SP26' },
  { name: 'Grace Huang', rank: 'assistant', target: 'NOT_DUE', last: 'SP26' },
  { name: 'Nina Petrova', rank: 'assistant', target: 'NOT_DUE', last: 'SP26' },
  { name: 'Ryan Mitchell', rank: 'assistant', target: 'NOT_DUE', last: 'SP26' },
  { name: 'Aisha Rahman', rank: 'assistant', target: 'NOT_DUE', last: 'SP26' },
  { name: 'Ben Carter', rank: 'assistant', target: 'NOT_DUE', last: 'SP26' },
  // Associate professors
  { name: 'Laura Gomez', rank: 'associate', target: 'DUE', last: 'FA24' },
  { name: 'David Cho', rank: 'associate', target: 'DUE', last: 'FA24' },
  { name: 'Rebecca Stone', rank: 'associate', target: 'DUE', last: 'FA24', fa26Signup: null },
  { name: 'Victor Alvarez', rank: 'associate', target: 'NOT_DUE', last: 'SP25', ac: 'active' },
  { name: 'Mei Tanaka', rank: 'associate', target: 'NOT_DUE', last: 'FA25', ac: 'active', levels: [4000, 6000] },
  { name: 'Mateo Ortiz', rank: 'associate', target: 'NOT_DUE', last: 'SP25' },
  { name: 'Karen Walsh', rank: 'associate', target: 'NOT_DUE', last: 'SP25' },
  { name: 'Ivan Kuznetsov', rank: 'associate', target: 'NOT_DUE', last: 'FA25' },
  { name: 'Olivia Grant', rank: 'associate', target: 'NOT_DUE', last: 'FA25' },
  { name: 'Jorge Medina', rank: 'associate', target: 'NOT_DUE', last: 'SP26' },
  { name: 'Lena Fischer', rank: 'associate', target: 'NOT_DUE', last: 'SP26' },
  // Full professors
  { name: 'James Park', rank: 'full', target: 'DUE', last: 'FA24' },
  { name: 'Robert Hayes', rank: 'full', target: 'DUE', last: 'FA24' },
  { name: 'William Turner', rank: 'full', target: 'OVERDUE', last: null, baseline: 'SP24', failed: 'no_acceptance' },
  { name: 'Susan Wright', rank: 'full', target: 'NOT_DUE', last: 'SP25', ac: 'active' },
  { name: 'Michael Brennan', rank: 'full', target: 'NOT_DUE', last: 'SP25', ac: 'active' },
  { name: 'Anita Desai', rank: 'full', target: 'NOT_DUE', last: 'FA25', ac: 'active', levels: [3000, 6000] },
  { name: 'Paul Nguyen', rank: 'full', target: 'NOT_DUE', last: 'SP25', ac: 'active' },
  { name: 'Helen Morris', rank: 'full', target: 'NOT_DUE', last: 'FA25', ac: 'inactive' },
  { name: 'George Adeyemi', rank: 'full', target: 'NOT_DUE', last: 'FA25' },
  { name: 'Diane Foster', rank: 'full', target: 'NOT_DUE', last: 'SP26' },
  { name: 'Arthur Klein', rank: 'full', target: 'NOT_DUE', last: 'SP26' },
  { name: 'Patricia Lowe', rank: 'full', target: 'NOT_DUE', last: 'SP26' },
  { name: 'Edward Sato', rank: 'full', target: 'NOT_DUE', last: 'SP26', levels: [3000, 4000] },
];

const byName = new Map<string, ProfessorRow>();
const planOf = new Map<string, Plan>();
const usedNetids = new Set<string>();
for (const plan of plans) {
  const [first, last] = plan.name.split(' ');
  let netid = '';
  do netid = `${first[0]}${last.slice(0, 2)}`.toLowerCase() + int(150000, 249999);
  while (usedNetids.has(netid));
  usedNetids.add(netid);
  const row: ProfessorRow = {
    netid,
    first_name: first,
    last_name: last,
    email: `${first}.${last}@demo.edu`.toLowerCase(),
    rank: plan.rank,
    dept_id: 'CS',
    eval_interval_years: intervalYears(plan.rank),
    baseline_last_eval_term: plan.baseline ?? null,
    is_active: true,
  };
  db.professor.push(row);
  byName.set(plan.name, row);
  planOf.set(netid, plan);
  if (plan.ac) db.ac_member.push({ netid, is_active: plan.ac === 'active' });
}
const P = (name: string) => byName.get(name)!;

// Course levels each professor teaches. Graduate (6000) teaching is kept to people who are
// not in the FA26 observer pool, so Sarah Kim's CS 6363 sign-up finds no eligible observer.
for (const plan of plans) {
  if (plan.levels) continue;
  const levels = shuffle([1000, 2000, 3000, 4000]);
  plan.levels = levels.slice(0, int(2, 3)).sort();
}

// ---------- Sections and meeting times ----------

const SLOTS: [MeetingTimeRow['day_of_week'][], string, string][] = [
  [['Mon', 'Wed'], '08:30', '09:45'], [['Mon', 'Wed'], '10:00', '11:15'], [['Mon', 'Wed'], '11:30', '12:45'],
  [['Mon', 'Wed'], '13:00', '14:15'], [['Mon', 'Wed'], '14:30', '15:45'], [['Mon', 'Wed'], '16:00', '17:15'],
  [['Tue', 'Thu'], '08:30', '09:45'], [['Tue', 'Thu'], '10:00', '11:15'], [['Tue', 'Thu'], '11:30', '12:45'],
  [['Tue', 'Thu'], '13:00', '14:15'], [['Tue', 'Thu'], '14:30', '15:45'], [['Tue', 'Thu'], '16:00', '17:15'],
  [['Mon', 'Wed', 'Fri'], '09:00', '09:50'], [['Mon', 'Wed', 'Fri'], '12:00', '12:50'],
];
const ROOMS = ['ECSS 2.410', 'ECSS 2.412', 'ECSW 1.315', 'ECSW 1.365', 'SCI 1.220', 'JO 4.102', 'GR 2.530', 'SLC 1.102', 'CB 1.106'];

// Enrollment (not in the entity list yet; the E2 frame shows it) comes from a hash of the
// section id rather than rand(), so adding it changed no other generated detail. Ranges shrink
// with the course level, like real lower-division and graduate sections. The Figma's E2
// sections keep their counts.
const FIGMA_ENROLLMENT: Record<string, number> = { 'FA26-1337-002': 52, 'FA26-3345-001': 60 };
const ENROLLMENT_RANGE: Record<number, [number, number]> = { 1000: [45, 75], 2000: [40, 65], 3000: [35, 60], 4000: [25, 50], 6000: [15, 40] };
function enrollmentOf(sectionId: string, level: number) {
  if (FIGMA_ENROLLMENT[sectionId]) return FIGMA_ENROLLMENT[sectionId];
  let h = 0;
  for (const ch of sectionId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [min, max] = ENROLLMENT_RANGE[level];
  return min + (h % (max - min + 1));
}

const sectionNums = new Map<string, number>();
function addSection(termId: string, netid: string, courseNum: string, sectionNum?: string, allowOnline = false): SectionRow {
  const key = `${termId}:${courseNum}`;
  const n = sectionNum ? Number(sectionNum) : (sectionNums.get(key) ?? 0) + 1;
  sectionNums.set(key, Math.max(n, sectionNums.get(key) ?? 0));
  const course = db.course.find((c) => c.course_num === courseNum)!;
  const row: SectionRow = {
    section_id: `${termId}-${courseNum}-${pad(n)}`,
    course_id: course.course_id,
    term_id: termId,
    section_num: pad(n),
    instructor_id: netid,
    class_mode: allowOnline && course.course_level === 6000 && rand() < 0.3 ? 'online' : 'in-person',
    enrollment: enrollmentOf(`${termId}-${courseNum}-${pad(n)}`, course.course_level),
  };
  db.section.push(row);
  const [days, start, end] = pick(SLOTS);
  const room = pick(ROOMS);
  for (const day of days) {
    db.meeting_time.push({ section_id: row.section_id, day_of_week: day, start_time: start, end_time: end, room: row.class_mode === 'online' ? 'Online' : room });
  }
  return row;
}

for (const termId of TEACHING_TERMS) {
  for (const prof of db.professor) {
    const plan = planOf.get(prof.netid)!;
    const fixed = termId === 'FA26' ? plan.fa26Sections : termId === 'FA24' ? plan.fa24Sections : undefined;
    if (fixed) {
      for (const [num, sec] of fixed) addSection(termId, prof.netid, num, sec);
      continue;
    }
    if (plan.name === 'Chidi Okafor' && termId !== 'FA26') continue; // new hire, first semester is FA26
    const picks = shuffle(plan.levels!.flatMap(coursesAt)).slice(0, 2);
    picks.forEach((c, i) => addSection(termId, prof.netid, c.course_num, undefined, i > 0));
  }
}

const sectionsOf = (netid: string, termId: string) =>
  db.section.filter((s) => s.instructor_id === netid && s.term_id === termId && s.class_mode === 'in-person');
const meetingsOf = (sectionId: string) => db.meeting_time.filter((m) => m.section_id === sectionId);

/** Three class-meeting dates inside the observation window for a section. */
function proposeDates(sectionId: string, from: string, to: string): string[] {
  const days = new Set<string>(meetingsOf(sectionId).map((m) => m.day_of_week));
  const options: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (days.has(weekdayOf(d))) options.push(d);
  if (options.length <= 3) return options;
  const third = Math.floor(options.length / 3);
  return [options[int(0, third - 1)], options[int(third, 2 * third - 1)], options[int(2 * third, options.length - 1)]];
}

// ---------- Observation template versions ----------

const versions: [string, number, 'draft' | 'live' | 'retired', string, string, string, string | null][] = [
  ['TV-1', 1, 'retired', 'First version of the observation form.', 'Susan Wright', '2024-07-29', '2024-08-05'],
  ['TV-2', 2, 'live', 'Added Use of class time.', 'Linda Chen', '2026-07-20', '2026-08-01'],
  ['TV-3', 3, 'draft', 'Reworded Organization and clarity.', 'Linda Chen', '2026-09-02', null],
];
// Each version follows its change note: v2 adds Use of class time, v3 rewords question 2.
const TV1: [string, string][] = [
  ['Content knowledge', 'Accurate, current command of the subject.'],
  ['Organization and clarity', 'Clear, logical order and pacing.'],
  ['Student engagement', 'Students take part in questions and tasks.'],
];
const TV2: [string, string][] = [...TV1, ['Use of class time', 'Starts on time and uses the period well.']];
const TV3 = TV2.map((q, i): [string, string] => (i === 1 ? ['Organization and clarity', 'Clear structure, logical order and steady pacing.'] : q));
const QUESTIONS: Record<string, [string, string][]> = { 'TV-1': TV1, 'TV-2': TV2, 'TV-3': TV3 };
for (const [version_id, version_no, status, change_note, author, created_date, published_date] of versions) {
  if (created_date > TODAY) continue;
  db.template_version.push({ version_id, version_no, status, change_note, created_by: P(author).netid, created_date, published_date });
  db.template_question.push(
    ...QUESTIONS[version_id].map(([title, wording], i) => ({
      question_id: `${version_id}-Q${i + 1}`, version_id, order_no: i + 1, title, wording,
      rating_min: 1, rating_max: 5, min_label: 'Needs work', max_label: 'Excellent', is_required: true,
    })),
  );
}
const versionFor = (date: string) => (date >= '2026-08-01' ? 'TV-2' : 'TV-1');

const COMMENTS = [
  'Explained each step before moving on.', 'Good use of worked examples on the board.', 'Checked for questions regularly.',
  'Pacing slowed a little near the end.', 'Students were comfortable asking questions.', 'Clear link back to last week.',
  'Handled a tricky question well.', 'Slides were easy to follow.', 'Group activity kept everyone involved.',
  'Started on time and used the full period.', 'Could pause more for students to try problems.', 'Strong command of the material.',
];
const OTHER_COMMENTS = ['', '', 'A well-prepared session overall.', 'Would be worth sharing the activity with colleagues.', 'Thanks for having me in class.'];

// ---------- Cycle simulation ----------

const cycleDates: Record<string, [string, string, string, string]> = {
  FA24: ['2024-08-28', '2024-09-16', '2024-11-01', '2024-11-15'],
  SP25: ['2025-01-27', '2025-02-14', '2025-04-30', '2025-05-15'],
  FA25: ['2025-09-02', '2025-09-15', '2025-11-01', '2025-11-14'],
  SP26: ['2026-01-26', '2026-02-16', '2026-04-30', '2026-05-15'],
  FA26: ['2026-08-26', '2026-09-15', '2026-11-01', '2026-11-15'],
};
const STARTED_BY: Record<string, string> = { FA24: 'Susan Wright', SP25: 'Susan Wright', FA25: 'Michael Brennan', SP26: 'Linda Chen', FA26: 'Linda Chen' };

let notificationNo = 0;
const notify = (cycleId: string, recipient: string, type: NotificationRow['notif_type'], subject: string, sent_date: string, sentBy: string | null) => {
  if (sent_date > NOW) return;
  db.notification.push({ notification_id: `N-${pad(++notificationNo, 5)}`, cycle_id: cycleId, recipient_netid: recipient, sent_by: sentBy, notif_type: type, subject, sent_date });
};
const at = (date: string, hour: number) => `${date}T${String(hour).padStart(2, '0')}:00:00.000Z`;

interface CycleSpec {
  termId: string;
  /** netids who were due this cycle */
  due: string[];
  dueStatusOf?: (netid: string) => 'due' | 'overdue';
  /** netid -> sign-up date (missing means they never sign up) */
  signupDates: Map<string, string>;
  /** observee netid -> observer netid that should win (keeps Figma stories true) */
  forcedObserver?: Map<string, string>;
  failures?: Map<string, NonNullable<Plan['failed']>>;
  /** observee netid whose confirmed observation does not happen */
  missed?: Set<string>;
  /** Closed cycles: everyone who completed then must end up paired. */
  mustPair?: boolean;
}

function simulateCycle(spec: CycleSpec) {
  const [start, signupDeadline, obsDeadline, feedbackDeadline] = cycleDates[spec.termId];
  if (start > TODAY) return;
  const cycle: EvalCycleRow = {
    cycle_id: `C-${spec.termId}`, term_id: spec.termId, started_by: P(STARTED_BY[spec.termId]).netid,
    start_date: start, signup_deadline: signupDeadline, observation_deadline: obsDeadline, feedback_deadline: feedbackDeadline,
  };
  db.eval_cycle.push(cycle);
  const id = spec.termId;

  for (const netid of spec.due) {
    db.eval_due.push({ cycle_id: cycle.cycle_id, netid, due_status: spec.dueStatusOf?.(netid) ?? 'due' });
    notify(cycle.cycle_id, netid, 'due_notice', `You are due for a teaching observation this semester (${id})`, at(start, 15), cycle.started_by);
  }

  // Sign-ups, each with three proposed class dates in the observation window.
  let signupNo = 0;
  const windowFrom = addDays(signupDeadline, 6);
  const windowTo = addDays(obsDeadline, -2);
  const signups: SignupRow[] = [];
  for (const [netid, date] of [...spec.signupDates].sort((a, b) => a[1].localeCompare(b[1]))) {
    if (date > TODAY) continue;
    const section = sectionsOf(netid, id)[0];
    const row: SignupRow = { signup_id: `SU-${id}-${pad(++signupNo)}`, cycle_id: cycle.cycle_id, observee_netid: netid, section_id: section.section_id, submit_date: date };
    db.sign_up.push(row);
    signups.push(row);
    for (const d of proposeDates(section.section_id, windowFrom, windowTo)) db.proposed_date.push({ signup_id: row.signup_id, date: d });
  }

  // Run observer selection the day after the sign-up deadline (round 1, up to 5 each).
  const matchDate = addDays(signupDeadline, 1);
  if (matchDate > TODAY) return;
  let alertNo = 0;
  const raiseAlert = (signupId: string, type: AlertRow['alert_type'], created: string) => {
    if (created > NOW) return;
    db.alert.push({ alert_id: `AL-${id}-${pad(++alertNo)}`, signup_id: signupId, alert_type: type, created_date: created, resolved_by: null, resolved_date: null, resolution_note: null });
  };
  const candidates = new Map<string, string[]>();
  for (const s of signups) {
    let list = eligibleObservers(db, s);
    if (spec.mustPair && list.length === 0 && !spec.failures?.has(s.observee_netid)) {
      for (const other of sectionsOf(s.observee_netid, id)) {
        s.section_id = other.section_id;
        list = eligibleObservers(db, s);
        if (list.length) break;
      }
      db.proposed_date = db.proposed_date.filter((p) => p.signup_id !== s.signup_id);
      for (const d of proposeDates(s.section_id, windowFrom, windowTo)) db.proposed_date.push({ signup_id: s.signup_id, date: d });
      if (!list.length) throw new Error(`${nameOf(s.observee_netid)} completed in ${id} in the plan but no section has an eligible observer`);
    }
    const forced = spec.forcedObserver?.get(s.observee_netid);
    if (forced && !list.includes(forced)) list = [forced, ...list].slice(0, MAX_CANDIDATES);
    candidates.set(s.signup_id, list);
    for (const netid of list) db.observer_match.push({ signup_id: s.signup_id, observer_netid: netid, generated_date: at(matchDate, 14), round_no: 1 });
    const alert = alertFor(list.length);
    if (alert) raiseAlert(s.signup_id, alert, at(matchDate, 14));
  }
  const listsReady = addDays(matchDate, 1);
  for (const s of signups) notify(cycle.cycle_id, s.observee_netid, 'matches_ready', 'Your observer list is ready', at(listsReady, 9), cycle.started_by);

  // Observees send requests to every candidate; candidates answer within 48 hours or the
  // request expires. The first to accept is paired and the rest are cancelled.
  type Event = { signup: SignupRow; observer: string; sent: string; respond: string | null; accept: boolean };
  const winners = new Map<string, string>();
  if (spec.mustPair) {
    const load = new Map<string, number>();
    const completers = signups.filter((s) => !spec.failures?.has(s.observee_netid));
    for (const s of [...completers].sort((a, b) => candidates.get(a.signup_id)!.length - candidates.get(b.signup_id)!.length)) {
      const forced = spec.forcedObserver?.get(s.observee_netid);
      const open = candidates.get(s.signup_id)!.filter((n) => (load.get(n) ?? 0) < MAX_ACCEPTED);
      const winner = forced ?? shuffle(open).sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0))[0];
      if (!winner) throw new Error(`${nameOf(s.observee_netid)} has no observer under the ${MAX_ACCEPTED}-observation limit in ${id}`);
      winners.set(s.signup_id, winner);
      load.set(winner, (load.get(winner) ?? 0) + 1);
    }
  }
  const events: Event[] = [];
  for (const s of signups) {
    const sent = addHours(at(listsReady, 9), int(0, 9));
    const failure = spec.failures?.get(s.observee_netid);
    const winner = winners.get(s.signup_id);
    const winnerAt = int(4, 30);
    for (const observer of candidates.get(s.signup_id)!) {
      if (winner) {
        // Before the winner answers, some others decline; anyone still pending is cancelled.
        const declines = observer !== winner && rand() < 0.4;
        const respond = observer === winner ? addHours(sent, winnerAt) : declines ? addHours(sent, int(1, winnerAt - 1)) : null;
        events.push({ signup: s, observer, sent, respond, accept: observer === winner });
        continue;
      }
      const respondsIn = int(3, 60);
      const respond = failure === 'no_acceptance' || respondsIn > REQUEST_HOURS ? null : addHours(sent, respondsIn);
      events.push({ signup: s, observer, sent, respond, accept: !failure && rand() < 0.55 });
    }
  }
  const requestRow = (e: Event) => db.observation_request.find((r) => r.signup_id === e.signup.signup_id && r.observer_netid === e.observer);
  for (const e of events) {
    if (e.sent > NOW) continue;
    db.observation_request.push({ signup_id: e.signup.signup_id, observer_netid: e.observer, status: 'pending', sent_date: e.sent, responded_date: null });
    notify(cycle.cycle_id, e.observer, 'observation_request', `Observation request from ${nameOf(e.signup.observee_netid)}`, e.sent, e.signup.observee_netid);
  }

  let obsNo = 0;
  const paired = new Set<string>();
  const ordered = events.filter((e) => e.respond && e.respond <= NOW).sort((a, b) => a.respond!.localeCompare(b.respond!));
  for (const e of ordered) {
    const req = requestRow(e)!;
    if (req.status !== 'pending') continue;
    if (!e.accept || acceptedCount(db, e.observer, cycle.cycle_id) >= MAX_ACCEPTED) {
      req.status = 'declined';
      req.responded_date = e.respond;
      continue;
    }
    req.status = 'accepted';
    req.responded_date = e.respond;
    paired.add(e.signup.signup_id);
    for (const other of db.observation_request.filter((r) => r.signup_id === e.signup.signup_id && r.status === 'pending')) {
      other.status = 'cancelled';
      notify(cycle.cycle_id, other.observer_netid, 'request_cancelled', `${nameOf(e.signup.observee_netid)} was paired with another colleague`, e.respond!, null);
    }

    // The observation is the first proposed date at least two days after accepting.
    const dates = db.proposed_date.filter((p) => p.signup_id === e.signup.signup_id).map((p) => p.date);
    const date = dates.find((d) => d >= addDays(e.respond!.slice(0, 10), 2)) ?? dates[dates.length - 1];
    const missed = spec.missed?.has(e.signup.observee_netid) ?? false;
    const happened = date < TODAY;
    const observerSigned = happened && !missed && addDays(date, 1) <= TODAY ? addDays(date, 1) : null;
    const observeeSigned = observerSigned && addDays(date, 3) <= TODAY ? addDays(date, 3) : null;
    const row: ObservationRow = {
      observation_id: `OB-${id}-${pad(++obsNo)}`,
      signup_id: e.signup.signup_id,
      observer_netid: e.observer,
      version_id: versionFor(date),
      scheduled_date: date,
      status: !happened ? 'scheduled' : missed ? 'not_completed' : observerSigned ? 'completed' : 'scheduled',
      observee_signed_date: observeeSigned,
      observer_signed_date: observerSigned,
      reason_not_completed: missed && happened ? 'Class was cancelled that day and could not be rescheduled before the deadline.' : null,
      issue_file_key: null,
      other_comments: observerSigned ? pick(OTHER_COMMENTS) : '',
      last_saved_date: observerSigned,
    };
    db.observation.push(row);
    if (observerSigned) {
      for (const q of db.template_question.filter((x) => x.version_id === row.version_id)) {
        db.observation_answer.push({ observation_id: row.observation_id, question_id: q.question_id, rating: pick([3, 4, 4, 4, 5, 5]), comment: pick(COMMENTS) });
      }
    }
  }
  for (const e of events) {
    const req = requestRow(e);
    if (req?.status === 'pending' && requestExpiresAt(e.sent) <= NOW) req.status = 'expired';
  }
  for (const s of signups) {
    const sent = events.find((e) => e.signup === s)?.sent;
    if (sent && !paired.has(s.signup_id) && requestExpiresAt(sent) <= NOW) raiseAlert(s.signup_id, 'no_acceptance', requestExpiresAt(sent));
  }

  // End-of-process survey, then KPIs the day after the feedback deadline.
  const surveyOpens = surveyOpensDate(cycle);
  for (const s of signups) notify(cycle.cycle_id, s.observee_netid, 'survey_open', 'The end-of-process survey is open', at(surveyOpens, 9), cycle.started_by);
  let responseNo = 0;
  for (const s of signups) {
    if (rand() > 0.82) continue;
    const date = addDays(surveyOpens, int(0, 13));
    if (date > TODAY || date > feedbackDeadline) continue;
    const ok = rand() < 0.85;
    db.survey_response.push({
      response_id: `SR-${id}-${pad(++responseNo)}`, cycle_id: cycle.cycle_id, respondent_id: s.observee_netid,
      respondent_role: 'observee', process_ok: ok,
      difficulties: ok ? '' : pick(['Hard to find a time that worked for both of us.', 'The request expired before I saw the email.']),
      additional_feedback: pick(['', '', 'Smooth process this time.', 'The observer list came quickly.']),
      trouble_file_key: null, submitted_date: date,
    });
  }
  const kpiDate = addDays(feedbackDeadline, 1);
  if (kpiDate <= TODAY) db.kpi_result.push(...computeKpis(db, cycle.cycle_id, kpiDate));
}

function nameOf(netid: string) {
  return displayName(db.professor.find((x) => x.netid === netid)!);
}

// Closed cycles: everyone whose last observation is in that term completed it then.
for (const termId of ['FA24', 'SP25', 'FA25', 'SP26']) {
  const completers = plans.filter((p) => p.last === termId).map((p) => P(p.name).netid);
  const failures = new Map<string, NonNullable<Plan['failed']>>();
  if (termId === 'SP26') for (const p of plans) if (p.failed) failures.set(P(p.name).netid, p.failed);
  const due = [...completers, ...failures.keys()];
  const signupDates = new Map<string, string>();
  for (const netid of due) {
    if (failures.get(netid) === 'no_signup') continue;
    signupDates.set(netid, addDays(cycleDates[termId][0], int(1, 16)));
  }
  simulateCycle({
    termId,
    due,
    signupDates,
    forcedObserver: termId === 'FA24' ? new Map([[P('Maya Lin').netid, P('Omar Haddad').netid]]) : undefined,
    failures,
    missed: new Set([...failures].filter(([, f]) => f === 'not_completed').map(([n]) => n)),
    mustPair: true,
  });
}

// Current cycle: who is due comes from the same rules the app uses.
const fa26Status = new Map(db.professor.map((p) => [p.netid, dueStatus(db, p, 'FA26')]));
const fa26Due = db.professor.filter((p) => fa26Status.get(p.netid) !== 'NOT_DUE');
const counts = { DUE: 0, OVERDUE: 0 };
for (const p of fa26Due) counts[fa26Status.get(p.netid) as 'DUE' | 'OVERDUE']++;
for (const plan of plans) {
  const got = fa26Status.get(P(plan.name).netid);
  if (got !== plan.target) throw new Error(`${plan.name}: expected ${plan.target} in FA26, rules say ${got}`);
}
const fa26Signups = new Map<string, string>();
for (const p of fa26Due) {
  const plan = planOf.get(p.netid)!;
  if (plan.fa26Signup === null) continue;
  fa26Signups.set(p.netid, plan.fa26Signup ?? addDays('2026-08-26', int(1, 20)));
}
simulateCycle({
  termId: 'FA26',
  due: fa26Due.map((p) => p.netid),
  dueStatusOf: (netid) => (fa26Status.get(netid) === 'OVERDUE' ? 'overdue' : 'due'),
  signupDates: fa26Signups,
  missed: new Set([P('Kevin Liu').netid]),
});

// ---------- Write ----------

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(db, null, 1)}\n`);

console.log(`Dummy data for ${TODAY} (seed ${SEED}) -> ${OUT}`);
console.log(`  ${db.professor.length} faculty (${db.ac_member.filter((a) => a.is_active).length} active AC), ${db.section.length} sections in ${TEACHING_TERMS.length} terms`);
console.log(`  FA26: ${counts.DUE} DUE, ${counts.OVERDUE} OVERDUE, ${db.professor.length - fa26Due.length} NOT DUE`);
for (const c of db.eval_cycle) {
  const su = db.sign_up.filter((s) => s.cycle_id === c.cycle_id);
  const ob = db.observation.filter((o) => su.some((s) => s.signup_id === o.signup_id));
  const kpis = db.kpi_result.filter((k) => k.cycle_id === c.cycle_id).length ? 'KPIs generated' : 'no KPIs yet';
  console.log(`  ${c.term_id}: ${db.eval_due.filter((d) => d.cycle_id === c.cycle_id).length} due, ${su.length} sign-ups, ${ob.length} observations, ${db.alert.filter((a) => su.some((s) => s.signup_id === a.signup_id)).length} alerts, ${kpis}`);
}
console.log(`  demo logins: ${['Maya Lin', 'Elena Ruiz', 'Linda Chen'].map((n) => P(n).email).join(', ')}`);
