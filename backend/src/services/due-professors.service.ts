import { getPool } from '../db/pool.js';
import { ApiError } from '../middleware/error.middleware.js';
import { displayName, type Rank } from './user.service.js';

interface DueProfessorRow {
  netid: string;
  first_name: string;
  last_name: string;
  rank: Rank;
  dept_id: number;
  dept_name: string;
  due_status: 'due' | 'overdue';
  last_term_id: number | null;
  last_season: 'fall' | 'spring' | null;
  last_year: number | null;
  last_start_date: string | null;
  last_end_date: string | null;
}

function mapDueProfessor(row: DueProfessorRow) {
  const lastObservedTerm = row.last_term_id === null ? null : {
    termId: String(row.last_term_id),
    season: row.last_season!,
    year: row.last_year!,
    label: `${row.last_season === 'fall' ? 'Fall' : 'Spring'} ${row.last_year}`,
    startDate: row.last_start_date!,
    endDate: row.last_end_date!,
  };

  return {
    professor: {
      netid: row.netid,
      firstName: row.first_name,
      lastName: row.last_name,
      displayName: displayName(row.first_name, row.last_name),
      rank: row.rank,
    },
    department: { deptId: String(row.dept_id), deptName: row.dept_name },
    dueStatus: row.due_status === 'overdue' ? 'OVERDUE' as const : 'DUE' as const,
    lastObservedTerm,
  };
}

// GET /api/cycles/{cycleId}/due-professors: the due roster captured when the cycle started.
export async function listDueProfessors(cycleId: number) {
  const { rows } = await getPool().query<DueProfessorRow>(`
    SELECT p.netid, p.first_name, p.last_name, p.rank,
           d.dept_id, d.dept_name, ed.due_status,
           last_term.term_id AS last_term_id, last_term.season AS last_season,
           last_term.year AS last_year, last_term.start_date::text AS last_start_date,
           last_term.end_date::text AS last_end_date
    FROM eval_cycle AS cycle
    JOIN term AS cycle_term ON cycle_term.term_id = cycle.term_id
    JOIN eval_due AS ed ON ed.cycle_id = cycle.cycle_id
    JOIN professor AS p ON p.netid = ed.netid AND p.is_active
    JOIN department AS d ON d.dept_id = p.dept_id
    LEFT JOIN LATERAL (
      SELECT t.term_id, t.season, t.year, t.start_date, t.end_date
      FROM observation AS o
      JOIN sign_up AS s ON s.signup_id = o.signup_id
      JOIN eval_cycle AS completed_cycle ON completed_cycle.cycle_id = s.cycle_id
      JOIN term AS t ON t.term_id = completed_cycle.term_id
      WHERE s.observee_netid = p.netid
        AND o.status = 'completed'
        AND o.observee_signed_date IS NOT NULL
        AND o.observer_signed_date IS NOT NULL
        AND t.start_date < cycle_term.start_date
      ORDER BY t.start_date DESC, t.term_id DESC
      LIMIT 1
    ) AS completed_term ON true
    LEFT JOIN term AS baseline_term ON baseline_term.term_id = p.baseline_last_eval_term
                                  AND baseline_term.start_date < cycle_term.start_date
    LEFT JOIN term AS last_term ON last_term.term_id = COALESCE(completed_term.term_id, baseline_term.term_id)
    WHERE cycle.cycle_id = $1
    ORDER BY CASE p.rank WHEN 'assistant' THEN 0 WHEN 'associate' THEN 1 ELSE 2 END,
             p.last_name, p.first_name, p.netid
  `, [cycleId]);

  if (rows.length > 0) return rows.map(mapDueProfessor);

  const cycle = await getPool().query('SELECT 1 FROM eval_cycle WHERE cycle_id = $1', [cycleId]);
  if (cycle.rowCount === 0) throw new ApiError(404, 'NOT_FOUND', 'Cycle not found.');
  return [];
}
