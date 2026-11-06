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

  async function send(method: string, path: string, body: unknown) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }

  // A term relative to today; returns its ID. Season and year only need to be unique here.
  async function addRelativeTerm(season: string, year: number, startOffset: number, endOffset: number) {
    const { rows } = await sql(`INSERT INTO term (season, year, start_date, end_date)
                                VALUES ($1, $2, CURRENT_DATE + $3::int, CURRENT_DATE + $4::int) RETURNING term_id`,
    [season, year, startOffset, endOffset]);
    return rows[0].term_id as number;
  }

  async function storedProfessor(netid: string) {
    const { rows } = await sql(`SELECT first_name, last_name, email, rank, dept_id, eval_interval_years,
                                       baseline_last_eval_term, start_term, is_active
                                FROM professor WHERE netid = $1`, [netid]);
    return rows[0];
  }

  describe('POST /api/admin/professors', () => {
    const newProfessor = {
      netid: 'new123456', firstName: 'Nina', lastName: 'Newman', email: 'nina.newman@example.edu',
      rank: 'assistant', deptId: '2',
    };
    let nextTermId: number;

    beforeEach(async () => {
      await addRelativeTerm('fall', 2090, -30, 30);
      await addRelativeTerm('fall', 2091, 200, 260);
      nextTermId = await addRelativeTerm('spring', 2091, 60, 120);
    });

    test('adds the professor and returns their admin row', async () => {
      const { status, body } = await send('POST', '/api/admin/professors', newProfessor);
      assert.equal(status, 201);
      assert.deepEqual(body, {
        netid: 'new123456', firstName: 'Nina', lastName: 'Newman', displayName: 'Dr. Nina Newman',
        email: 'nina.newman@example.edu', rank: 'assistant',
        department: { deptId: '2', deptName: 'Mathematics' }, isAc: false, isActive: true,
      });
    });

    test('starts the professor in the earliest term after today, with no baseline', async () => {
      await send('POST', '/api/admin/professors', newProfessor);
      const stored = await storedProfessor('new123456');
      assert.equal(stored.start_term, nextTermId);
      assert.equal(stored.baseline_last_eval_term, null);
      assert.equal(stored.is_active, true);
    });

    test('sets eval_interval_years from the rank', async () => {
      for (const [netid, rank, years] of [['asi000001', 'assistant', 1], ['aso000002', 'associate', 2], ['ful000003', 'full', 2]] as const) {
        const { status } = await send('POST', '/api/admin/professors', { ...newProfessor, netid, email: `${netid}@example.edu`, rank });
        assert.equal(status, 201, rank);
        assert.equal((await storedProfessor(netid)).eval_interval_years, years, rank);
      }
    });

    test('stores trimmed values and a lowercase netid', async () => {
      const { status, body } = await send('POST', '/api/admin/professors', {
        ...newProfessor, netid: ' NEW123456 ', firstName: ' Nina ', lastName: ' Newman ', email: ' Nina.Newman@Example.edu ',
      });
      assert.equal(status, 201);
      assert.equal(body.netid, 'new123456');
      const stored = await storedProfessor('new123456');
      assert.deepEqual([stored.first_name, stored.last_name, stored.email], ['Nina', 'Newman', 'Nina.Newman@Example.edu']);
    });

    test('returns 409 NEXT_TERM_MISSING when no term starts after today', async () => {
      await sql('DELETE FROM term WHERE start_date > CURRENT_DATE');
      const { status, body } = await send('POST', '/api/admin/professors', newProfessor);
      assert.equal(status, 409);
      assert.equal(body.error.code, 'NEXT_TERM_MISSING');
      assert.equal(await storedProfessor('new123456'), undefined);
    });

    test('returns 409 NETID_TAKEN for an existing netid, active or not', async () => {
      await addProfessor('new123456', 'Old', 'Owner', 'full', 1, false);
      const { status, body } = await send('POST', '/api/admin/professors', newProfessor);
      assert.equal(status, 409);
      assert.equal(body.error.code, 'NETID_TAKEN');
      assert.equal((await storedProfessor('new123456')).first_name, 'Old');
    });

    test('returns 409 EMAIL_TAKEN for an email that differs only in case', async () => {
      await sql(`INSERT INTO professor (netid, first_name, last_name, email, rank, dept_id, eval_interval_years, start_term)
                 VALUES ('own000001', 'Email', 'Owner', 'NINA.NEWMAN@example.edu', 'full', 1, 2, 1)`);
      const { status, body } = await send('POST', '/api/admin/professors', newProfessor);
      assert.equal(status, 409);
      assert.equal(body.error.code, 'EMAIL_TAKEN');
      assert.equal(await storedProfessor('new123456'), undefined);
    });

    test('returns 400 for a department that does not exist', async () => {
      const { status, body } = await send('POST', '/api/admin/professors', { ...newProfessor, deptId: '99' });
      assert.equal(status, 400);
      assert.equal(body.error.code, 'INVALID_PROFESSOR');
      assert.match(body.error.message, /deptId/);
      assert.equal(await storedProfessor('new123456'), undefined);
    });

    test('returns 400 for an invalid body', async () => {
      const { status, body } = await send('POST', '/api/admin/professors', { ...newProfessor, netid: 'nina' });
      assert.equal(status, 400);
      assert.equal(body.error.code, 'INVALID_PROFESSOR');
      assert.match(body.error.message, /netid/);
    });
  });

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

  describe('GET /api/admin/departments', () => {
    test('lists departments sorted by name with string IDs', async () => {
      await sql("INSERT INTO department (dept_name) VALUES ('Biology'), ('Physics')");
      assert.deepEqual(await get('/api/admin/departments'), {
        status: 200,
        body: [
          { deptId: '3', deptName: 'Biology' },
          { deptId: '1', deptName: 'Computer Science' },
          { deptId: '2', deptName: 'Mathematics' },
          { deptId: '4', deptName: 'Physics' },
        ],
      });
    });

    test('returns an empty list when there are no departments', async () => {
      await sql('TRUNCATE department RESTART IDENTITY CASCADE');
      assert.deepEqual(await get('/api/admin/departments'), { status: 200, body: [] });
    });
  });
});
