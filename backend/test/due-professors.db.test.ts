// Database tests for /api/cycles/{cycleId}/due-professors. Setup is in db-test-helper.ts.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { after, before, beforeEach, describe, test } from 'node:test';
import { skip, sql, useTestDatabase } from './db-test-helper.js';
import type { AuthUser, Role } from '../src/services/user.service.js';
import { cyclesRouter } from '../src/routes/cycles.routes.js';
import { errorHandler } from '../src/middleware/error.middleware.js';

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
routeApp.use('/api/cycles', cyclesRouter);
routeApp.use(errorHandler);

describe('cycle due professors against the database', { skip }, () => {
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
    for (const [netid, first, last, rank, baseline, active] of [
      ['ac', 'Committee', 'Member', 'full', null, true],
      ['a-zed', 'Zed', 'Zulu', 'assistant', 1, true],
      ['a-amy', 'Amy', 'Able', 'assistant', 1, true],
      ['a-current', 'Current', 'Cycle', 'assistant', 1, true],
      ['b-base', 'Base', 'Fallback', 'associate', 2, true],
      ['b-prior', 'Prior', 'Completed', 'associate', 1, true],
      ['c-none', 'No', 'Baseline', 'full', null, true],
      ['inactive', 'Inactive', 'Professor', 'full', 1, false],
    ] as const) {
      await sql(`INSERT INTO professor (netid, first_name, last_name, email, rank, dept_id,
                                        eval_interval_years, baseline_last_eval_term, start_term, is_active)
                 VALUES ($1, $2, $3, $1 || '@example.edu', $4, 1, 2, $5, 1, $6)`,
      [netid, first, last, rank, baseline, active]);
    }
    await sql("INSERT INTO ac_member (netid) VALUES ('ac')");
    await sql(`INSERT INTO eval_cycle (term_id, started_by, start_date, signup_deadline, observation_deadline, feedback_deadline)
               VALUES (3, 'ac', '2026-08-15', '2026-09-01', '2026-11-15', '2026-12-01'),
                      (2, 'ac', '2024-01-15', '2024-02-01', '2024-05-15', '2024-06-01')`);
    await sql(`INSERT INTO eval_due (cycle_id, netid, due_status) VALUES
               (1, 'a-zed', 'overdue'), (1, 'a-amy', 'due'), (1, 'a-current', 'overdue'),
               (1, 'b-base', 'due'), (1, 'b-prior', 'overdue'), (1, 'c-none', 'due'), (1, 'inactive', 'overdue')`);
    await sql("INSERT INTO template_version (version_no, status, created_by, published_date) VALUES (1, 'live', 'ac', now())");
    await sql("INSERT INTO course (dept_id, course_num, title, course_level) VALUES (1, '1001', 'Test Course', 1000)");
    await sql(`INSERT INTO section (course_id, term_id, section_num, instructor_id, class_mode)
               VALUES (1, 3, '001', 'a-current', 'in-person'), (1, 2, '002', 'b-prior', 'in-person')`);
    await sql(`INSERT INTO sign_up (cycle_id, observee_netid, section_id) VALUES (1, 'a-current', 1), (2, 'b-prior', 2)`);
    await sql(`INSERT INTO proposed_date (signup_id, date) VALUES (1, CURRENT_DATE), (2, CURRENT_DATE)`);
    await sql(`INSERT INTO observer_match (signup_id, observer_netid) VALUES (1, 'ac'), (2, 'ac')`);
    await sql(`INSERT INTO observation_request (signup_id, observer_netid, status) VALUES (1, 'ac', 'accepted'), (2, 'ac', 'accepted')`);
    await sql(`INSERT INTO observation (signup_id, observer_netid, version_id, scheduled_date, status,
                                       observee_signed_date, observer_signed_date)
               VALUES (1, 'ac', 1, CURRENT_DATE, 'completed', now(), now()),
                      (2, 'ac', 1, CURRENT_DATE, 'completed', now(), now())`);
  });

  async function getRoster(role: Role, cycleId = '1') {
    return fetch(`${base}/api/cycles/${cycleId}/due-professors`, { headers: { 'x-test-role': role } });
  }

  test('an authenticated non-AC user gets 403', async () => {
    const response = await getRoster('faculty');
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'FORBIDDEN');
  });

  test('an unknown cycle gets 404 and a cycle with no due professors returns an empty list', async () => {
    const missing = await getRoster('AC', '99');
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, 'NOT_FOUND');
    await sql('DELETE FROM eval_due WHERE cycle_id = 1');
    const empty = await getRoster('AC');
    assert.equal(empty.status, 200);
    assert.deepEqual(await empty.json(), []);
  });

  test('returns the saved roster sorted by rank then name and uses baseline or null when appropriate', async () => {
    const response = await getRoster('AC');
    assert.equal(response.status, 200);
    const rows = await response.json();
    assert.deepEqual(rows.map((row: { professor: { netid: string } }) => row.professor.netid),
      ['a-amy', 'a-current', 'a-zed', 'b-prior', 'b-base', 'c-none']);
    assert.equal(rows[0].dueStatus, 'DUE');
    assert.equal(rows[1].dueStatus, 'OVERDUE');
    assert.equal(rows.find((row: { professor: { netid: string } }) => row.professor.netid === 'b-base').lastObservedTerm.label, 'Spring 2024');
    assert.equal(rows.find((row: { professor: { netid: string } }) => row.professor.netid === 'b-prior').lastObservedTerm.label, 'Spring 2024');
    assert.equal(rows.find((row: { professor: { netid: string } }) => row.professor.netid === 'c-none').lastObservedTerm, null);
  });

  test('does not report an observation from the cycle term as the last observed term', async () => {
    const response = await getRoster('AC');
    const rows = await response.json();
    assert.equal(rows.find((row: { professor: { netid: string } }) => row.professor.netid === 'a-current').lastObservedTerm.label, 'Fall 2022');
  });

  test('omits inactive professors and restores their saved status after reactivation', async () => {
    const read = async () => {
      const response = await getRoster('AC');
      const rows = await response.json();
      return rows.find((row: { professor: { netid: string } }) => row.professor.netid === 'inactive');
    };
    assert.equal(await read(), undefined);
    await sql("UPDATE professor SET is_active = true WHERE netid = 'inactive'");
    assert.equal((await read()).dueStatus, 'OVERDUE');
  });
});
