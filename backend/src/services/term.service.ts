import type { PoolClient } from 'pg';
import { getPool } from '../db/pool.js';
import { inTransaction } from '../db/transaction.js';
import { ApiError } from '../middleware/error.middleware.js';

export type Season = 'fall' | 'spring';

export interface NewTerm {
  season: Season;
  year: number;
  startDate: string;
  endDate: string;
}

interface TermRow {
  term_id: number;
  season: Season;
  year: number;
  start_date: string;
  end_date: string;
}

function termLabel(season: Season, year: number): string {
  return `${season === 'fall' ? 'Fall' : 'Spring'} ${year}`;
}

// Same semester arithmetic as the evaluation due-date calculation: spring before fall in a year.
function semesterIndex(season: Season, year: number): number {
  return year * 2 + (season === 'fall' ? 1 : 0);
}

export function mapTerm(row: TermRow) {
  return {
    termId: String(row.term_id),
    season: row.season,
    year: row.year,
    label: termLabel(row.season, row.year),
    startDate: row.start_date,
    endDate: row.end_date,
  };
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
