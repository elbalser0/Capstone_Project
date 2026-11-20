// Database tests for the deadline rules in PATCH /api/cycles/{cycleId}. Setup is in db-test-helper.ts.
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { skip, sql, useTestDatabase } from './db-test-helper.js';

const { createCycle, updateCycle } = await import('../src/services/cycle.service.js');

const day = async (offset: number) => (await sql(`SELECT (CURRENT_DATE + $1::int)::text AS d`, [offset])).rows[0].d as string;

describe('cycle deadline rules against the database', { skip }, () => {
  useTestDatabase();

  // Cycle 1: sign-up closed 5 days ago, observations due in 20 days, feedback in 30. 'ee' signed up.
  beforeEach(async () => {
    await sql(`TRUNCATE department, term, professor RESTART IDENTITY CASCADE`);
    await sql(`INSERT INTO department (dept_name) VALUES ('Computer Science')`);
    await sql(`INSERT INTO term (season, year, start_date, end_date)
               VALUES ('fall', 2026, CURRENT_DATE - 60, CURRENT_DATE + 60), ('spring', 2027, CURRENT_DATE + 70, CURRENT_DATE + 180)`);
    for (const netid of ['ac1', 'ee', 'obs']) {
      await sql(`INSERT INTO professor (netid, first_name, last_name, email, rank, dept_id, eval_interval_years, start_term)
                 VALUES ($1, $1, 'Test', $1 || '@example.edu', 'full', 1, 2, 1)`, [netid]);
    }
    await sql(`INSERT INTO ac_member (netid) VALUES ('ac1')`);
    await sql(`INSERT INTO eval_cycle (term_id, started_by, start_date, signup_deadline, observation_deadline, feedback_deadline)
               VALUES (1, 'ac1', CURRENT_DATE - 30, CURRENT_DATE - 5, CURRENT_DATE + 20, CURRENT_DATE + 30)`);
    await sql(`INSERT INTO course (dept_id, course_num, title, course_level) VALUES (1, '1337', 'CS I', 1000)`);
    await sql(`INSERT INTO section (course_id, term_id, section_num, instructor_id, class_mode) VALUES (1, 1, '001', 'ee', 'in-person')`);
    await sql(`INSERT INTO sign_up (cycle_id, observee_netid, section_id) VALUES (1, 'ee', 1)`);
  });

  test('the feedback deadline must be at least one day after the observation deadline', async () => {
    const sameDay = await day(25);
    await assert.rejects(updateCycle(1, { observationDeadline: sameDay, feedbackDeadline: sameDay }),
      { status: 400, code: 'INVALID_DEADLINES' });
    await assert.rejects(createCycle('ac1', 2, { signupDeadline: await day(5), observationDeadline: sameDay, feedbackDeadline: sameDay }),
      { status: 400, code: 'INVALID_DEADLINES' });
    // A cycle that already has equal deadlines can be fixed by moving the feedback deadline in the same PATCH.
    await sql(`UPDATE eval_cycle SET feedback_deadline = observation_deadline WHERE cycle_id = 1`);
    assert.equal((await updateCycle(1, { feedbackDeadline: await day(21) })).feedbackDeadline, await day(21));
  });

  test('before observer selection runs, the sign-up deadline can still be extended', async () => {
    assert.equal((await updateCycle(1, { signupDeadline: await day(3) })).phase, 'signup');
  });

  test('after observer selection found observers, sign-up cannot be reopened', async () => {
    await sql(`INSERT INTO observer_match (signup_id, observer_netid) VALUES (1, 'obs')`);
    for (const offset of [0, 3]) {
      await assert.rejects(updateCycle(1, { signupDeadline: await day(offset) }), { status: 409, code: 'SELECTION_DONE' });
    }
    assert.equal((await sql(`SELECT signup_deadline::text AS d FROM eval_cycle`)).rows[0].d, await day(-5));
    // Other deadlines can still change, and the sign-up deadline can move to another past date.
    assert.equal((await updateCycle(1, { feedbackDeadline: await day(40) })).feedbackDeadline, await day(40));
    assert.equal((await updateCycle(1, { signupDeadline: await day(-2) })).signupDeadline, await day(-2));
  });

  test('a selection run that found nobody (a no_observer alert) also counts as run', async () => {
    await sql(`INSERT INTO alert (signup_id, alert_type) VALUES (1, 'no_observer')`);
    await assert.rejects(updateCycle(1, { signupDeadline: await day(3) }), { status: 409, code: 'SELECTION_DONE' });
  });
});
