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
  observed_this_cycle: boolean;
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

// GET /api/cycles/{cycleId}/faculty: every active professor, with due status frozen at cycle
// kickoff and a separate flag for observations completed during this cycle.
export async function listCycleFaculty(cycleId: number) {
  const db = getPool();
  const cycleResult = await db.query<CycleInput>(`
    SELECT c.cycle_id, c.term_id, c.started_by, c.start_date::text, c.signup_deadline::text,
           c.observation_deadline::text, c.feedback_deadline::text
    FROM eval_cycle AS c JOIN term AS t ON t.term_id = c.term_id
    WHERE c.cycle_id = $1`, [cycleId]);
  const cycle = cycleResult.rows[0];
  if (!cycle) throw new ApiError(404, 'NOT_FOUND', 'Cycle not found.');

  const [faculty, terms] = await Promise.all([
    db.query<FacultyRow>(`
      SELECT p.netid, p.first_name, p.last_name, p.email, p.rank, p.eval_interval_years,
             p.baseline_last_eval_term, p.start_term, CURRENT_DATE::text AS today,
             d.dept_id, d.dept_name, completed.term_id AS last_completed_term_id,
             ed.due_status,
             EXISTS (
               SELECT 1
               FROM sign_up AS cycle_signup
               JOIN observation AS cycle_observation ON cycle_observation.signup_id = cycle_signup.signup_id
               WHERE cycle_signup.cycle_id = $1 AND cycle_signup.observee_netid = p.netid
                 AND cycle_observation.status = 'completed'
                 AND cycle_observation.observee_signed_date IS NOT NULL
                 AND cycle_observation.observer_signed_date IS NOT NULL
             ) AS observed_this_cycle
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
      WHERE p.is_active
    `, [cycleId]),
    db.query<TermRow>('SELECT term_id, season, year, start_date::text, end_date::text FROM term ORDER BY start_date, term_id'),
  ]);

  const statusCycle: CycleInput = {
    ...cycle, first_name: '', last_name: '', rank: 'full', has_match: false, signup_id: null, on_due_roster: false,
  };
  return faculty.rows
    .map((row) => {
      const status = mapEvaluationStatus(row, terms.rows, statusCycle);
      const dueStatus: keyof typeof STATUS_ORDER = row.due_status === 'overdue' ? 'OVERDUE' : row.due_status === 'due' ? 'DUE' : 'NOT_DUE';
      const due = status.dueTerm;
      const dueRow = terms.rows.find((t) => t.season === due.season && t.year === due.year);
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
        dueStatus,
        observedThisCycle: row.observed_this_cycle,
        lastObservedTerm: status.lastObservedTerm,
        dueTerm: dueRow ? term(dueRow) : { termId: null, season: due.season, year: due.year, label: due.label, startDate: null, endDate: null },
      };
    })
    .sort((a, b) => STATUS_ORDER[a.dueStatus] - STATUS_ORDER[b.dueStatus]
      || a.professor.lastName.localeCompare(b.professor.lastName)
      || a.professor.firstName.localeCompare(b.professor.firstName)
      || a.professor.netid.localeCompare(b.professor.netid));
}
