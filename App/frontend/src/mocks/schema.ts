// Row types for the dummy database, one per table in the team's entity list
// (Capstone_Project_Entities_and_Attributes, Oct 15). Column names match the DB exactly
// so the same data can later be loaded into PostgreSQL.

export interface ProfessorRow {
  netid: string;
  first_name: string;
  last_name: string;
  email: string;
  rank: 'assistant' | 'associate' | 'full';
  dept_id: string;
  eval_interval_years: number;
  baseline_last_eval_term: string | null;
  is_active: boolean;
}

export interface AcMemberRow {
  netid: string;
  is_active: boolean;
}

export interface DepartmentRow {
  dept_id: string;
  dept_name: string;
}

export interface CourseRow {
  course_id: string;
  dept_id: string;
  course_num: string;
  title: string;
  course_level: number;
}

export interface TermRow {
  term_id: string;
  season: 'fall' | 'spring';
  year: number;
  start_date: string;
  end_date: string;
}

export interface SectionRow {
  section_id: string;
  course_id: string;
  term_id: string;
  section_num: string;
  instructor_id: string;
  class_mode: 'in-person' | 'online';
  /** Not in the Oct 15 entity list: the E2 frame shows it ("52 students"). DB change. */
  enrollment: number | null;
}

export interface MeetingTimeRow {
  section_id: string;
  day_of_week: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri';
  start_time: string;
  end_time: string;
  room: string;
}

export interface EvalCycleRow {
  cycle_id: string;
  term_id: string;
  started_by: string;
  start_date: string;
  signup_deadline: string;
  observation_deadline: string;
  feedback_deadline: string;
}

export interface EvalDueRow {
  cycle_id: string;
  netid: string;
  due_status: 'due' | 'overdue';
}

export interface SignupRow {
  signup_id: string;
  cycle_id: string;
  observee_netid: string;
  section_id: string;
  submit_date: string;
}

export interface ObserverMatchRow {
  signup_id: string;
  observer_netid: string;
  /** A timestamp, so A4 can show "Ran Sep 16, 9:00 AM" (the entity list has a date). */
  generated_date: string;
  round_no: number;
}

export interface ObservationRequestRow {
  signup_id: string;
  observer_netid: string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
  sent_date: string;
  responded_date: string | null;
}

/** The observation time is the section's meeting time on that date. */
export interface ProposedDateRow {
  signup_id: string;
  date: string;
}

export interface NotificationRow {
  notification_id: string;
  cycle_id: string;
  recipient_netid: string;
  sent_by: string | null;
  notif_type: 'due_notice' | 'matches_ready' | 'observation_request' | 'request_cancelled' | 'survey_open' | 'reminder';
  subject: string;
  sent_date: string;
}

export interface AlertRow {
  alert_id: string;
  signup_id: string;
  alert_type: 'no_observer' | 'insufficient_observers' | 'no_acceptance';
  created_date: string;
  resolved_by: string | null;
  resolved_date: string | null;
  resolution_note: string | null;
}

export interface TemplateVersionRow {
  version_id: string;
  version_no: number;
  status: 'draft' | 'live' | 'retired';
  change_note: string;
  created_by: string;
  created_date: string;
  published_date: string | null;
}

export interface TemplateQuestionRow {
  question_id: string;
  version_id: string;
  order_no: number;
  title: string;
  wording: string;
  rating_min: number;
  rating_max: number;
  min_label: string;
  max_label: string;
  is_required: boolean;
}

export interface ObservationRow {
  observation_id: string;
  signup_id: string;
  observer_netid: string;
  version_id: string;
  scheduled_date: string;
  status: 'scheduled' | 'completed' | 'not_completed';
  observee_signed_date: string | null;
  observer_signed_date: string | null;
  reason_not_completed: string | null;
  issue_file_key: string | null;
  other_comments: string;
  last_saved_date: string | null;
}

export interface ObservationAnswerRow {
  observation_id: string;
  question_id: string;
  rating: number;
  comment: string;
}

export interface SurveyResponseRow {
  response_id: string;
  cycle_id: string;
  respondent_id: string;
  respondent_role: 'observer' | 'observee';
  process_ok: boolean;
  difficulties: string;
  additional_feedback: string;
  trouble_file_key: string | null;
  submitted_date: string;
}

/** Forwarded_observation: A6b "Forward a link", each forward recorded. */
export interface ForwardedObservationRow {
  forward_id: string;
  observation_id: string;
  recipient_email: string;
  shared_by: string;
  shared_date: string;
  link_token: string;
}

export interface KpiResultRow {
  cycle_id: string;
  kpi_code: '1.1' | '1.2' | '2.1' | '2.2' | '3.1' | '4.1' | '4.2';
  numerator: number;
  denominator: number;
  kpi_value: number | null;
  computed_date: string;
}

export interface Db {
  meta: {
    /** The "today" the data was generated for; the mock API treats this as the current date. */
    today: string;
    seed: number;
    generatedAt: string;
  };
  professor: ProfessorRow[];
  ac_member: AcMemberRow[];
  department: DepartmentRow[];
  course: CourseRow[];
  term: TermRow[];
  section: SectionRow[];
  meeting_time: MeetingTimeRow[];
  eval_cycle: EvalCycleRow[];
  eval_due: EvalDueRow[];
  sign_up: SignupRow[];
  observer_match: ObserverMatchRow[];
  observation_request: ObservationRequestRow[];
  proposed_date: ProposedDateRow[];
  notification: NotificationRow[];
  alert: AlertRow[];
  template_version: TemplateVersionRow[];
  template_question: TemplateQuestionRow[];
  observation: ObservationRow[];
  observation_answer: ObservationAnswerRow[];
  survey_response: SurveyResponseRow[];
  kpi_result: KpiResultRow[];
  forwarded_observation: ForwardedObservationRow[];
}
