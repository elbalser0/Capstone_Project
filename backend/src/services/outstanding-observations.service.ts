import { getPool } from '../db/pool.js';
import { ApiError } from '../middleware/error.middleware.js';
import { getCurrentCycle } from './cycle.service.js';
import type { Rank } from './user.service.js';

interface OutstandingObservationRow {
  rank: Rank;
  count: number;
}

export function mapOutstandingObservations(cycleId: string, rows: OutstandingObservationRow[]) {
  const byRank: Record<Rank, number> = { assistant: 0, associate: 0, full: 0 };
  for (const row of rows) byRank[row.rank] = row.count;
  return { cycleId, total: byRank.assistant + byRank.associate + byRank.full, byRank };
}

// GET /api/dashboard/outstanding-observations: current-cycle sign-ups with no observation or a non-completed observation, by observee rank.
export async function listOutstandingObservations() {
  const cycle = await getCurrentCycle();
  if (!cycle) throw new ApiError(404, 'NO_CYCLE', 'No cycle has started yet.');

  const { rows } = await getPool().query<OutstandingObservationRow>(`
    SELECT p.rank, count(DISTINCT s.signup_id)::int AS count
    FROM sign_up AS s
    JOIN professor AS p ON p.netid = s.observee_netid
    LEFT JOIN observation AS o ON o.signup_id = s.signup_id
    WHERE s.cycle_id = $1 AND (o.observation_id IS NULL OR o.status <> 'completed')
    GROUP BY p.rank
  `, [cycle.cycleId]);
  return mapOutstandingObservations(cycle.cycleId, rows);
}
