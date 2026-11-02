import { getPool } from '../db/pool.js';
import { inTransaction } from '../db/transaction.js';
import { ApiError } from '../middleware/error.middleware.js';
import { insertEvalDue } from './eval-due.service.js';
import type { Rank } from './user.service.js';

type Phase = 'signup' | 'matching' | 'observation' | 'feedback' | 'closed';

export interface Deadlines {
  signupDeadline: string;
  observationDeadline: string;
  feedbackDeadline: string;
}

interface CycleRow {
  cycle_id: number;
  term_id: number;
  season: 'fall' | 'spring';
  year: number;
  term_start: string;
  term_end: string;
  started_by: string;
  first_name: string;
  last_name: string;
  rank: Rank;
  start_date: string;
  signup_deadline: string;
  observation_deadline: string;
  feedback_deadline: string;
  has_match: boolean;
  today: string;
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function nextDay(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

// The deadlines must be in order: start <= signup <= observation <= feedback (same rule as the database).
export function checkDeadlineOrder(startDate: string, d: Deadlines) {
  if (!(startDate <= d.signupDeadline)) {
    throw new ApiError(400, 'INVALID_DEADLINES', 'The signup deadline cannot be before the cycle start date.');
  }
  if (!(d.signupDeadline <= d.observationDeadline && d.observationDeadline <= d.feedbackDeadline)) {
    throw new ApiError(400, 'INVALID_DEADLINES', 'Deadlines must be in order: signup, then observation, then feedback.');
  }
}

// Same phase rules as GET /api/me/evaluation-status.
export function cyclePhase(today: string, d: Deadlines, hasMatch: boolean): Phase {
  if (today <= d.signupDeadline) return 'signup';
  if (today <= d.observationDeadline) return hasMatch ? 'observation' : 'matching';
  if (today <= d.feedbackDeadline) return 'feedback';
  return 'closed';
}

export function mapCycle(row: CycleRow) {
  const deadlines = {
    signupDeadline: row.signup_deadline,
    observationDeadline: row.observation_deadline,
    feedbackDeadline: row.feedback_deadline,
  };
  return {
    cycleId: String(row.cycle_id),
    term: {
      termId: String(row.term_id),
      season: row.season,
      year: row.year,
      label: `${row.season === 'fall' ? 'Fall' : 'Spring'} ${row.year}`,
      startDate: row.term_start,
      endDate: row.term_end,
    },
    startedBy: {
      netid: row.started_by,
      firstName: row.first_name,
      lastName: row.last_name,
      displayName: `Dr. ${row.first_name} ${row.last_name}`,
      rank: row.rank,
    },
    startDate: row.start_date,
    ...deadlines,
    surveyOpensDate: nextDay(row.observation_deadline),
    phase: cyclePhase(row.today, deadlines, row.has_match),
  };
}

export async function fetchCycle(where: string, params: unknown[]) {
  const { rows } = await getPool().query<CycleRow>(`
    SELECT c.cycle_id, t.term_id, t.season, t.year,
           t.start_date::text AS term_start, t.end_date::text AS term_end,
           c.started_by, p.first_name, p.last_name, p.rank,
           c.start_date::text, c.signup_deadline::text,
           c.observation_deadline::text, c.feedback_deadline::text,
           EXISTS (SELECT 1 FROM observer_match AS m
                   JOIN sign_up AS s ON s.signup_id = m.signup_id
                   WHERE s.cycle_id = c.cycle_id) AS has_match,
           CURRENT_DATE::text AS today
    FROM eval_cycle AS c
    JOIN term AS t ON t.term_id = c.term_id
    JOIN professor AS p ON p.netid = c.started_by
    WHERE ${where}
    ORDER BY c.start_date DESC, c.cycle_id DESC
    LIMIT 1
  `, params);
  return rows[0] ? mapCycle(rows[0]) : null;
}

// GET /api/cycles/current: the latest cycle that has started, or null.
export function getCurrentCycle() {
  return fetchCycle('c.start_date <= CURRENT_DATE', []);
}

// POST /api/cycles: an AC member starts the cycle for a term today.
export async function createCycle(startedBy: string, termId: number, deadlines: Deadlines) {
  const db = getPool();
  const { rows } = await db.query<{ today: string; term_end: string | null; cycle_exists: boolean }>(`
    SELECT CURRENT_DATE::text AS today,
           (SELECT end_date::text FROM term WHERE term_id = $1) AS term_end,
           EXISTS (SELECT 1 FROM eval_cycle WHERE term_id = $1) AS cycle_exists
  `, [termId]);
  const { today, term_end: termEnd, cycle_exists: cycleExists } = rows[0];
  if (termEnd === null) throw new ApiError(404, 'TERM_NOT_FOUND', 'That term does not exist.');
  if (termEnd < today) throw new ApiError(400, 'TERM_ENDED', 'That term has already ended.');
  if (cycleExists) throw new ApiError(409, 'CYCLE_EXISTS', 'An evaluation cycle already exists for that term.');
  checkDeadlineOrder(today, deadlines);

  // The cycle and its eval_due rows are saved together, or not at all.
  let cycleId: number;
  try {
    cycleId = await inTransaction(async (client) => {
      const inserted = await client.query<{ cycle_id: number }>(`
        INSERT INTO eval_cycle (term_id, started_by, start_date, signup_deadline, observation_deadline, feedback_deadline)
        VALUES ($1, $2, $3::date, $4::date, $5::date, $6::date)
        RETURNING cycle_id
      `, [termId, startedBy, today, deadlines.signupDeadline, deadlines.observationDeadline, deadlines.feedbackDeadline]);
      const id = inserted.rows[0].cycle_id;
      await insertEvalDue(client, { cycleId: id, termId, startedBy, startDate: today, ...deadlines });
      return id;
    });
  } catch (error) {
    // Two AC members starting the same term at the same moment.
    if ((error as { code?: string }).code === '23505') {
      throw new ApiError(409, 'CYCLE_EXISTS', 'An evaluation cycle already exists for that term.');
    }
    throw error;
  }
  return (await fetchCycle('c.cycle_id = $1', [cycleId]))!;
}

// PATCH /api/cycles/{cycleId}: change one or more deadlines.
export async function updateCycle(cycleId: number, changes: Partial<Deadlines>) {
  const current = await fetchCycle('c.cycle_id = $1', [cycleId]);
  if (!current) throw new ApiError(404, 'NOT_FOUND', 'Cycle not found.');
  const deadlines: Deadlines = {
    signupDeadline: changes.signupDeadline ?? current.signupDeadline,
    observationDeadline: changes.observationDeadline ?? current.observationDeadline,
    feedbackDeadline: changes.feedbackDeadline ?? current.feedbackDeadline,
  };
  checkDeadlineOrder(current.startDate, deadlines);
  await getPool().query(`
    UPDATE eval_cycle
    SET signup_deadline = $2::date, observation_deadline = $3::date, feedback_deadline = $4::date
    WHERE cycle_id = $1
  `, [cycleId, deadlines.signupDeadline, deadlines.observationDeadline, deadlines.feedbackDeadline]);
  return (await fetchCycle('c.cycle_id = $1', [cycleId]))!;
}
