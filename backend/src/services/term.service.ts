import type { PoolClient } from 'pg';
import { getPool } from '../db/pool.js';
import { inTransaction } from '../db/transaction.js';
import { ApiError } from '../middleware/error.middleware.js';
import { mapEvaluationStatus } from './evaluation-status.service.js';

export type Season = 'fall' | 'spring';

interface TermRow {
  term_id: number;
  season: Season;
  year: number;
  start_date: string;
  end_date: string;
}

export function mapTerm(row: TermRow) {
  return {
    termId: String(row.term_id),
    season: row.season,
    year: row.year,
    label: `${row.season === 'fall' ? 'Fall' : 'Spring'} ${row.year}`,
    startDate: row.start_date,
    endDate: row.end_date,
  };
}

export async function listTerms(db: Pick<PoolClient, 'query'> = getPool()) {
  const { rows } = await db.query<TermRow>(`
    SELECT term_id, season, year,
           start_date::date::text AS start_date,
           end_date::date::text AS end_date
    FROM term
    ORDER BY start_date, term_id
  `);
  return rows.map(mapTerm);
}

type EvaluationTerm = Parameters<typeof mapEvaluationStatus>[1][number];
type EvaluationCycle = NonNullable<Parameters<typeof mapEvaluationStatus>[2]>;
type Rank = 'assistant' | 'associate' | 'full';

interface PreviewProfessorRow {
  netid: string;
  first_name: string;
  last_name: string;
  email: string;
  rank: Rank;
  eval_interval_years: number;
  baseline_last_eval_term: number | null;
  start_term: number | null;
  last_completed_term_id: number | null;
  existing_cycle_id: number | null;
  dept_id: number;
  dept_name: string;
  saved_due_status: 'due' | 'overdue' | null;
  today: string;
}

const STATUS_ORDER = { OVERDUE: 0, DUE: 1, NOT_DUE: 2 } as const;

function mapDuePreviewRow(row: PreviewProfessorRow, terms: EvaluationTerm[], cycle: EvaluationCycle) {
  const evaluation = mapEvaluationStatus(row, terms, cycle);
  const dueTermRow = terms.find((term) => term.season === evaluation.dueTerm.season && term.year === evaluation.dueTerm.year);
  const dueTerm = dueTermRow
    ? mapTerm(dueTermRow)
    : {
      termId: null,
      season: evaluation.dueTerm.season,
      year: evaluation.dueTerm.year,
      label: evaluation.dueTerm.label,
      startDate: null,
      endDate: null,
    };
  return {
    professor: {
      netid: row.netid,
      firstName: row.first_name,
      lastName: row.last_name,
      displayName: `Dr. ${row.first_name} ${row.last_name}`,
      rank: row.rank,
      email: row.email,
    },
    department: { deptId: String(row.dept_id), deptName: row.dept_name },
    dueStatus: row.existing_cycle_id !== null
      ? (row.saved_due_status === 'overdue' ? 'OVERDUE' : row.saved_due_status === 'due' ? 'DUE' : 'NOT_DUE')
      : evaluation.status,
    lastObservedTerm: evaluation.lastObservedTerm,
    dueTerm,
  };
}

// GET /api/terms/{termId}/due-preview: show the roster that would be due at kickoff.
// If a cycle already exists, its saved eval_due roster is authoritative. Otherwise, use the
// same evaluation rules as cycle creation, measured against the selected term.
export async function previewDueProfessors(termId: number, db: Pick<PoolClient, 'query'> = getPool()) {
  const { rows: terms } = await db.query<EvaluationTerm>(`
    SELECT term_id, season, year, start_date::date::text AS start_date,
           end_date::date::text AS end_date
    FROM term
    ORDER BY start_date, term_id
  `);
  const selectedTerm = terms.find((row) => row.term_id === termId);
  if (!selectedTerm) throw new ApiError(404, 'NOT_FOUND', 'Term not found.');

  const cycle: EvaluationCycle = {
    cycle_id: 0,
    term_id: termId,
    started_by: '',
    start_date: selectedTerm.start_date,
    signup_deadline: selectedTerm.start_date,
    observation_deadline: selectedTerm.end_date,
    feedback_deadline: selectedTerm.end_date,
    first_name: '',
    last_name: '',
    rank: 'full',
    has_match: false,
    signup_id: null,
    on_due_roster: false,
  };
  const { rows } = await db.query<PreviewProfessorRow>(`
    SELECT p.netid, p.first_name, p.last_name, p.email, p.rank,
           p.eval_interval_years, baseline_term.term_id AS baseline_last_eval_term, p.start_term,
           p.dept_id, d.dept_name, CURRENT_DATE::text AS today,
           completed.term_id AS last_completed_term_id,
           ed.due_status AS saved_due_status, cycle.cycle_id AS existing_cycle_id
    FROM professor AS p
    JOIN department AS d ON d.dept_id = p.dept_id
    LEFT JOIN eval_cycle AS cycle ON cycle.term_id = $1
    LEFT JOIN eval_due AS ed ON ed.cycle_id = cycle.cycle_id AND ed.netid = p.netid
    LEFT JOIN term AS baseline_term ON baseline_term.term_id = p.baseline_last_eval_term
                                   AND baseline_term.start_date < $2::date
    LEFT JOIN LATERAL (
      SELECT t.term_id
      FROM observation AS o
      JOIN sign_up AS s ON s.signup_id = o.signup_id
      JOIN eval_cycle AS completed_cycle ON completed_cycle.cycle_id = s.cycle_id
      JOIN term AS t ON t.term_id = completed_cycle.term_id
      WHERE s.observee_netid = p.netid
        AND o.status = 'completed'
        AND o.observee_signed_date IS NOT NULL
        AND o.observer_signed_date IS NOT NULL
        AND t.start_date < $2::date
      ORDER BY t.start_date DESC, t.term_id DESC
      LIMIT 1
    ) AS completed ON true
    WHERE p.is_active = true
    ORDER BY p.last_name, p.first_name, p.netid
  `, [termId, selectedTerm.start_date]);

  return rows
    .map((row) => mapDuePreviewRow(row, terms, cycle))
    .sort((a, b) => STATUS_ORDER[a.dueStatus] - STATUS_ORDER[b.dueStatus]
      || a.professor.lastName.localeCompare(b.professor.lastName)
      || a.professor.firstName.localeCompare(b.professor.firstName)
      || a.professor.netid.localeCompare(b.professor.netid));
}

export interface NewTerm {
  season: Season;
  year: number;
  startDate: string;
  endDate: string;
}

function termLabel(season: Season, year: number): string {
  return `${season === 'fall' ? 'Fall' : 'Spring'} ${year}`;
}

// Same semester arithmetic as the evaluation due-date calculation: spring before fall in a year.
function semesterIndex(season: Season, year: number): number {
  return year * 2 + (season === 'fall' ? 1 : 0);
}

// POST /api/admin/terms. Besides the database rules (unique season and year, end after start),
// a term may not overlap another term, and sorting terms by start date must keep season order.
export async function createTerm(term: NewTerm) {
  const label = termLabel(term.season, term.year);
  try {
    return await inTransaction(async (client) => {
      // Blocks other term inserts until commit, so two admins cannot both pass the checks below.
      await client.query('LOCK TABLE term IN SHARE ROW EXCLUSIVE MODE');

      const existing = await client.query('SELECT 1 FROM term WHERE season = $1 AND year = $2', [term.season, term.year]);
      if (existing.rowCount) throw new ApiError(409, 'TERM_EXISTS', `${label} already exists.`);

      const overlap = await client.query<TermRow>(`
        SELECT season, year FROM term
        WHERE start_date <= $2::date AND end_date >= $1::date
        ORDER BY start_date LIMIT 1
      `, [term.startDate, term.endDate]);
      if (overlap.rows[0]) {
        const other = overlap.rows[0];
        throw new ApiError(409, 'TERM_OVERLAP', `${label}'s dates overlap ${termLabel(other.season, other.year)}.`);
      }

      const { rows: [neighbors] } = await client.query<{
        prev_season: Season | null; prev_year: number | null; next_season: Season | null; next_year: number | null;
      }>(`
        SELECT prev.season AS prev_season, prev.year AS prev_year, next.season AS next_season, next.year AS next_year
        FROM (SELECT 1) AS one
        LEFT JOIN LATERAL (SELECT season, year FROM term WHERE start_date < $1::date
                           ORDER BY start_date DESC LIMIT 1) AS prev ON true
        LEFT JOIN LATERAL (SELECT season, year FROM term WHERE start_date > $1::date
                           ORDER BY start_date LIMIT 1) AS next ON true
      `, [term.startDate]);
      const index = semesterIndex(term.season, term.year);
      if (neighbors.prev_season && semesterIndex(neighbors.prev_season, neighbors.prev_year!) >= index) {
        throw new ApiError(409, 'TERM_OUT_OF_ORDER',
          `${label} cannot start after ${termLabel(neighbors.prev_season, neighbors.prev_year!)}.`);
      }
      if (neighbors.next_season && semesterIndex(neighbors.next_season, neighbors.next_year!) <= index) {
        throw new ApiError(409, 'TERM_OUT_OF_ORDER',
          `${label} cannot start before ${termLabel(neighbors.next_season, neighbors.next_year!)}.`);
      }

      const inserted = await client.query<TermRow>(`
        INSERT INTO term (season, year, start_date, end_date)
        VALUES ($1, $2, $3::date, $4::date)
        RETURNING term_id, season, year, start_date::text, end_date::text
      `, [term.season, term.year, term.startDate, term.endDate]);
      return mapTerm(inserted.rows[0]);
    });
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new ApiError(409, 'TERM_EXISTS', `${label} already exists.`);
    }
    throw error;
  }
}

// The term a newly added professor starts in: the earliest term that starts after today.
export async function findNextTermId(db: Pick<PoolClient, 'query'> = getPool()): Promise<number | null> {
  const { rows } = await db.query<{ term_id: number }>(`
    SELECT term_id FROM term
    WHERE start_date > CURRENT_DATE
    ORDER BY start_date, term_id
    LIMIT 1
  `);
  return rows[0]?.term_id ?? null;
}
