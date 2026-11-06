// Database tests for the admin professor endpoints. Setup is in db-test-helper.ts.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { after, before, beforeEach, describe, test } from 'node:test';
import { skip, sql, useTestDatabase } from './db-test-helper.js';
import { adminRouter } from '../src/routes/admin.routes.js';
import { errorHandler } from '../src/middleware/error.middleware.js';

// Isolate the admin routes from Firebase: every request is an admin (auth is covered in accounts.db.test.ts).
const routeApp = express();
routeApp.use(express.json());
routeApp.use((req, _res, next) => {
  req.account = { email: 'ada.admin@example.edu', admin: { adminId: '1', email: 'ada.admin@example.edu', firstName: 'Ada', lastName: 'Admin' } };
  next();
});
routeApp.use('/api/admin', adminRouter);
routeApp.use(errorHandler);

describe('admin professors against the database', { skip }, () => {
  useTestDatabase();
  let base: string;
  let server: ReturnType<typeof routeApp.listen>;

  before(async () => {
    server = routeApp.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => server.once('listening', resolve).once('error', reject));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    if (server?.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  beforeEach(async () => {
    await sql('TRUNCATE department, term, professor, app_admin RESTART IDENTITY CASCADE');
    await sql("INSERT INTO department (dept_name) VALUES ('Computer Science'), ('Mathematics')");
    await sql(`INSERT INTO term (season, year, start_date, end_date) VALUES ('fall', 2024, '2024-08-24', '2024-12-11')`);
  });

  async function addProfessor(netid: string, first: string, last: string, rank: string, deptId: number, active = true) {
    await sql(`INSERT INTO professor (netid, first_name, last_name, email, rank, dept_id, eval_interval_years, start_term, is_active)
               VALUES ($1, $2, $3, $1 || '@example.edu', $4, $5, 2, 1, $6)`, [netid, first, last, rank, deptId, active]);
  }

  async function get(path: string) {
    const response = await fetch(`${base}${path}`);
    return { status: response.status, body: await response.json() };
  }

  describe('GET /api/admin/professors', () => {
    test('returns an empty list when there are no professors', async () => {
      assert.deepEqual(await get('/api/admin/professors'), { status: 200, body: [] });
    });

    test('lists every professor, inactive ones included, by last name then first name', async () => {
      await addProfessor('zed000001', 'Zoe', 'Adams', 'full', 1);
      await addProfessor('amy000002', 'Amy', 'Adams', 'assistant', 2, false);
      await addProfessor('bob000003', 'Bob', 'Brown', 'associate', 1);
      await addProfessor('cal000004', 'Cal', 'Abbot', 'full', 2);
      const { status, body } = await get('/api/admin/professors');
      assert.equal(status, 200);
      assert.deepEqual(body.map((p: { netid: string }) => p.netid), ['cal000004', 'amy000002', 'zed000001', 'bob000003']);
      assert.deepEqual(body[1], {
        netid: 'amy000002', firstName: 'Amy', lastName: 'Adams', displayName: 'Dr. Amy Adams',
        email: 'amy000002@example.edu', rank: 'assistant',
        department: { deptId: '2', deptName: 'Mathematics' }, isAc: false, isActive: false,
      });
    });

    test('isAc is true only for an active ac_member row', async () => {
      await addProfessor('act000001', 'Active', 'Committee', 'full', 1);
      await addProfessor('old000002', 'Former', 'Committee', 'full', 1);
      await addProfessor('fac000003', 'Plain', 'Faculty', 'full', 1);
      await sql("INSERT INTO ac_member (netid, is_active) VALUES ('act000001', true), ('old000002', false)");
      const { body } = await get('/api/admin/professors');
      const isAc = Object.fromEntries(body.map((p: { netid: string; isAc: boolean }) => [p.netid, p.isAc]));
      assert.deepEqual(isAc, { act000001: true, old000002: false, fac000003: false });
    });
  });
});
