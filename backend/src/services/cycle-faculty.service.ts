import { getPool } from '../db/pool.js';
import { ApiError } from '../middleware/error.middleware.js';
import { mapEvaluationStatus } from './evaluation-status.service.js';
import { displayName, type Rank } from './user.service.js';

type ProfessorInput = Parameters<typeof mapEvaluationStatus>[0];
type TermRow = Parameters<typeof mapEvaluationStatus>[1][number];
type CycleInput = NonNullable<Parameters<typeof mapEvaluationStatus>[2]>;

interface FacultyRow extends ProfessorInput {
  netid: string;
  first_name: string;
  last_name: string;
  email: string;
  dept_id: number;
  dept_name: string;
  due_status: 'due' | 'overdue' | null;
  last_observed_term_id: number | null;
}

const STATUS_ORDER = { OVERDUE: 0, DUE: 1, NOT_DUE: 2 } as const;

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

// GET /api/cycles/{cycleId}/faculty: every active professor, NOT_DUE included.
// DUE and OVERDUE come from the roster saved when the cycle started (eval_due), so this list
// agrees with /due-professors; everyone else active is NOT_DUE. lastObservedTerm is the last
// signed observation (or baseline) before the cycle's term. dueTerm uses the same rules as
// /api/me/evaluation-status; a due semester with no term row yet has termId and dates null.
export async function listCycleFaculty(cycleId: number) {
  const db = getPool();
  const cycleResult = await db.query<CycleInput & { term_start: string }>(`
    SELECT c.cycle_id, c.term_id, c.started_by, c.start_date::text, c.signup_deadline::text,
           c.observation_deadline::text, c.feedback_deadline::text, t.start_date::text AS term_start
    FROM eval_cycle AS c JOIN term AS t ON t.term_id = c.term_id
    WHERE c.cycle_id = $1`, [cycleId]);
  const cycle = cycleResult.rows[0];
  if (!cycle) throw new ApiError(404, 'NOT_FOUND', 'Cycle not found.');

  const [faculty, terms] = await Promise.all([
    db.query<FacultyRow>(`
      SELECT p.netid, p.first_name, p.last_name, p.email, p.rank, p.eval_interval_years,
             p.baseline_last_eval_term, p.start_term, CURRENT_DATE::text AS today,
             d.dept_id, d.dept_name, ed.due_status,
             completed.term_id AS last_completed_term_id,
             COALESCE(completed_before.term_id, baseline_before.term_id) AS last_observed_term_id
      FROM professor AS p
      JOIN department AS d ON d.dept_id = p.dept_id
      LEFT JOIN eval_due AS ed ON ed.cycle_id = $1 AND ed.netid = p.netid
      -- Latest signed observation of any term: the base for the due semester.
      LEFT JOIN LATERAL (
        SELECT t.term_id
        FROM observation AS o
        JOIN sign_up AS s ON s.signup_id = o.signup_id
        JOIN eval_cycle AS ec ON ec.cycle_id = s.cycle_id
        JOIN term AS t ON t.term_id = ec.term_id
        WHERE s.observee_netid = p.netid AND o.status = 'completed'
          AND o.observee_signed_date IS NOT NULL AND o.observer_signed_date IS NOT NULL
        ORDER BY t.start_date DESC, t.term_id DESC LIMIT 1
      ) AS completed ON true
      -- Latest signed observation before this cycle's term: what "last observed" shows.
      LEFT JOIN LATERAL (
        SELECT t.term_id
        FROM observation AS o
        JOIN sign_up AS s ON s.signup_id = o.signup_id
        JOIN eval_cycle AS ec ON ec.cycle_id = s.cycle_id
        JOIN term AS t ON t.term_id = ec.term_id
        WHERE s.observee_netid = p.netid AND o.status = 'completed'
          AND o.observee_signed_date IS NOT NULL AND o.observer_signed_date IS NOT NULL
          AND t.start_date < $2::date
        ORDER BY t.start_date DESC, t.term_id DESC LIMIT 1
      ) AS completed_before ON true
      LEFT JOIN term AS baseline_before ON baseline_before.term_id = p.baseline_last_eval_term
                                       AND baseline_before.start_date < $2::date
      WHERE p.is_active
    `, [cycleId, cycle.term_start]),
    db.query<TermRow>('SELECT term_id, season, year, start_date::text, end_date::text FROM term ORDER BY start_date, term_id'),
  ]);

  const byId = new Map(terms.rows.map((row) => [row.term_id, row]));
  const statusCycle: CycleInput = {
    ...cycle, first_name: '', last_name: '', rank: 'full', has_match: false, signup_id: null, on_due_roster: false,
  };
  return faculty.rows
    .map((row) => {
      const due = mapEvaluationStatus(row, terms.rows, statusCycle).dueTerm;
      const dueRow = terms.rows.find((t) => t.season === due.season && t.year === due.year);
      const last = row.last_observed_term_id === null ? undefined : byId.get(row.last_observed_term_id);
      return {
        professor: {
          netid: row.netid,
          firstName: row.first_name,
          lastName: row.last_name,
          displayName: displayName(row.first_name, row.last_name),
          rank: row.rank as Rank,
          email: row.email,
        },
        department: { deptId: String(row.dept_id), deptName: row.dept_name },
        dueStatus: row.due_status === 'overdue' ? 'OVERDUE' as const : row.due_status === 'due' ? 'DUE' as const : 'NOT_DUE' as const,
        lastObservedTerm: last ? term(last) : null,
        dueTerm: dueRow ? term(dueRow) : { termId: null, season: due.season, year: due.year, label: due.label, startDate: null, endDate: null },
      };
    })
    .sort((a, b) => STATUS_ORDER[a.dueStatus] - STATUS_ORDER[b.dueStatus]
      || a.professor.lastName.localeCompare(b.professor.lastName)
      || a.professor.firstName.localeCompare(b.professor.firstName)
      || a.professor.netid.localeCompare(b.professor.netid));
}
