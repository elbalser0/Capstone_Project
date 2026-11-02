// Request and response shapes for every endpoint in the team's API list (Weekly Report 6).
// Field names follow the Oct 15 entity list, in camelCase. The mock server in src/mocks and
// the Express backend should both return exactly these shapes.

export type Rank = 'assistant' | 'associate' | 'full';
export type Role = 'AC' | 'faculty';
export type DueStatus = 'NOT_DUE' | 'DUE' | 'OVERDUE';
export type Season = 'fall' | 'spring';
export type CyclePhase = 'signup' | 'matching' | 'observation' | 'feedback' | 'closed';
export type RequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
export type ObservationStatus = 'scheduled' | 'completed' | 'not_completed';
export type AlertType = 'no_observer' | 'insufficient_observers' | 'no_acceptance';
export type TemplateStatus = 'draft' | 'live' | 'retired';
export type KpiCode = '1.1' | '1.2' | '2.1' | '2.2' | '3.1' | '4.1' | '4.2';

/** ISO date, "2026-09-15" */
export type IsoDate = string;
/** ISO date-time, "2026-09-15T14:30:00Z" */
export type IsoDateTime = string;

export interface Term {
  termId: string;
  season: Season;
  year: number;
  /** "Fall 2026" */
  label: string;
  startDate: IsoDate;
  endDate: IsoDate;
}

export interface Department {
  deptId: string;
  deptName: string;
}

export interface PersonRef {
  netid: string;
  firstName: string;
  lastName: string;
  /** "Dr. Maya Lin" */
  displayName: string;
  rank: Rank;
}

export interface MeetingTime {
  dayOfWeek: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri';
  /** "08:30" */
  startTime: string;
  endTime: string;
  room: string;
}

export interface CourseSection {
  sectionId: string;
  /** "CS 1337.002" */
  label: string;
  courseNum: string;
  sectionNum: string;
  title: string;
  courseLevel: number;
  classMode: 'in-person' | 'online';
  /** Students enrolled (E2 "52 students"). Added for the Figma; needs a section.enrollment column. */
  enrollment?: number | null;
  term: Term;
  meetings: MeetingTime[];
}

export interface ProposedDate {
  date: IsoDate;
  /** The section's meeting time that day (read-only; the DB stores only the date). */
  startTime: string;
}

// ---------- Shared ----------

/** GET /api/me */
export interface Me {
  netid: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  rank: Rank;
  department: Department;
  /** "AC" means a professor who is also an active Assessment Committee member. */
  role: Role;
}

/** GET /api/me/notifications */
export interface Notification {
  notificationId: string;
  notifType: 'due_notice' | 'matches_ready' | 'observation_request' | 'request_cancelled' | 'survey_open' | 'reminder';
  subject: string;
  sentDate: IsoDateTime;
  sentBy: PersonRef | null;
}

// ---------- Cycles ----------

export interface Cycle {
  cycleId: string;
  term: Term;
  startedBy: PersonRef;
  startDate: IsoDate;
  signupDeadline: IsoDate;
  observationDeadline: IsoDate;
  /** Survey closes, then KPIs are generated. */
  feedbackDeadline: IsoDate;
  /** First day of the survey window (the day after the observation deadline). */
  surveyOpensDate: IsoDate;
  phase: CyclePhase;
}

/** POST /api/cycles */
export interface CreateCycleInput {
  termId: string;
  signupDeadline: IsoDate;
  observationDeadline: IsoDate;
  feedbackDeadline: IsoDate;
}

/** PATCH /api/cycles/{cycleId} */
export type UpdateCycleInput = Partial<Omit<CreateCycleInput, 'termId'>>;

/**
 * GET /api/cycles/{cycleId}/faculty (A3): every active professor, NOT_DUE included, with
 * DUE / OVERDUE as fixed at kickoff. GET /api/terms/{termId}/due-preview (A2, before a cycle
 * exists) returns the same rows computed from the rules.
 */
export interface FacultyStatus {
  professor: PersonRef & { email: string };
  department: Department;
  dueStatus: DueStatus;
  /** Last signed observation before this term. */
  lastObservedTerm: Term | null;
  dueTerm: Term;
}

/** GET /api/cycles/{cycleId}/due-professors */
export interface DueProfessor {
  professor: PersonRef;
  department: Department;
  dueStatus: Exclude<DueStatus, 'NOT_DUE'>;
  /** Last signed observation before this term. */
  lastObservedTerm: Term | null;
}

// ---------- Faculty: observee ----------

/** GET /api/me/evaluation-status */
export interface EvaluationStatus {
  status: DueStatus;
  rank: Rank;
  evalIntervalYears: number;
  /** Future due semesters may not have a term row or calendar dates yet. */
  dueTerm: Pick<Term, 'season' | 'year' | 'label'>;
  lastObservedTerm: Term | null;
  cycle: Cycle | null;
  /** True while the cycle's sign-up window is open and this professor is DUE or OVERDUE without a sign-up. */
  canSignUp: boolean;
  signupId: string | null;
}

/** POST /api/signups */
export interface CreateSignupInput {
  sectionId: string;
  proposedDates: IsoDate[];
}

/** GET /api/me/signup, and rows of GET /api/cycles/{cycleId}/signups */
export interface Signup {
  signupId: string;
  cycleId: string;
  observee: PersonRef & { email: string };
  section: CourseSection;
  proposedDates: ProposedDate[];
  submitDate: IsoDate;
  observation: {
    observationId: string;
    observer: PersonRef;
    status: ObservationStatus;
    /** A6 Date column. Added for the Figma. */
    scheduledDate?: IsoDate;
  } | null;
}

/** GET /api/signups/{signupId}/candidates */
export interface Candidate {
  observer: PersonRef;
  roundNo: number;
  request: { status: RequestStatus; sentDate: IsoDateTime } | null;
  /** E3 "Teaches": courses the observer taught in the two-year window, most recent first ("CS 1336"). */
  teaches?: string[];
  /** E3 "Free at your times": no class of their own at any of the proposed times. */
  freeAtProposedTimes?: boolean;
}

/** POST /api/signups/{signupId}/requests */
export interface SendRequestsInput {
  /** Omit to send to every candidate. */
  observerNetids?: string[];
}

/** GET /api/me/requests/outgoing, GET /api/me/requests/incoming */
export interface ObservationRequest {
  signupId: string;
  observer: PersonRef;
  observee: PersonRef;
  section: CourseSection;
  proposedDates: ProposedDate[];
  status: RequestStatus;
  sentDate: IsoDateTime;
  respondedDate: IsoDateTime | null;
  /** sentDate + 48 hours */
  expiresAt: IsoDateTime;
}

/** Rows of GET /api/me/observations?as=observee and GET /api/me/assignments */
export interface ObservationSummary {
  observationId: string;
  term: Term;
  observer: PersonRef;
  observee: PersonRef;
  section: CourseSection;
  scheduledDate: IsoDate;
  status: ObservationStatus;
  observeeSignedDate: IsoDate | null;
  observerSignedDate: IsoDate | null;
}

export interface ObservationAnswer {
  questionId: string;
  title: string;
  wording: string;
  /** The rating scale of this observation's template version (not necessarily the live one). */
  ratingMin: number;
  ratingMax: number;
  minLabel: string | null;
  maxLabel: string | null;
  isRequired: boolean;
  rating: number | null;
  comment: string;
}

/** GET /api/observations/{observationId} */
export interface ObservationDetail extends ObservationSummary {
  templateVersion: { versionId: string; versionNo: number };
  answers: ObservationAnswer[];
  otherComments: string;
  /** Send this back in POST .../sign so the observee signs the version they read (409 STALE_FORM otherwise). */
  lastSavedDate: IsoDateTime;
  reasonNotCompleted: string | null;
  /** File attached through "Upload a file about the observation" (E6), from observation.issue_file_key. */
  issueFileName?: string | null;
}

/** POST /api/observations/{observationId}/report-missed */
export interface ReportMissedInput {
  reason: string;
}

/** POST /api/cycles/{cycleId}/survey-responses */
export interface SurveyInput {
  respondentRole: 'observer' | 'observee';
  processOk: boolean;
  difficulties: string;
  additionalFeedback: string;
  troubleFile?: File;
}

// ---------- Faculty: observer ----------

/** PATCH /api/signups/{signupId}/requests/{observerNetId}/confirm */
export interface ConfirmRequestInput {
  /** One of the sign-up's proposed dates. */
  date: IsoDate;
}

/** POST /api/observations/{observationId}/signed-form */
export interface SignedFormInput {
  answers: { questionId: string; rating: number; comment: string }[];
  otherComments: string;
}

// ---------- Assessment Committee ----------

/** GET /api/cycles/{cycleId}/matching */
export interface MatchingRow {
  signupId: string;
  /** When observer selection last produced this list (A4 "Ran Sep 16, 9:00 AM"); observer_match.generated_date as a timestamp. */
  ranAt?: IsoDateTime | null;
  observee: PersonRef;
  section: CourseSection;
  candidates: PersonRef[];
  alert: { alertId: string; alertType: AlertType; createdDate: IsoDateTime } | null;
}

/** GET /api/cycles/{cycleId}/survey-responses */
export interface SurveyResponse {
  responseId: string;
  respondent: PersonRef;
  respondentRole: 'observer' | 'observee';
  processOk: boolean;
  difficulties: string;
  additionalFeedback: string;
  troubleFileKey: string | null;
  submittedDate: IsoDate;
}

export interface KpiResult {
  kpiCode: KpiCode;
  numerator: number;
  denominator: number;
  /** Rates are 0..1, counts and averages are plain numbers. null when there is nothing to divide by (shown as N/A). */
  kpiValue: number | null;
  computedDate: IsoDate;
}

/** GET /api/cycles/{cycleId}/kpis */
export interface CycleKpis {
  cycle: Cycle;
  computedDate: IsoDate | null;
  kpis: KpiResult[];
}

export type CountByRank = Record<Rank, number>;

/** GET /api/dashboard/due-by-rank */
export interface DueByRank {
  cycleId: string;
  total: number;
  byRank: CountByRank;
}

/** GET /api/dashboard/outstanding-observations */
export interface OutstandingObservations {
  cycleId: string;
  total: number;
  byRank: CountByRank;
  items: { signupId: string; observee: PersonRef; section: CourseSection; observationStatus: ObservationStatus | null }[];
}

/** GET /api/dashboard/unmatched */
export interface UnmatchedFaculty {
  cycleId: string;
  total: number;
  items: { signupId: string; observee: PersonRef; section: CourseSection; alertType: AlertType }[];
}

export interface TemplateQuestion {
  questionId: string;
  orderNo: number;
  title: string;
  wording: string;
  ratingMin: number;
  ratingMax: number;
  minLabel: string;
  maxLabel: string;
  isRequired: boolean;
}

/** GET /api/templates, GET /api/templates/active */
export interface TemplateVersion {
  versionId: string;
  versionNo: number;
  status: TemplateStatus;
  changeNote: string;
  createdBy: PersonRef;
  createdDate: IsoDate;
  publishedDate: IsoDate | null;
  observationsCount: number;
  questions: TemplateQuestion[];
}

/** POST /api/templates (creates a draft version) */
export interface CreateTemplateInput {
  changeNote: string;
  questions: Omit<TemplateQuestion, 'questionId'>[];
}

/** POST /api/cycles/{cycleId}/notifications/due-reminders. Omit netids to remind everyone due. */
export interface DueRemindersInput {
  netids?: string[];
}

/** POST /api/observations/{observationId}/forward: email a read-only link (A6b), recorded in Forwarded_observation. */
export interface ForwardInput {
  email: string;
}

export interface ForwardResult {
  forwardId: string;
  sharedDate: IsoDateTime;
}

/** POST /api/admin/import */
export interface ImportResult {
  imported: Record<'professor' | 'department' | 'course' | 'section' | 'meeting_time' | 'term', number>;
}

/** Error body from the backend: {"error":{"code":"...","message":"..."}} */
export interface ApiErrorBody {
  error: { code: string; message: string };
}
