// Database tests for KPI calculation. Setup is in db-test-helper.ts.
//
// Cycle 1 is closed and holds one sign-up per case. Terms 2-5 are its two-year window.
//   signup  observee  observer   case
//   1       ee1       good       correct, full process
//   2       ee2       otherdept  wrong department; survey only as observer
//   3       ee3       lowlevel   course level only taught outside the window; still scheduled
//   4       ee4       busy       teaches at that time; did not happen
//   5       ee5       ee5        observes themselves; only the observer signed
//   6       ee6       none       survey but no request or observation
//   7       ee7       adjacent   correct (class right after, no overlap), full process
//   8       adjacent  none       signed up only
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { skip, sql, useTestDatabase, getPool } from './db-test-helper.js';
import type { AuthUser } from '../src/services/user.service.js';

const { getCycleKpis, loadCycleFacts } = await import('../src/services/kpi.service.js');
const { cyclesRouter } = await import('../src/routes/cycles.routes.js');
const { errorHandler } = await import('../src/middleware/error.middleware.js');

const OBSERVED_ON = 'CURRENT_DATE - 70';
const WEEKDAY = `lower(trim(to_char(${OBSERVED_ON}, 'FMDay')))`;

let nextSectionNum = 0;

async function professor(netid: string, deptId = 1) {
  await sql(`INSERT INTO professor (netid, first_name, last_name, email, rank, dept_id, eval_interval_years, start_term)
             VALUES ($1, $1, 'Test', $1 || '@example.edu', 'full', $2, 2, 1)`, [netid, deptId]);
}

async function section(netid: string, courseId: number, termId: number, startTime = '10:00', endTime = '10:50') {
  nextSectionNum += 1;
  const { rows } = await sql(`INSERT INTO section (course_id, term_id, section_num, instructor_id, class_mode)
                              VALUES ($1, $2, $3, $4, 'in-person') RETURNING section_id`,
  [courseId, termId, String(nextSectionNum).padStart(3, '0'), netid]);
  await sql(`INSERT INTO meeting_time (section_id, day_of_week, start_time, end_time)
             VALUES ($1, ${WEEKDAY}, $2, $3)`, [rows[0].section_id, startTime, endTime]);
  return rows[0].section_id as number;
}

async function signUp(cycleId: number, netid: string, sectionId: number) {
  const { rows } = await sql(`INSERT INTO sign_up (cycle_id, observee_netid, section_id)
                              VALUES ($1, $2, $3) RETURNING signup_id`, [cycleId, netid, sectionId]);
  return rows[0].signup_id as number;
}

async function request(signupId: number, observer: string, status = 'accepted', roundNo = 1) {
  await sql(`INSERT INTO observer_match (signup_id, observer_netid, round_no) VALUES ($1, $2, $3)`, [signupId, observer, roundNo]);
  await sql(`INSERT INTO observation_request (signup_id, observer_netid, status) VALUES ($1, $2, $3)`, [signupId, observer, status]);
}

async function observation(signupId: number, observer: string, status: string, signatures: 'both' | 'observer' | 'none', reason: string | null = null) {
  await sql(`INSERT INTO proposed_date (signup_id, date) VALUES ($1, ${OBSERVED_ON})`, [signupId]);
  await sql(`INSERT INTO observation (signup_id, observer_netid, version_id, scheduled_date, status,
                                      observer_signed_date, observee_signed_date, reason_not_completed)
             VALUES ($1, $2, 1, ${OBSERVED_ON}, $3,
                     CASE WHEN $4 IN ('both', 'observer') THEN now() END,
                     CASE WHEN $4 = 'both' THEN now() END, $5)`, [signupId, observer, status, signatures, reason]);
}

async function survey(cycleId: number, netid: string, role: 'observer' | 'observee') {
  await sql(`INSERT INTO survey_response (cycle_id, respondent_id, respondent_role, process_ok)
             VALUES ($1, $2, $3, true)`, [cycleId, netid, role]);
}

async function seed() {
  nextSectionNum = 0;
  await sql(`TRUNCATE department, term, professor RESTART IDENTITY CASCADE`);
  await sql(`INSERT INTO department (dept_name) VALUES ('Computer Science'), ('Mathematics')`);
  await sql(`INSERT INTO term (season, year, start_date, end_date) VALUES
    ('fall', 2020, CURRENT_DATE - 1000, CURRENT_DATE - 900),
    ('spring', 2021, CURRENT_DATE - 800, CURRENT_DATE - 700),
    ('fall', 2021, CURRENT_DATE - 600, CURRENT_DATE - 500),
    ('spring', 2022, CURRENT_DATE - 400, CURRENT_DATE - 300),
    ('fall', 2022, CURRENT_DATE - 100, CURRENT_DATE - 40),
    ('spring', 2023, CURRENT_DATE - 30, CURRENT_DATE + 90)`);
  for (const netid of ['ac1', 'ee1', 'ee2', 'ee3', 'ee4', 'ee5', 'ee6', 'ee7', 'adjacent', 'good', 'lowlevel', 'busy', 'nope']) {
    await professor(netid);
  }
  await professor('otherdept', 2);
  await sql(`INSERT INTO ac_member (netid) VALUES ('ac1')`);
  await sql(`INSERT INTO template_version (version_no, status, created_by, published_date) VALUES (1, 'live', 'ac1', now())`);
  await sql(`INSERT INTO course (dept_id, course_num, title, course_level) VALUES
    (1, '1337', 'Computer Science I', 1000),
    (1, '2336', 'Computer Science II', 2000)`);
  // Cycle 1 is closed, cycle 2 is open, and cycle 3 closed before cycle 1 despite its higher id.
  await sql(`INSERT INTO eval_cycle (term_id, started_by, start_date, signup_deadline, observation_deadline, feedback_deadline) VALUES
    (5, 'ac1', CURRENT_DATE - 100, CURRENT_DATE - 90, CURRENT_DATE - 60, CURRENT_DATE - 50),
    (6, 'ac1', CURRENT_DATE - 20, CURRENT_DATE - 10, CURRENT_DATE + 30, CURRENT_DATE + 45),
    (4, 'ac1', CURRENT_DATE - 400, CURRENT_DATE - 390, CURRENT_DATE - 350, CURRENT_DATE - 320)`);

  // Who has taught what. 'good' has a class at the same time in another term, which is not a conflict.
  await section('good', 1, 3);
  await section('otherdept', 1, 3);
  await section('lowlevel', 2, 3);
  await section('lowlevel', 1, 1); // before the window
  await section('lowlevel', 1, 6); // after the cycle
  await section('busy', 1, 5, '10:30', '11:20');

  const signups: number[] = [];
  for (const netid of ['ee1', 'ee2', 'ee3', 'ee4', 'ee5', 'ee6', 'ee7']) {
    signups.push(await signUp(1, netid, await section(netid, 1, 5)));
  }
  signups.push(await signUp(1, 'adjacent', await section('adjacent', 1, 5, '10:50', '11:40')));
  const [s1, s2, s3, s4, s5, , s7] = signups;

  await request(s1, 'good');
  await request(s1, 'adjacent', 'cancelled');
  await request(s1, 'busy', 'cancelled', 2); // second round: not counted by 3.1
  await observation(s1, 'good', 'completed', 'both');

  await request(s2, 'otherdept');
  await observation(s2, 'otherdept', 'completed', 'both');

  await request(s3, 'lowlevel');
  await observation(s3, 'lowlevel', 'scheduled', 'none');

  await request(s4, 'busy');
  await observation(s4, 'busy', 'not_completed', 'none', 'Observer was ill');

  // The schema rejects self-matching, so this bad row has to bypass the trigger.
  await sql(`ALTER TABLE observer_match DISABLE TRIGGER observer_match_no_self_observation`);
  await request(s5, 'ee5');
  await sql(`ALTER TABLE observer_match ENABLE TRIGGER observer_match_no_self_observation`);
  await observation(s5, 'ee5', 'scheduled', 'observer');

  await request(s7, 'adjacent');
  await observation(s7, 'adjacent', 'completed', 'both');

  await survey(1, 'ee1', 'observee');
  await survey(1, 'ee2', 'observer'); // wrong role
  await survey(1, 'ee6', 'observee'); // survey without the rest of the process
  await survey(1, 'ee7', 'observee');

  for (const [netid, status] of [['ee1', 'overdue'], ['ee2', 'overdue'], ['nope', 'overdue'], ['ee3', 'due'], ['ee4', 'due'], ['ee5', 'due'], ['ee6', 'due']]) {
    await sql(`INSERT INTO eval_due (cycle_id, netid, due_status) VALUES (1, $1, $2)`, [netid, status]);
  }

  // Cycle 2 rows must not leak into cycle 1.
  const other = await signUp(2, 'ee2', await section('ee2', 1, 6));
  await request(other, 'good');
  await survey(2, 'ee2', 'observee');
  await sql(`INSERT INTO eval_due (cycle_id, netid, due_status) VALUES (2, 'ee2', 'overdue')`);
}

const summary = (kpis: { kpiCode: string; numerator: number; denominator: number; kpiValue: number | null }[]) =>
  Object.fromEntries(kpis.map((k) => [k.kpiCode, [k.numerator, k.denominator, k.kpiValue]]));

describe('KPI calculation against the database', { skip }, () => {
  useTestDatabase();
  beforeEach(seed);

  test('loadCycleFacts flags each observation against the matching rules', async () => {
    const { observations } = await loadCycleFacts(getPool(), 1);
    const flags = Object.fromEntries(observations.map((o) => [o.observerNetid, {
      selfMatch: o.selfMatch, sameDept: o.sameDept, taughtLevel: o.taughtLevel, scheduleConflict: o.scheduleConflict,
    }]));
    const fine = { selfMatch: false, sameDept: true, taughtLevel: true, scheduleConflict: false };
    assert.equal(observations.length, 6);
    assert.deepEqual(flags.good, fine);
    assert.deepEqual(flags.adjacent, fine);
    assert.deepEqual(flags.otherdept, { ...fine, sameDept: false });
    assert.deepEqual(flags.lowlevel, { ...fine, taughtLevel: false });
    assert.deepEqual(flags.busy, { ...fine, scheduleConflict: true });
    assert.equal(flags.ee5.selfMatch, true);
  });

  test('loadCycleFacts reads the process steps of each sign-up', async () => {
    const facts = await loadCycleFacts(getPool(), 1);
    assert.equal(facts.pastObservationDeadline, true);
    assert.equal(facts.due.length, 7);
    const byNetid = Object.fromEntries(facts.signups.map((s) => [s.netid, s]));
    assert.equal(facts.signups.length, 8);
    assert.deepEqual(
      { matchCount: byNetid.ee1.matchCount, requestsSent: byNetid.ee1.requestsSent, hasAccepted: byNetid.ee1.hasAccepted, surveyedAsObservee: byNetid.ee1.surveyedAsObservee },
      { matchCount: 2, requestsSent: 3, hasAccepted: true, surveyedAsObservee: true },
    );
    assert.equal(byNetid.ee2.surveyedAsObservee, false, 'an observer survey or another cycle does not count');
    assert.deepEqual(
      { requestsSent: byNetid.ee6.requestsSent, hasAccepted: byNetid.ee6.hasAccepted, surveyedAsObservee: byNetid.ee6.surveyedAsObservee },
      { requestsSent: 0, hasAccepted: false, surveyedAsObservee: true },
    );
    const ee1 = facts.observations.find((o) => o.observerNetid === 'good')!;
    assert.deepEqual([ee1.status, ee1.bothSigned], ['completed', true]);
    const half = facts.observations.find((o) => o.observerNetid === 'ee5')!;
    assert.deepEqual([half.status, half.bothSigned], ['scheduled', false]);
  });

  test('a closed cycle gets all seven KPIs', async () => {
    const result = await getCycleKpis(1);
    assert.equal(result.cycle.cycleId, '1');
    assert.equal(result.cycle.phase, 'closed');
    assert.deepEqual(summary(result.kpis), {
      '1.1': [2, 6, 2 / 6],
      '1.2': [3, 7, 3],
      '2.1': [6, 7, 6 / 7],
      '2.2': [2, 8, 0.25],
      '3.1': [7, 8, 0.9],
      '4.1': [3, 6, 3],
      '4.2': [2, 8, 0.25],
    });
    const { rows } = await sql(`SELECT CURRENT_DATE::text AS today`);
    assert.equal(result.computedDate, rows[0].today);
    assert.ok(result.kpis.every((k) => k.computedDate === rows[0].today));
  });

  test('KPIs are stored once and do not change afterwards', async () => {
    const first = await getCycleKpis(1);
    const stored = await sql(`SELECT count(*)::int AS count FROM kpi_result WHERE cycle_id = 1`);
    assert.equal(stored.rows[0].count, 7);

    await sql(`INSERT INTO eval_due (cycle_id, netid, due_status) VALUES (1, 'good', 'overdue')`);
    const second = await getCycleKpis(1);
    assert.deepEqual(second.kpis, first.kpis);
  });

  test('inactive professors do not count as due or overdue', async () => {
    await sql(`UPDATE professor SET is_active = false WHERE netid IN ('ee1', 'ee3')`);
    const kpis = summary((await getCycleKpis(1)).kpis);
    assert.deepEqual(kpis['1.2'], [2, 5, 2]);
    assert.deepEqual(kpis['2.1'], [4, 5, 0.8]);
  });

  test('a professor reactivated before the KPIs are calculated counts again', async () => {
    await sql(`UPDATE professor SET is_active = false WHERE netid = 'ee1'`);
    await sql(`UPDATE professor SET is_active = true WHERE netid = 'ee1'`);
    assert.deepEqual(summary((await getCycleKpis(1)).kpis)['1.2'], [3, 7, 3]);
  });

  test('saved KPIs do not change when a professor is reactivated', async () => {
    await sql(`UPDATE professor SET is_active = false WHERE netid = 'ee1'`);
    const saved = await getCycleKpis(1);
    assert.deepEqual(summary(saved.kpis)['1.2'], [2, 6, 2]);

    await sql(`UPDATE professor SET is_active = true WHERE netid = 'ee1'`);
    assert.deepEqual((await getCycleKpis(1)).kpis, saved.kpis);
  });

  test('two requests at once store one set of KPIs', async () => {
    const [a, b] = await Promise.all([getCycleKpis(1), getCycleKpis(1)]);
    assert.deepEqual(a.kpis, b.kpis);
    const stored = await sql(`SELECT count(*)::int AS count FROM kpi_result WHERE cycle_id = 1`);
    assert.equal(stored.rows[0].count, 7);
  });

  test('a cycle before its feedback deadline has no KPIs yet', async () => {
    const result = await getCycleKpis(2);
    assert.deepEqual([result.cycle.cycleId, result.computedDate, result.kpis], ['2', null, []]);
    const stored = await sql(`SELECT count(*)::int AS count FROM kpi_result WHERE cycle_id = 2`);
    assert.equal(stored.rows[0].count, 0);
  });

  test('a closed cycle with no activity stores N/A rates and zero counts', async () => {
    assert.deepEqual(summary((await getCycleKpis(3)).kpis), {
      '1.1': [0, 0, null],
      '1.2': [0, 0, 0],
      '2.1': [0, 0, null],
      '2.2': [0, 0, null],
      '3.1': [0, 0, null],
      '4.1': [0, 0, 0],
      '4.2': [0, 0, null],
    });
  });

  test('latest is the most recently started cycle past its feedback deadline', async () => {
    assert.equal((await getCycleKpis('latest')).cycle.cycleId, '1');
  });

  test('latest falls back to the current cycle when none has closed', async () => {
    await sql(`UPDATE eval_cycle SET observation_deadline = CURRENT_DATE + 30, feedback_deadline = CURRENT_DATE + 45`);
    const result = await getCycleKpis('latest');
    assert.deepEqual([result.cycle.cycleId, result.kpis], ['2', []]);
  });

  test('an unknown cycle is not found, and so is latest with no cycles', async () => {
    await assert.rejects(getCycleKpis(999), { code: 'NOT_FOUND' });
    await sql(`TRUNCATE eval_cycle RESTART IDENTITY CASCADE`);
    await assert.rejects(getCycleKpis('latest'), { code: 'NOT_FOUND' });
  });

  test('GET /api/cycles/:cycleId/kpis serves the KPIs to the committee', async () => {
    const committee = { netid: 'ac1', role: 'AC' } as AuthUser;
    const routeApp = express();
    routeApp.use((req, _res, next) => { req.user = committee; next(); });
    routeApp.use('/api/cycles', cyclesRouter);
    routeApp.use(errorHandler);
    const server = routeApp.listen(0, '127.0.0.1');
    try {
      await new Promise<void>((resolve, reject) => server.once('listening', resolve).once('error', reject));
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/cycles`;

      const latest = await fetch(`${base}/latest/kpis`);
      assert.equal(latest.status, 200);
      const body = await latest.json();
      assert.equal(body.cycle.term.label, 'Fall 2022');
      assert.equal(body.kpis.length, 7);
      assert.deepEqual(Object.keys(body.kpis[0]).sort(), ['computedDate', 'denominator', 'kpiCode', 'kpiValue', 'numerator']);

      assert.equal((await fetch(`${base}/1/kpis`)).status, 200);
      assert.equal((await fetch(`${base}/999/kpis`)).status, 404);
    } finally {
      if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
