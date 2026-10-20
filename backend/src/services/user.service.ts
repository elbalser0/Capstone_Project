import { getPool } from '../db/pool.js';

export type Role = 'FACULTY' | 'AC';
export type Rank = 'assistant' | 'associate' | 'full';

export interface AuthUser {
  netid: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  rank: Rank;
  department: { deptId: string; deptName: string };
  role: 'faculty' | 'AC';
  roles: Role[];
}

interface ProfessorRow {
  netid: string;
  first_name: string;
  last_name: string;
  email: string;
  rank: Rank;
  dept_id: number;
  dept_name: string;
  is_ac: boolean;
}

export function mapProfessorRow(row: ProfessorRow): AuthUser {
  return {
    netid: row.netid,
    firstName: row.first_name,
    lastName: row.last_name,
    displayName: `Dr. ${row.first_name} ${row.last_name}`,
    email: row.email,
    rank: row.rank,
    department: { deptId: String(row.dept_id), deptName: row.dept_name },
    role: row.is_ac ? 'AC' : 'faculty',
    roles: row.is_ac ? ['FACULTY', 'AC'] : ['FACULTY'],
  };
}

export async function findUserByEmail(email: string): Promise<AuthUser | undefined> {
  const { rows } = await getPool().query<ProfessorRow>(`
    SELECT p.netid, p.first_name, p.last_name, p.email, p.rank,
           d.dept_id, d.dept_name, COALESCE(a.is_active, false) AS is_ac
    FROM professor AS p
    JOIN department AS d ON d.dept_id = p.dept_id
    LEFT JOIN ac_member AS a ON a.netid = p.netid
    WHERE lower(p.email) = lower($1) AND p.is_active = true
  `, [email]);
  return rows[0] ? mapProfessorRow(rows[0]) : undefined;
}
