import { getPool } from '../db/pool.js';
import { ApiError } from '../middleware/error.middleware.js';
import { mapCourseRows } from './course.service.js';
import type { AuthUser, Rank } from './user.service.js';

type ObservationStatus = 'scheduled' | 'completed' | 'not_completed';
type CourseRow = Parameters<typeof mapCourseRows>[0][number];
type CourseSection = ReturnType<typeof mapCourseRows>[number];

export interface FormAnswer {
  questionId: string;
  rating: number;
  comment: string;
}

interface QuestionRow {
  question_id: number;
  title: string;
  wording: string;
  rating_min: number;
  rating_max: number;
  is_required: boolean;
}

interface ObservationRow {
  observation_id: number;
  signup_id: number;
  scheduled_date: string;
  status: ObservationStatus;
  observee_signed_date: string | null;
  observer_signed_date: string | null;
  section_id: number;
  version_id: number;
  version_no: number;
  other_comments: string | null;
  reason_not_completed: string | null;
  issue_file_key: string | null;
  term_id: number;
  season: 'fall' | 'spring';
  year: number;
  start_date: string;
  end_date: string;
  observer_netid: string;
  observer_first_name: string;
  observer_last_name: string;
  observer_rank: Rank;
  observee_netid: string;
  observee_first_name: string;
  observee_last_name: string;
  observee_rank: Rank;
}

function person(netid: string, firstName: string, lastName: string, rank: Rank) {
  return { netid, firstName, lastName, displayName: `Dr. ${firstName} ${lastName}`, rank };
}

async function loadSections(sectionIds: number[]): Promise<Map<string, CourseSection>> {
  if (sectionIds.length === 0) return new Map();
  const { rows } = await getPool().query<CourseRow>(`
    SELECT s.section_id, s.section_num, s.class_mode,
           c.course_num, c.title, c.course_level, d.dept_name,
           t.term_id, t.season, t.year,
           t.start_date::text, t.end_date::text,
           m.day_of_week, m.start_time::text, m.end_time::text, m.room
    FROM section AS s
    JOIN course AS c ON c.course_id = s.course_id
    JOIN department AS d ON d.dept_id = c.dept_id
    JOIN term AS t ON t.term_id = s.term_id
    LEFT JOIN meeting_time AS m ON m.section_id = s.section_id
    WHERE s.section_id = ANY($1::int[])
    ORDER BY s.section_id, m.day_of_week, m.start_time
  `, [sectionIds]);
  return new Map(mapCourseRows(rows).map((section) => [section.sectionId, section]));
}

async function fetchObservations(where: string, params: unknown[]) {
  const { rows } = await getPool().query<ObservationRow>(`
    SELECT o.observation_id, o.signup_id, o.scheduled_date::text, o.status,
           o.observee_signed_date::date::text AS observee_signed_date,
           o.observer_signed_date::date::text AS observer_signed_date,
           s.section_id, o.version_id, v.version_no,
           o.other_comments, o.reason_not_completed, o.issue_file_key,
           t.term_id, t.season, t.year, t.start_date::text, t.end_date::text,
           obs.netid AS observer_netid, obs.first_name AS observer_first_name,
           obs.last_name AS observer_last_name, obs.rank AS observer_rank,
           ee.netid AS observee_netid, ee.first_name AS observee_first_name,
           ee.last_name AS observee_last_name, ee.rank AS observee_rank
    FROM observation AS o
    JOIN sign_up AS s ON s.signup_id = o.signup_id
    JOIN eval_cycle AS c ON c.cycle_id = s.cycle_id
    JOIN term AS t ON t.term_id = c.term_id
    JOIN template_version AS v ON v.version_id = o.version_id
    JOIN professor AS obs ON obs.netid = o.observer_netid
    JOIN professor AS ee ON ee.netid = s.observee_netid
    WHERE ${where}
    ORDER BY o.scheduled_date DESC, o.observation_id DESC
  `, params);
  const sections = await loadSections([...new Set(rows.map((row) => row.section_id))]);
  return rows.map((row) => {
    const section = sections.get(String(row.section_id));
    if (!section) throw new Error('The observation section is unavailable.');
    return { row, section };
  });
}

function summary(row: ObservationRow, section: CourseSection) {
  return {
    observationId: String(row.observation_id),
    term: {
      termId: String(row.term_id),
      season: row.season,
      year: row.year,
      label: `${row.season === 'fall' ? 'Fall' : 'Spring'} ${row.year}`,
      startDate: row.start_date,
      endDate: row.end_date,
    },
    observer: person(row.observer_netid, row.observer_first_name, row.observer_last_name, row.observer_rank),
    observee: person(row.observee_netid, row.observee_first_name, row.observee_last_name, row.observee_rank),
    section,
    scheduledDate: row.scheduled_date,
    status: row.status,
    observeeSignedDate: row.observee_signed_date,
    observerSignedDate: row.observer_signed_date,
  };
}

// GET /api/me/assignments: observations I am the observer for, latest date first.
export async function listAssignments(netid: string) {
  return (await fetchObservations('o.observer_netid = $1', [netid])).map(({ row, section }) => summary(row, section));
}

// Only the observer and the observee can see an observation; anyone else gets 404.
async function findObservation(observationId: number, user: AuthUser) {
  const [found] = await fetchObservations('o.observation_id = $1', [observationId]);
  if (!found || (found.row.observer_netid !== user.netid && found.row.observee_netid !== user.netid)) {
    throw new ApiError(404, 'NOT_FOUND', 'Observation not found.');
  }
  return found;
}

// GET /api/observations/{observationId}
export async function getObservation(observationId: number, user: AuthUser) {
  const { row, section } = await findObservation(observationId, user);
  const answers = await getPool().query<QuestionRow & { rating: number | null; comment: string | null }>(`
    SELECT q.question_id, q.title, q.wording, q.rating_min, q.rating_max, q.is_required, a.rating, a.comment
    FROM template_question AS q
    LEFT JOIN observation_answer AS a ON a.question_id = q.question_id AND a.observation_id = $1
    WHERE q.version_id = $2
    ORDER BY q.order_no
  `, [observationId, row.version_id]);
  return {
    ...summary(row, section),
    templateVersion: { versionId: String(row.version_id), versionNo: row.version_no },
    answers: answers.rows.map((answer) => ({
      questionId: String(answer.question_id),
      title: answer.title,
      wording: answer.wording,
      rating: answer.rating,
      comment: answer.comment ?? '',
    })),
    otherComments: row.other_comments ?? '',
    reasonNotCompleted: row.reason_not_completed,
    issueFileName: row.issue_file_key ? row.issue_file_key.split('/').pop()! : null,
  };
}

// Every required question needs a rating in range, and every answer must belong to this form.
export function checkAnswers(questions: QuestionRow[], answers: FormAnswer[]) {
  const byId = new Map(questions.map((question) => [String(question.question_id), question]));
  const seen = new Set<string>();
  for (const answer of answers) {
    const question = byId.get(answer.questionId);
    if (!question || seen.has(answer.questionId)) {
      throw new ApiError(400, 'INVALID_ANSWERS', 'Each answer must be for a different question on this form.');
    }
    seen.add(answer.questionId);
    if (!Number.isInteger(answer.rating) || answer.rating < question.rating_min || answer.rating > question.rating_max) {
      throw new ApiError(400, 'INVALID_ANSWERS', `Rate "${question.title}" from ${question.rating_min} to ${question.rating_max}.`);
    }
  }
  const missing = questions.filter((question) => question.is_required && !seen.has(String(question.question_id)));
  if (missing.length) {
    throw new ApiError(400, 'ANSWERS_REQUIRED', `Rate every question (missing: ${missing.map((question) => question.title).join(', ')}).`);
  }
}

// POST /api/observations/{observationId}/signed-form: the observer fills in the form.
// Submitting the form is the observer's signature; the observee signs next.
export async function submitSignedForm(observationId: number, user: AuthUser, answers: FormAnswer[], otherComments: string) {
  const { row } = await findObservation(observationId, user);
  if (row.observer_netid !== user.netid) {
    throw new ApiError(403, 'FORBIDDEN', 'Only the observer fills in the observation form.');
  }
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<{ status: ObservationStatus; observee_signed_date: Date | null }>(
      'SELECT status, observee_signed_date FROM observation WHERE observation_id = $1 FOR UPDATE', [observationId]);
    if (current.rows[0].observee_signed_date) throw new ApiError(409, 'LOCKED', 'This record is signed by both and locked.');
    if (current.rows[0].status !== 'scheduled') throw new ApiError(409, 'NOT_SCHEDULED', 'Only a scheduled observation can be filled in.');

    const questions = await client.query<QuestionRow>(`
      SELECT question_id, title, wording, rating_min, rating_max, is_required
      FROM template_question WHERE version_id = $1 ORDER BY order_no
    `, [row.version_id]);
    checkAnswers(questions.rows, answers);

    await client.query('DELETE FROM observation_answer WHERE observation_id = $1', [observationId]);
    for (const answer of answers) {
      await client.query(`
        INSERT INTO observation_answer (observation_id, question_id, rating, comment)
        VALUES ($1, $2, $3, $4)
      `, [observationId, Number(answer.questionId), answer.rating, answer.comment]);
    }
    await client.query(`
      UPDATE observation
      SET other_comments = $2, observer_signature = $3, observer_signed_date = now(), last_saved_date = now()
      WHERE observation_id = $1
    `, [observationId, otherComments, user.displayName]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return getObservation(observationId, user);
}

// POST /api/observations/{observationId}/sign: the observee signs after the observer.
// Both signatures complete and lock the record.
export async function signObservation(observationId: number, user: AuthUser) {
  const { row } = await findObservation(observationId, user);
  if (row.observee_netid !== user.netid) {
    throw new ApiError(403, 'FORBIDDEN', 'The observer signs by submitting the form.');
  }
  const updated = await getPool().query(`
    UPDATE observation
    SET observee_signature = $2, observee_signed_date = now(), status = 'completed', last_saved_date = now()
    WHERE observation_id = $1 AND status = 'scheduled'
      AND observer_signed_date IS NOT NULL AND observee_signed_date IS NULL
  `, [observationId, user.displayName]);
  if (!updated.rowCount) {
    if (row.observee_signed_date) throw new ApiError(409, 'LOCKED', 'This record is signed by both and locked.');
    if (row.status !== 'scheduled') throw new ApiError(409, 'NOT_SCHEDULED', 'Only a scheduled observation can be signed.');
    throw new ApiError(409, 'FORM_NOT_SUBMITTED', 'The observer has not submitted the form yet.');
  }
  return getObservation(observationId, user);
}
