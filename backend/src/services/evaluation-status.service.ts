import { getPool } from '../db/pool.js';
import { ApiError } from '../middleware/error.middleware.js';

type Rank = 'assistant' | 'associate' | 'full';
type DueStatus = 'NOT_DUE' | 'DUE' | 'OVERDUE';

interface TermRow {
  term_id: number;
  season: 'fall' | 'spring';
  year: number;
  start_date: string;
  end_date: string;
}

interface ProfessorStatusRow {
  rank: Rank;
  eval_interval_years: number;
  baseline_last_eval_term: number | null;
  start_term: number | null;
  last_completed_term_id: number | null;
  today: string;
}

interface CycleRow {
  cycle_id: number;
  term_id: number;
  started_by: string;
  start_date: string;
  signup_deadline: string;
  observation_deadline: string;
  feedback_deadline: string;
  first_name: string;
  last_name: string;
  rank: Rank;
  has_match: boolean;
  signup_id: number | null;
}

function term(row: TermRow) {
  return {
    termId: String(row.term_id),
    season: row.season,
    year: row.year,
    label: `${row.season === 'fall' ? 'Fall' : 'Spring'} ${row.year}`,
    startDate: row.start_date,
    endDate: row.end_date,
  };
}

function nextDay(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export function mapEvaluationStatus(professor: ProfessorStatusRow, terms: TermRow[], cycle: CycleRow | null) {
  if (terms.length === 0) throw new ApiError(503, 'TERM_DATA_UNAVAILABLE', 'No academic terms are available.');

  const today = professor.today;
  const currentTerm = cycle
    ? terms.find((row) => row.term_id === cycle.term_id)
    : (terms.find((row) => row.start_date <= today && today <= row.end_date)
      ?? terms.find((row) => row.start_date > today)
      ?? terms[terms.length - 1]);
  if (!currentTerm) throw new ApiError(503, 'TERM_DATA_UNAVAILABLE', 'The current academic term is unavailable.');

  const currentIndex = terms.indexOf(currentTerm);
  const lastTermId = professor.last_completed_term_id ?? professor.baseline_last_eval_term;
  const lastIndex = lastTermId === null ? -1 : terms.findIndex((row) => row.term_id === lastTermId);
  if (lastTermId !== null && lastIndex < 0) {
    throw new ApiError(503, 'TERM_DATA_UNAVAILABLE', 'The last evaluation term is unavailable.');
  }

  const startIndex = professor.start_term === null ? -1 : terms.findIndex((row) => row.term_id === professor.start_term);
  if (lastIndex < 0 && startIndex < 0) {
    throw new ApiError(503, 'TERM_DATA_UNAVAILABLE', 'The professor start term is unavailable.');
  }
  // First evaluation is due two years after starting; later evaluations use the rank interval.
  const dueIndex = lastIndex < 0 ? startIndex + 4 : lastIndex + professor.eval_interval_years * 2;
  if (dueIndex >= terms.length) {
    throw new ApiError(503, 'TERM_DATA_UNAVAILABLE', 'The next evaluation term is unavailable.');
  }
  const status: DueStatus = currentIndex < dueIndex ? 'NOT_DUE' : currentIndex === dueIndex ? 'DUE' : 'OVERDUE';

  let phase: 'signup' | 'matching' | 'observation' | 'feedback' | 'closed' | null = null;
  if (cycle) {
    if (today <= cycle.signup_deadline) phase = 'signup';
    else if (today <= cycle.observation_deadline) phase = cycle.has_match ? 'observation' : 'matching';
    else if (today <= cycle.feedback_deadline) phase = 'feedback';
    else phase = 'closed';
  }

  return {
    status,
    rank: professor.rank,
    evalIntervalYears: professor.eval_interval_years,
    dueTerm: term(terms[dueIndex]),
    lastObservedTerm: lastIndex < 0 ? null : term(terms[lastIndex]),
    cycle: cycle ? {
      cycleId: String(cycle.cycle_id),
      term: term(currentTerm),
      startedBy: {
        netid: cycle.started_by,
        firstName: cycle.first_name,
        lastName: cycle.last_name,
        displayName: `Dr. ${cycle.first_name} ${cycle.last_name}`,
        rank: cycle.rank,
      },
      startDate: cycle.start_date,
      signupDeadline: cycle.signup_deadline,
      observationDeadline: cycle.observation_deadline,
      feedbackDeadline: cycle.feedback_deadline,
      surveyOpensDate: nextDay(cycle.observation_deadline),
      phase,
    } : null,
    canSignUp: Boolean(cycle && status !== 'NOT_DUE' && cycle.signup_id === null && today <= cycle.signup_deadline),
    signupId: cycle?.signup_id == null ? null : String(cycle.signup_id),
  };
}

export async function getEvaluationStatus(netid: string) {
  const db = getPool();
  const [professorResult, termResult] = await Promise.all([
    db.query<ProfessorStatusRow>(`
      SELECT p.rank, p.eval_interval_years, p.baseline_last_eval_term, p.start_term,
             CURRENT_DATE::text AS today,
             (SELECT ec.term_id
              FROM observation AS o
              JOIN sign_up AS s ON s.signup_id = o.signup_id
              JOIN eval_cycle AS ec ON ec.cycle_id = s.cycle_id
              JOIN term AS t ON t.term_id = ec.term_id
              WHERE s.observee_netid = p.netid AND o.status = 'completed'
                AND o.observee_signed_date IS NOT NULL AND o.observer_signed_date IS NOT NULL
              ORDER BY t.start_date DESC LIMIT 1) AS last_completed_term_id
      FROM professor AS p
      WHERE p.netid = $1 AND p.is_active = true
    `, [netid]),
    db.query<TermRow>(`
      SELECT term_id, season, year, start_date::text, end_date::text
      FROM term ORDER BY start_date, term_id
    `),
  ]);
  const professor = professorResult.rows[0];
  if (!professor) throw new ApiError(403, 'NOT_A_PROFESSOR', 'This account is not linked to an active professor.');

  const { rows } = await db.query<CycleRow>(`
    SELECT c.cycle_id, c.term_id, c.started_by, c.start_date::text,
           c.signup_deadline::text, c.observation_deadline::text, c.feedback_deadline::text,
           p.first_name, p.last_name, p.rank, s.signup_id,
           EXISTS (SELECT 1 FROM observer_match AS m
                   JOIN sign_up AS ms ON ms.signup_id = m.signup_id
                   WHERE ms.cycle_id = c.cycle_id) AS has_match
    FROM eval_cycle AS c
    JOIN professor AS p ON p.netid = c.started_by
    LEFT JOIN sign_up AS s ON s.cycle_id = c.cycle_id AND s.observee_netid = $1
    WHERE c.start_date <= $2::date
    ORDER BY c.start_date DESC, c.cycle_id DESC
    LIMIT 1
  `, [netid, professor.today]);

  return mapEvaluationStatus(professor, termResult.rows, rows[0] ?? null);
}
