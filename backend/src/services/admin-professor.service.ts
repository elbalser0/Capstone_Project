import type { PoolClient } from 'pg';
import { getPool } from '../db/pool.js';
import { inTransaction } from '../db/transaction.js';
import { ApiError } from '../middleware/error.middleware.js';
import { findNextTermId } from './term.service.js';
import { displayName, type Rank } from './user.service.js';

export interface NewProfessor {
  netid: string;
  firstName: string;
  lastName: string;
  email: string;
  rank: Rank;
  deptId: number;
}

export interface AdminProfessorRow {
  netid: string;
  first_name: string;
  last_name: string;
  email: string;
  rank: Rank;
  dept_id: number;
  dept_name: string;
  is_ac: boolean;
  is_active: boolean;
}

// One professor as the admin pages see it. isAc means an active ac_member row.
export function mapAdminProfessor(row: AdminProfessorRow) {
  return {
    netid: row.netid,
    firstName: row.first_name,
    lastName: row.last_name,
    displayName: displayName(row.first_name, row.last_name),
    email: row.email,
    rank: row.rank,
    department: { deptId: String(row.dept_id), deptName: row.dept_name },
    isAc: row.is_ac,
    isActive: row.is_active,
  };
}

export type AdminProfessor = ReturnType<typeof mapAdminProfessor>;

const SELECT_ADMIN_PROFESSOR = `
  SELECT p.netid, p.first_name, p.last_name, p.email, p.rank,
         d.dept_id, d.dept_name,
         COALESCE(a.is_active, false) AS is_ac,
         p.is_active
    FROM professor AS p
    JOIN department AS d ON d.dept_id = p.dept_id
    LEFT JOIN ac_member AS a ON a.netid = p.netid`;

// GET /api/admin/professors: every professor, inactive ones included.
export async function listAdminProfessors(): Promise<AdminProfessor[]> {
  const { rows } = await getPool().query<AdminProfessorRow>(
    `${SELECT_ADMIN_PROFESSOR} ORDER BY p.last_name, p.first_name, p.netid`,
  );
  return rows.map(mapAdminProfessor);
}

// One professor by netid. Pass a transaction client to see changes made in that transaction.
export async function getAdminProfessor(
  netid: string,
  db: Pick<PoolClient, 'query'> = getPool(),
): Promise<AdminProfessor | undefined> {
  const { rows } = await db.query<AdminProfessorRow>(`${SELECT_ADMIN_PROFESSOR} WHERE p.netid = $1`, [netid]);
  return rows[0] ? mapAdminProfessor(rows[0]) : undefined;
}

// POST /api/admin/professors. A new professor starts in the next term (the earliest one starting
// after today) with no prior evaluation. The rank trigger sets eval_interval_years.
export async function createProfessor(professor: NewProfessor): Promise<AdminProfessor> {
  try {
    return await inTransaction(async (client) => {
      const department = await client.query('SELECT 1 FROM department WHERE dept_id = $1', [professor.deptId]);
      if (!department.rowCount) {
        throw new ApiError(400, 'INVALID_PROFESSOR', 'deptId does not match a department.');
      }
      const startTerm = await findNextTermId(client);
      if (startTerm === null) {
        throw new ApiError(409, 'NEXT_TERM_MISSING', 'Add the next term before adding professors.');
      }
      await client.query(`
        INSERT INTO professor (netid, first_name, last_name, email, rank, dept_id,
                               baseline_last_eval_term, start_term, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, true)
      `, [professor.netid, professor.firstName, professor.lastName, professor.email,
        professor.rank, professor.deptId, startTerm]);
      return (await getAdminProfessor(professor.netid, client))!;
    });
  } catch (error) {
    const { code, constraint } = error as { code?: string; constraint?: string };
    if (code === '23505' && constraint === 'professor_pkey') {
      throw new ApiError(409, 'NETID_TAKEN', `A professor with netid ${professor.netid} already exists.`);
    }
    if (code === '23505' && constraint === 'professor_email_lower_unique') {
      throw new ApiError(409, 'EMAIL_TAKEN', 'A professor with that email already exists.');
    }
    // The department was deleted after the check above.
    if (code === '23503') {
      throw new ApiError(400, 'INVALID_PROFESSOR', 'deptId does not match a department.');
    }
    throw error;
  }
}

export interface ProfessorChanges {
  rank?: Rank;
  isAc?: boolean;
  isActive?: boolean;
}

// A professor cannot be deactivated while they take part in the current cycle: the latest cycle
// that has started (same rule as getCurrentCycle), counted only until its feedback deadline.
async function isInCurrentCycle(client: PoolClient, netid: string): Promise<boolean> {
  const { rows } = await client.query<{ busy: boolean }>(`
    WITH cycle AS (
      SELECT cycle_id FROM eval_cycle
      WHERE start_date <= CURRENT_DATE
      ORDER BY start_date DESC, cycle_id DESC
      LIMIT 1
    ), open_cycle AS (
      SELECT c.cycle_id FROM cycle JOIN eval_cycle AS c USING (cycle_id)
      WHERE CURRENT_DATE <= c.feedback_deadline
    )
    SELECT EXISTS (SELECT 1 FROM sign_up AS s JOIN open_cycle USING (cycle_id)
                   WHERE s.observee_netid = $1)
        OR EXISTS (SELECT 1 FROM observation_request AS r
                   JOIN sign_up AS s ON s.signup_id = r.signup_id
                   JOIN open_cycle USING (cycle_id)
                   WHERE r.observer_netid = $1 AND r.status IN ('pending', 'accepted'))
        OR EXISTS (SELECT 1 FROM observation AS o
                   JOIN sign_up AS s ON s.signup_id = o.signup_id
                   JOIN open_cycle USING (cycle_id)
                   WHERE o.observer_netid = $1 AND o.status = 'scheduled') AS busy
  `, [netid]);
  return rows[0].busy;
}

// PATCH /api/admin/professors/:netid. Applies isActive, then rank, then isAc, all in one
// transaction, so a failed step leaves the professor unchanged.
export async function updateProfessor(netid: string, changes: ProfessorChanges): Promise<AdminProfessor> {
  return inTransaction(async (client) => {
    const { rows } = await client.query<{ is_active: boolean }>(
      'SELECT is_active FROM professor WHERE netid = $1 FOR UPDATE', [netid],
    );
    if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Professor not found.');
    let isActive = rows[0].is_active;

    if (changes.isActive === false && isActive) {
      if (await isInCurrentCycle(client, netid)) {
        throw new ApiError(409, 'IN_CURRENT_CYCLE',
          'This professor has a sign-up, observation request or scheduled observation in the current cycle.');
      }
      await client.query('UPDATE professor SET is_active = false WHERE netid = $1', [netid]);
      await client.query('UPDATE ac_member SET is_active = false WHERE netid = $1', [netid]);
      isActive = false;
    } else if (changes.isActive === true && !isActive) {
      // AC membership is not restored; add it again with isAc if needed.
      await client.query('UPDATE professor SET is_active = true WHERE netid = $1', [netid]);
      isActive = true;
    }

    if (changes.rank) {
      // The rank trigger updates eval_interval_years.
      await client.query('UPDATE professor SET rank = $2 WHERE netid = $1', [netid, changes.rank]);
    }

    if (changes.isAc === true) {
      if (!isActive) throw new ApiError(409, 'PROFESSOR_INACTIVE', 'Only an active professor can be on the Assessment Committee.');
      await client.query(`
        INSERT INTO ac_member (netid, is_active) VALUES ($1, true)
        ON CONFLICT (netid) DO UPDATE SET is_active = true
      `, [netid]);
    } else if (changes.isAc === false) {
      await client.query('UPDATE ac_member SET is_active = false WHERE netid = $1', [netid]);
    }

    return (await getAdminProfessor(netid, client))!;
  });
}
