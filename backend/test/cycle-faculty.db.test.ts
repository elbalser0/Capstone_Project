// Database tests for /api/cycles/{cycleId}/faculty. Setup is in db-test-helper.ts.
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

describe('cycle faculty list against the database', { skip }, () => {
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
               ('fall', 2026, '2026-08-15', '2026-12-15'),
               ('spring', 2026, '2026-01-15', '2026-05-15')`);
    for (const [netid, first, last, rank, baseline, active] of [
      ['ac', 'Committee', 'Member', 'full', null, true],
      ['a-zed', 'Zed', 'Zulu', 'assistant', 1, true],
      ['a-amy', 'Amy', 'Able', 'assistant', 1, true],
      ['a-current', 'Current', 'Cycle', 'assistant', 1, true],
      ['b-base', 'Base', 'Fallback', 'associate', 2, true],
      ['b-prior', 'Prior', 'Completed', 'associate', 1, true],
      ['c-none', 'No', 'Baseline', 'full', null, true],
      ['inactive', 'Inactive', 'Professor', 'full', 1, false],
      ['n-new', 'New', 'Hire', 'assistant', null, true],
    ] as const) {
      // A schema trigger sets eval_interval_years from rank (assistant 1, associate and full 2)
      // and ignores the value sent, so the insert sends the same value the trigger keeps.
      await sql(`INSERT INTO professor (netid, first_name, last_name, email, rank, dept_id,
                                        eval_interval_years, baseline_last_eval_term, start_term, is_active)
                 VALUES ($1, $2, $3, $1 || '@example.edu', $4, 1, $8, $5, $7, $6)`,
      [netid, first, last, rank, baseline, active, netid === 'n-new' ? 3 : 1, rank === 'assistant' ? 1 : 2]);
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

  async function getFaculty(role: Role, cycleId = '1') {
    return fetch(`${base}/api/cycles/${cycleId}/faculty`, { headers: { 'x-test-role': role } });
  }
  type Row = { professor: { netid: string; email: string }; dueStatus: string; lastObservedTerm: { label: string } | null;
    dueTerm: { termId: string | null; label: string; startDate: string | null } };
  const find = (rows: Row[], netid: string) => rows.find((row) => row.professor.netid === netid)!;

  test('a non-AC user gets 403, a bad id 400 and an unknown cycle 404', async () => {
    assert.equal((await getFaculty('faculty')).status, 403);
    const bad = await getFaculty('AC', 'abc');
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error.code, 'INVALID_CYCLE_ID');
    const missing = await getFaculty('AC', '99');
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, 'NOT_FOUND');
  });

  test('lists every active professor, NOT_DUE included, overdue first then due then not due, by last name', async () => {
    const response = await getFaculty('AC');
    assert.equal(response.status, 200);
    const rows: Row[] = await response.json();
    assert.deepEqual(rows.map((row) => [row.professor.netid, row.dueStatus]), [
      ['b-prior', 'OVERDUE'], ['a-current', 'OVERDUE'], ['a-zed', 'OVERDUE'],
      ['a-amy', 'DUE'], ['c-none', 'DUE'], ['b-base', 'DUE'],
      ['n-new', 'NOT_DUE'], ['ac', 'NOT_DUE'],
    ]);
    assert.equal(find(rows, 'a-amy').professor.email, 'a-amy@example.edu');
  });

  test('last observed comes from before the cycle term; the due semester follows the evaluation rules', async () => {
    const rows: Row[] = await (await getFaculty('AC')).json();
    // Signed in Spring 2024, every 2 years: due Spring 2026, which has a term row.
    assert.equal(find(rows, 'b-prior').lastObservedTerm!.label, 'Spring 2024');
    assert.deepEqual(find(rows, 'b-prior').dueTerm, {
      termId: '4', season: 'spring', year: 2026, label: 'Spring 2026', startDate: '2026-01-15', endDate: '2026-05-15',
    });
    // The Fall 2026 observation is this cycle's own, so last observed stays the Fall 2022 baseline.
    assert.equal(find(rows, 'a-current').lastObservedTerm!.label, 'Fall 2022');
    // Assistants are observed every year, so the Fall 2026 observation makes them due Fall 2027.
    assert.equal(find(rows, 'a-current').dueTerm.label, 'Fall 2027');
    // A due semester without a term row yet has a label but no id or dates.
    assert.deepEqual(find(rows, 'a-zed').dueTerm, {
      termId: null, season: 'fall', year: 2023, label: 'Fall 2023', startDate: null, endDate: null,
    });
    // Never observed: two years after the start term.
    assert.equal(find(rows, 'n-new').lastObservedTerm, null);
    assert.equal(find(rows, 'n-new').dueTerm.label, 'Fall 2028');
  });

  test('assistants get a 1-year interval from the schema, others 2', async () => {
    const { rows } = await sql("SELECT netid, eval_interval_years FROM professor WHERE netid IN ('a-amy', 'b-base', 'c-none') ORDER BY netid");
    assert.deepEqual(rows.map((row) => [row.netid, row.eval_interval_years]), [['a-amy', 1], ['b-base', 2], ['c-none', 2]]);
  });

  test('omits inactive professors', async () => {
    const rows: Row[] = await (await getFaculty('AC')).json();
    assert.equal(find(rows, 'inactive'), undefined);
  });
});
