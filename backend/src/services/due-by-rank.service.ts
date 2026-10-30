import { getPool } from '../db/pool.js';
import { ApiError } from '../middleware/error.middleware.js';
import { getCurrentCycle } from './cycle.service.js';
import type { Rank } from './user.service.js';

interface RankCountRow {
  rank: Rank;
  count: number;
}

export function mapDueByRank(cycleId: string, rows: RankCountRow[]) {
  const byRank: Record<Rank, number> = { assistant: 0, associate: 0, full: 0 };
  for (const row of rows) byRank[row.rank] = row.count;
  return { cycleId, total: byRank.assistant + byRank.associate + byRank.full, byRank };
}

export async function listDueByRank() {
  const cycle = await getCurrentCycle();
  if (!cycle) throw new ApiError(404, 'NO_CYCLE', 'No cycle has started yet.');

  const { rows } = await getPool().query<RankCountRow>(`
    SELECT p.rank, count(*)::int AS count
    FROM eval_due AS due
    JOIN professor AS p ON p.netid = due.netid
    WHERE due.cycle_id = $1
    GROUP BY p.rank
  `, [cycle.cycleId]);
  return mapDueByRank(cycle.cycleId, rows);
}
