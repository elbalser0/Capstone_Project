// Database tests for GET /api/terms/{termId}/due-preview.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { after, before, beforeEach, describe, test } from 'node:test';
import { errorHandler } from '../src/middleware/error.middleware.js';
import type { AuthUser, Role } from '../src/services/user.service.js';
import { termsRouter } from '../src/routes/terms.routes.js';
import { skip, sql, useTestDatabase } from './db-test-helper.js';

function user(role: Role): AuthUser {
  return {
    netid: role === 'AC' ? 'ac' : 'faculty', firstName: 'Test', lastName: 'User', displayName: 'Dr. Test User',
    email: `${role}@example.edu`, rank: 'full', department: { deptId: '1', deptName: 'Computer Science' }, role,
  };
}

const routeApp = express();
routeApp.use((req, _res, next) => {
  // Isolate the AC route guard from Firebase token verification in these endpoint tests.
  req.user = user(req.header('x-test-role') === 'AC' ? 'AC' : 'faculty');
  next();
});
routeApp.use('/api/terms', termsRouter);
routeApp.use(errorHandler);

describe('term due preview against the database', { skip }, () => {
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
    await sql('TRUNCATE department, term, professor RESTART IDENTITY CASCADE');
    await sql("INSERT INTO department (dept_name) VALUES ('Computer Science')");
    await sql(`INSERT INTO term (season, year, start_date, end_date) VALUES
               ('fall', 2022, '2022-08-15', '2022-12-15'),
               ('spring', 2024, '2024-01-15', '2024-05-15'),
               ('fall', 2026, '2026-08-15', '2026-12-15')`);
    await sql(`INSERT INTO professor (netid, first_name, last_name, email, rank, dept_id,
                                      eval_interval_years, baseline_last_eval_term, start_term)
               VALUES ('ac', 'Committee', 'Member', 'ac@example.edu', 'full', 1, 2, 1, 1),
                      ('no-cycle', 'No', 'Cycle', 'no-cycle@example.edu', 'associate', 1, 2, 1, 1),
                      ('saved', 'Saved', 'Roster', 'saved@example.edu', 'associate', 1, 2, 3, 1)`);
    await sql("INSERT INTO ac_member (netid) VALUES ('ac')");
    await sql(`INSERT INTO eval_cycle (term_id, started_by, start_date, signup_deadline, observation_deadline, feedback_deadline)
               VALUES (3, 'ac', '2026-08-15', '2026-09-01', '2026-11-15', '2026-12-01')`);
    // Fall 2024 is intentionally not configured. The saved status conflicts with the calculated status.
    await sql("INSERT INTO eval_due (cycle_id, netid, due_status) VALUES (1, 'saved', 'overdue')");
  });

  async function preview(role: Role, termId: string) {
    return fetch(`${base}/api/terms/${termId}/due-preview`, { headers: { 'x-test-role': role } });
  }

  test('an authenticated non-AC user gets 403', async () => {
    const response = await preview('faculty', '2');
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'FORBIDDEN');
  });

  test('an invalid term ID gets 400 and an unknown term gets 404', async () => {
    const invalid = await preview('AC', '0');
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, 'INVALID_TERM_ID');

    const unknown = await preview('AC', '99');
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).error.code, 'NOT_FOUND');
  });

  test('an existing cycle uses its saved due roster status', async () => {
    const response = await preview('AC', '3');
    assert.equal(response.status, 200);
    const rows = await response.json();
    const saved = rows.find((row: { professor: { netid: string } }) => row.professor.netid === 'saved');
    assert.equal(saved.dueStatus, 'OVERDUE');
  });

  test('without a cycle, due status is calculated and an unconfigured due term keeps its real label', async () => {
    const response = await preview('AC', '2');
    assert.equal(response.status, 200);
    const rows = await response.json();
    const professor = rows.find((row: { professor: { netid: string } }) => row.professor.netid === 'no-cycle');
    assert.equal(professor.dueStatus, 'NOT_DUE');
    assert.deepEqual(professor.dueTerm, {
      termId: null, season: 'fall', year: 2024, label: 'Fall 2024', startDate: null, endDate: null,
    });
  });
});
