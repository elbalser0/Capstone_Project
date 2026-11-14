import type { PoolClient } from 'pg';
import { getPool } from '../db/pool.js';
import { displayName, type Rank } from './user.service.js';

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
