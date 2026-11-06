// Database tests for PATCH /api/admin/professors/:netid. Setup is in db-test-helper.ts.
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

// Professors used below. 'acm000001' is an AC member who starts the cycles.
const AC = 'acm000001';
const TARGET = 'tgt000001';
const OBSERVEE = 'obe000001';

describe('updating a professor against the database', { skip }, () => {
  useTestDatabase();
  let base: string;
  let server: ReturnType<typeof routeApp.listen>;
  // The current cycle (open until its feedback deadline) and an older one.
  let currentCycle: number;
  let olderCycle: number;
  let currentTerm: number;
  let olderTerm: number;

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
    await sql("INSERT INTO department (dept_name) VALUES ('Computer Science')");
    olderTerm = (await sql(`INSERT INTO term (season, year, start_date, end_date)
                            VALUES ('fall', 2024, '2024-08-24', '2024-12-11') RETURNING term_id`)).rows[0].term_id;
    currentTerm = (await sql(`INSERT INTO term (season, year, start_date, end_date)
                              VALUES ('fall', 2090, CURRENT_DATE - 30, CURRENT_DATE + 60) RETURNING term_id`)).rows[0].term_id;
    for (const [netid, rank, active] of [
      [AC, 'full', true], [TARGET, 'associate', true], [OBSERVEE, 'assistant', true], ['old000001', 'full', false],
    ] as const) {
      await sql(`INSERT INTO professor (netid, first_name, last_name, email, rank, dept_id, eval_interval_years, start_term, is_active)
                 VALUES ($1, 'Test', $1, $1 || '@example.edu', $2, 1, 2, $3, $4)`, [netid, rank, olderTerm, active]);
    }
    await sql('INSERT INTO ac_member (netid) VALUES ($1)', [AC]);
    olderCycle = (await sql(`INSERT INTO eval_cycle (term_id, started_by, start_date, signup_deadline, observation_deadline, feedback_deadline)
                             VALUES ($1, $2, '2024-08-30', '2024-09-15', '2024-11-15', '2024-12-01') RETURNING cycle_id`,
    [olderTerm, AC])).rows[0].cycle_id;
    currentCycle = (await sql(`INSERT INTO eval_cycle (term_id, started_by, start_date, signup_deadline, observation_deadline, feedback_deadline)
                               VALUES ($1, $2, CURRENT_DATE - 10, CURRENT_DATE - 5, CURRENT_DATE + 10, CURRENT_DATE + 20)
                               RETURNING cycle_id`, [currentTerm, AC])).rows[0].cycle_id;
    await sql("INSERT INTO template_version (version_no, status, created_by, published_date) VALUES (1, 'live', $1, now())", [AC]);
    await sql("INSERT INTO course (dept_id, course_num, title, course_level) VALUES (1, '1001', 'Test Course', 1000)");
  });

  async function patch(netid: string, body: unknown) {
    const response = await fetch(`${base}/api/admin/professors/${netid}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }

  async function stored(netid: string) {
    const { rows } = await sql(`SELECT p.rank, p.eval_interval_years, p.is_active, a.is_active AS ac_active
                                FROM professor AS p LEFT JOIN ac_member AS a ON a.netid = p.netid
                                WHERE p.netid = $1`, [netid]);
    return rows[0];
  }

  let sectionNo = 0;
  // A sign-up by the observee in the given cycle, for a section they teach in that cycle's term.
  async function signUp(observee: string, cycleId: number) {
    const termId = cycleId === currentCycle ? currentTerm : olderTerm;
    sectionNo += 1;
    const section = (await sql(`INSERT INTO section (course_id, term_id, section_num, instructor_id, class_mode)
                                VALUES (1, $1, $2, $3, 'in-person') RETURNING section_id`,
    [termId, String(sectionNo).padStart(3, '0'), observee])).rows[0].section_id;
    return (await sql('INSERT INTO sign_up (cycle_id, observee_netid, section_id) VALUES ($1, $2, $3) RETURNING signup_id',
      [cycleId, observee, section])).rows[0].signup_id as number;
  }

  async function request(signupId: number, observer: string, status: string) {
    await sql('INSERT INTO observer_match (signup_id, observer_netid) VALUES ($1, $2)', [signupId, observer]);
    await sql('INSERT INTO observation_request (signup_id, observer_netid, status) VALUES ($1, $2, $3)', [signupId, observer, status]);
  }

  async function scheduleObservation(signupId: number, observer: string) {
    await sql('INSERT INTO proposed_date (signup_id, date) VALUES ($1, CURRENT_DATE + 5)', [signupId]);
    await sql(`INSERT INTO observation (signup_id, observer_netid, version_id, scheduled_date)
               VALUES ($1, $2, 1, CURRENT_DATE + 5)`, [signupId, observer]);
  }

  describe('validation', () => {
    test('returns 404 for an unknown netid', async () => {
      const { status, body } = await patch('zzz999999', { rank: 'full' });
      assert.equal(status, 404);
      assert.equal(body.error.code, 'NOT_FOUND');
    });

    test('finds the professor whatever the netid case', async () => {
      const { status, body } = await patch(TARGET.toUpperCase(), { rank: 'full' });
      assert.equal(status, 200);
      assert.equal(body.netid, TARGET);
    });

    test('returns 400 for an empty body or an unknown field', async () => {
      for (const change of [{}, { email: 'x@example.edu' }, { isAc: 'yes' }]) {
        const { status, body } = await patch(TARGET, change);
        assert.equal(status, 400, JSON.stringify(change));
        assert.equal(body.error.code, 'INVALID_PROFESSOR');
      }
    });
  });

  describe('rank', () => {
    test('changes the rank, and eval_interval_years follows it', async () => {
      const { status, body } = await patch(TARGET, { rank: 'assistant' });
      assert.equal(status, 200);
      assert.equal(body.rank, 'assistant');
      assert.equal((await stored(TARGET)).eval_interval_years, 1);
      await patch(TARGET, { rank: 'full' });
      assert.deepEqual([(await stored(TARGET)).rank, (await stored(TARGET)).eval_interval_years], ['full', 2]);
      await patch(TARGET, { rank: 'associate' });
      assert.equal((await stored(TARGET)).eval_interval_years, 2);
    });
  });

  describe('AC membership', () => {
    test('isAc true adds an active membership', async () => {
      const { status, body } = await patch(TARGET, { isAc: true });
      assert.equal(status, 200);
      assert.equal(body.isAc, true);
      assert.equal((await stored(TARGET)).ac_active, true);
    });

    test('isAc true reactivates an existing membership without a second row', async () => {
      await sql('INSERT INTO ac_member (netid, is_active) VALUES ($1, false)', [TARGET]);
      assert.equal((await patch(TARGET, { isAc: true })).body.isAc, true);
      assert.equal((await sql('SELECT count(*)::int AS n FROM ac_member WHERE netid = $1', [TARGET])).rows[0].n, 1);
    });

    test('isAc false keeps the row and marks it inactive', async () => {
      const { status, body } = await patch(AC, { isAc: false });
      assert.equal(status, 200);
      assert.equal(body.isAc, false);
      assert.equal((await stored(AC)).ac_active, false);
    });

    test('isAc false for a professor who was never on the AC changes nothing', async () => {
      assert.equal((await patch(TARGET, { isAc: false })).status, 200);
      assert.equal((await sql('SELECT count(*)::int AS n FROM ac_member WHERE netid = $1', [TARGET])).rows[0].n, 0);
    });

    test('isAc true for an inactive professor returns 409 PROFESSOR_INACTIVE', async () => {
      const { status, body } = await patch('old000001', { isAc: true });
      assert.equal(status, 409);
      assert.equal(body.error.code, 'PROFESSOR_INACTIVE');
      assert.equal((await stored('old000001')).ac_active, null);
    });

    test('reactivating and adding to the AC in one request works', async () => {
      const { status, body } = await patch('old000001', { isActive: true, isAc: true });
      assert.equal(status, 200);
      assert.deepEqual([body.isActive, body.isAc], [true, true]);
    });

    test('deactivating and adding to the AC in one request is rolled back completely', async () => {
      const { status, body } = await patch(TARGET, { rank: 'full', isActive: false, isAc: true });
      assert.equal(status, 409);
      assert.equal(body.error.code, 'PROFESSOR_INACTIVE');
      assert.deepEqual(await stored(TARGET), { rank: 'associate', eval_interval_years: 2, is_active: true, ac_active: null });
    });
  });

  describe('deactivating', () => {
    test('deactivates the professor and their AC membership', async () => {
      const { status, body } = await patch(AC, { isActive: false });
      assert.equal(status, 200);
      assert.deepEqual([body.isActive, body.isAc], [false, false]);
      assert.deepEqual(await stored(AC), { rank: 'full', eval_interval_years: 2, is_active: false, ac_active: false });
    });

    test('reactivating does not restore AC membership', async () => {
      await patch(AC, { isActive: false });
      const { status, body } = await patch(AC, { isActive: true });
      assert.equal(status, 200);
      assert.deepEqual([body.isActive, body.isAc], [true, false]);
    });

    async function assertBlocked() {
      const { status, body } = await patch(TARGET, { isActive: false });
      assert.equal(status, 409);
      assert.equal(body.error.code, 'IN_CURRENT_CYCLE');
      assert.equal((await stored(TARGET)).is_active, true);
    }

    async function assertNotBlocked() {
      const { status, body } = await patch(TARGET, { isActive: false });
      assert.equal(status, 200, JSON.stringify(body));
      assert.equal(body.isActive, false);
    }

    test('returns 409 IN_CURRENT_CYCLE when they signed up in the current cycle', async () => {
      await signUp(TARGET, currentCycle);
      await assertBlocked();
    });

    test('returns 409 IN_CURRENT_CYCLE for a pending observation request', async () => {
      await request(await signUp(OBSERVEE, currentCycle), TARGET, 'pending');
      await assertBlocked();
    });

    test('returns 409 IN_CURRENT_CYCLE for an accepted observation request', async () => {
      await request(await signUp(OBSERVEE, currentCycle), TARGET, 'accepted');
      await assertBlocked();
    });

    test('returns 409 IN_CURRENT_CYCLE for a scheduled observation', async () => {
      // The request is declined so that only the scheduled observation can block.
      const signupId = await signUp(OBSERVEE, currentCycle);
      await request(signupId, TARGET, 'declined');
      await scheduleObservation(signupId, TARGET);
      await assertBlocked();
    });

    test('declined, cancelled and expired requests do not block', async () => {
      // One observee per status, because a professor has one sign-up per cycle.
      for (const [observee, status] of [['dec000001', 'declined'], ['can000001', 'cancelled'], ['exp000001', 'expired']]) {
        await sql(`INSERT INTO professor (netid, first_name, last_name, email, rank, dept_id, eval_interval_years, start_term)
                   VALUES ($1, 'Test', $1, $1 || '@example.edu', 'full', 1, 2, $2)`, [observee, olderTerm]);
        await request(await signUp(observee, currentCycle), TARGET, status);
      }
      await assertNotBlocked();
    });

    test('activity in an older cycle does not block', async () => {
      await signUp(TARGET, olderCycle);
      await request(await signUp(OBSERVEE, olderCycle), TARGET, 'accepted');
      await assertNotBlocked();
    });

    test('activity in the latest cycle does not block once its feedback deadline has passed', async () => {
      await signUp(TARGET, currentCycle);
      await sql(`UPDATE eval_cycle SET signup_deadline = CURRENT_DATE - 5, observation_deadline = CURRENT_DATE - 3,
                                       feedback_deadline = CURRENT_DATE - 1 WHERE cycle_id = $1`, [currentCycle]);
      await assertNotBlocked();
    });
  });
});
