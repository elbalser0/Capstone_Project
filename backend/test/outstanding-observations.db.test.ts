// Database and route coverage for GET /api/dashboard/outstanding-observations.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { beforeEach, describe, test } from 'node:test';
import { dashboardRouter } from '../src/routes/dashboard.routes.js';
import { errorHandler } from '../src/middleware/error.middleware.js';
import type { AuthUser } from '../src/services/user.service.js';
import { skip, sql, useTestDatabase } from './db-test-helper.js';

function testUser(role: AuthUser['role']): AuthUser {
  return {
    netid: role === 'AC' ? 'ac' : 'faculty',
    firstName: 'Test', lastName: role, displayName: `Dr. Test ${role}`,
    email: `${role}@example.edu`, rank: 'full',
    department: { deptId: '1', deptName: 'Computer Science' }, role,
  };
}

async function withDashboardServer<T>(run: (base: string) => Promise<T>) {
  const routeApp = express();
  // Inject a test identity so these integration tests exercise the production AC guard
  // without depending on Firebase credentials. The real unauthenticated route is covered
  // in dashboard.test.ts.
  routeApp.use('/api/dashboard', (req, _res, next) => {
    req.user = req.header('authorization') === 'Bearer ac'
      ? testUser('AC')
      : testUser('faculty');
    next();
  }, dashboardRouter);
  routeApp.use(errorHandler);
  const server = routeApp.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => server.once('listening', resolve).once('error', reject));
    return await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
}

describe('outstanding observations dashboard against the database', { skip }, () => {
  useTestDatabase();

  beforeEach(async () => {
    await sql('TRUNCATE department, term, professor RESTART IDENTITY CASCADE');
    await sql("INSERT INTO department (dept_name) VALUES ('Computer Science')");
    await sql(`INSERT INTO term (season, year, start_date, end_date)
               VALUES ('fall', 2026, CURRENT_DATE - 30, CURRENT_DATE + 90),
                      ('spring', 2026, CURRENT_DATE - 200, CURRENT_DATE - 100)`);
    for (const [netid, rank] of [
      ['ac', 'full'], ['assistant', 'assistant'], ['assistant2', 'assistant'], ['associate', 'associate'],
      ['full', 'full'], ['observer', 'full'],
    ]) {
      await sql(`INSERT INTO professor (netid, first_name, last_name, email, rank, dept_id, eval_interval_years, start_term)
                 VALUES ($1, $1, 'Test', $1 || '@example.edu', $2, 1, 2, 1)`, [netid, rank]);
    }
    await sql("INSERT INTO ac_member (netid) VALUES ('ac')");
    await sql("INSERT INTO template_version (version_no, status, created_by) VALUES (1, 'draft', 'ac')");
    await sql(`INSERT INTO eval_cycle (term_id, started_by, start_date, signup_deadline, observation_deadline, feedback_deadline)
               VALUES (1, 'ac', CURRENT_DATE - 10, CURRENT_DATE - 5, CURRENT_DATE + 30, CURRENT_DATE + 45),
                      (2, 'ac', CURRENT_DATE - 150, CURRENT_DATE - 145, CURRENT_DATE - 120, CURRENT_DATE - 100)`);
    await sql("INSERT INTO course (dept_id, course_num, title, course_level) VALUES (1, '1000', 'Test Course', 1000)");
    await sql(`INSERT INTO section (course_id, term_id, section_num, instructor_id, class_mode)
               VALUES (1, 1, '001', 'assistant', 'in-person'),
                      (1, 1, '002', 'associate', 'in-person'),
                      (1, 1, '003', 'full', 'in-person'),
                      (1, 2, '004', 'assistant', 'in-person'),
                      (1, 1, '005', 'assistant2', 'in-person')`);
    await sql(`INSERT INTO sign_up (cycle_id, observee_netid, section_id)
               VALUES (1, 'assistant', 1), (1, 'associate', 2), (1, 'full', 3), (2, 'assistant', 4), (1, 'assistant2', 5)`);
    await sql(`INSERT INTO proposed_date (signup_id, date)
               SELECT signup_id, CURRENT_DATE + 1 FROM sign_up`);
    await sql(`INSERT INTO observer_match (signup_id, observer_netid)
               SELECT signup_id, 'observer' FROM sign_up WHERE signup_id <= 4`);
    await sql(`INSERT INTO observation_request (signup_id, observer_netid, status, responded_date)
               SELECT signup_id, 'observer', 'accepted', now() FROM sign_up WHERE signup_id <= 4`);
    await sql(`INSERT INTO observation (signup_id, observer_netid, version_id, scheduled_date, status, reason_not_completed,
                                       observer_signed_date, observee_signed_date)
               VALUES (1, 'observer', 1, CURRENT_DATE + 1, 'scheduled', NULL, NULL, NULL),
                      (2, 'observer', 1, CURRENT_DATE + 1, 'not_completed', 'Class cancelled', NULL, NULL),
                      (3, 'observer', 1, CURRENT_DATE + 1, 'completed', NULL, now(), now()),
                      (4, 'observer', 1, CURRENT_DATE + 1, 'scheduled', NULL, NULL, NULL)`);
  });

  test('AC counts current-cycle sign-ups by observee rank, including those without observations and excluding completed or other-cycle records', async () => {
    await withDashboardServer(async (base) => {
      const response = await fetch(`${base}/api/dashboard/outstanding-observations`, {
        headers: { authorization: 'Bearer ac' },
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        cycleId: '1', total: 3,
        byRank: { assistant: 2, associate: 1, full: 0 },
      });
    });
  });

  test('an authenticated faculty member is forbidden', async () => {
    await withDashboardServer(async (base) => {
      const response = await fetch(`${base}/api/dashboard/outstanding-observations`, {
        headers: { authorization: 'Bearer faculty' },
      });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error.code, 'FORBIDDEN');
    });
  });

  test('ranks with no outstanding observations are still returned as zero', async () => {
    await sql(`UPDATE observation
               SET status = 'completed', reason_not_completed = NULL,
                   observer_signed_date = now(), observee_signed_date = now()
               WHERE signup_id IN (1, 2)`);
    await sql('DELETE FROM proposed_date WHERE signup_id = 5');
    await sql('DELETE FROM sign_up WHERE signup_id = 5');
    await withDashboardServer(async (base) => {
      const response = await fetch(`${base}/api/dashboard/outstanding-observations`, {
        headers: { authorization: 'Bearer ac' },
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        cycleId: '1', total: 0,
        byRank: { assistant: 0, associate: 0, full: 0 },
      });
    });
  });

  test('returns 404 NO_CYCLE when no cycle has started', async () => {
    await sql(`UPDATE eval_cycle SET start_date = CURRENT_DATE + 1,
               signup_deadline = CURRENT_DATE + 1,
               observation_deadline = CURRENT_DATE + 2,
               feedback_deadline = CURRENT_DATE + 3`);
    await withDashboardServer(async (base) => {
      const response = await fetch(`${base}/api/dashboard/outstanding-observations`, {
        headers: { authorization: 'Bearer ac' },
      });
      assert.equal(response.status, 404);
      assert.equal((await response.json()).error.code, 'NO_CYCLE');
    });
  });
});
