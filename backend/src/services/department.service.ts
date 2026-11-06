import { getPool } from '../db/pool.js';
import type { Department } from './user.service.js';

// GET /api/admin/departments: every department by name, for the Add Professor dropdown.
export async function listDepartments(): Promise<Department[]> {
  const { rows } = await getPool().query<{ dept_id: number; dept_name: string }>(
    'SELECT dept_id, dept_name FROM department ORDER BY dept_name, dept_id',
  );
  return rows.map((row) => ({ deptId: String(row.dept_id), deptName: row.dept_name }));
}
