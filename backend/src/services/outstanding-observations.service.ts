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

// GET /api/dashboard/outstanding-observations: current-cycle observations not yet completed, by observee rank.
export async function listOutstandingObservations() {
  const cycle = await getCurrentCycle();
  if (!cycle) throw new ApiError(404, 'NO_CYCLE', 'No cycle has started yet.');

  const { rows } = await getPool().query<OutstandingObservationRow>(`
    SELECT p.rank, count(o.observation_id)::int AS count
    FROM observation AS o
    JOIN sign_up AS s ON s.signup_id = o.signup_id
    JOIN professor AS p ON p.netid = s.observee_netid
    WHERE s.cycle_id = $1 AND o.status <> 'completed'
    GROUP BY p.rank
  `, [cycle.cycleId]);
  return mapOutstandingObservations(cycle.cycleId, rows);
}
