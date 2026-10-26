import type { PoolClient } from 'pg';
import { ApiError } from '../middleware/error.middleware.js';
import { mapEvaluationStatus } from './evaluation-status.service.js';

type ProfessorInput = Parameters<typeof mapEvaluationStatus>[0];
type TermInput = Parameters<typeof mapEvaluationStatus>[1][number];
type CycleInput = NonNullable<Parameters<typeof mapEvaluationStatus>[2]>;

export interface ProfessorDueRow extends ProfessorInput {
  netid: string;
}

export interface NewCycle {
  cycleId: number;
  termId: number;
  startedBy: string;
  startDate: string;
  signupDeadline: string;
  observationDeadline: string;
  feedbackDeadline: string;
}

export interface DueRecord {
  netid: string;
  dueStatus: 'due' | 'overdue';
}

// Uses the same rules as GET /api/me/evaluation-status (#103), measured against the new cycle's term.
// The due status depends only on the cycle's term; the name and rank fields are not used for it.
export function dueProfessors(professors: ProfessorDueRow[], terms: TermInput[], newCycle: NewCycle): DueRecord[] {
  const cycle: CycleInput = {
    cycle_id: newCycle.cycleId, term_id: newCycle.termId, started_by: newCycle.startedBy,
    start_date: newCycle.startDate, signup_deadline: newCycle.signupDeadline,
    observation_deadline: newCycle.observationDeadline, feedback_deadline: newCycle.feedbackDeadline,
    first_name: '', last_name: '', rank: 'full', has_match: false, signup_id: null, on_due_roster: false,
  };
  const due: DueRecord[] = [];
  for (const professor of professors) {
    let status: string;
    try {
      status = mapEvaluationStatus(professor, terms, cycle).status;
    } catch (error) {
      if (error instanceof ApiError) {
        throw new ApiError(error.status, error.code, `${error.message} (professor ${professor.netid})`);
      }
      throw error;
    }
    if (status === 'DUE') due.push({ netid: professor.netid, dueStatus: 'due' });
    if (status === 'OVERDUE') due.push({ netid: professor.netid, dueStatus: 'overdue' });
  }
  return due;
}

// Saves who is DUE or OVERDUE for a new cycle. Runs inside the cycle-creation transaction.
export async function insertEvalDue(client: PoolClient, newCycle: NewCycle): Promise<number> {
  const [professors, terms] = await Promise.all([
    client.query<ProfessorDueRow>(`
      SELECT p.netid, p.rank, p.eval_interval_years, p.baseline_last_eval_term, p.start_term,
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
      WHERE p.is_active = true
      ORDER BY p.netid
    `),
    client.query<TermInput>(`
      SELECT term_id, season, year, start_date::text, end_date::text
      FROM term ORDER BY start_date, term_id
    `),
  ]);
  const due = dueProfessors(professors.rows, terms.rows, newCycle);
  if (due.length === 0) return 0;
  await client.query(`
    INSERT INTO eval_due (cycle_id, netid, due_status)
    SELECT $1, netid, due_status
    FROM unnest($2::text[], $3::text[]) AS d(netid, due_status)
  `, [newCycle.cycleId, due.map((row) => row.netid), due.map((row) => row.dueStatus)]);
  return due.length;
}
