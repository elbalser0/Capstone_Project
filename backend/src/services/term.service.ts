import type { PoolClient } from 'pg';
import { getPool } from '../db/pool.js';

type Season = 'fall' | 'spring';

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
