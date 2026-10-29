// Database tests for POST /api/cycles/{cycleId}/matching. Setup is in db-test-helper.ts.
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { skip, sql, useTestDatabase } from './db-test-helper.js';

const { runMatching } = await import('../src/services/matching.service.js');

// Section per professor in the current term (term 6). Course 1 is 1000 level, course 2 is 4000 level.
const CURRENT = [
  ['ee', 1], ['g1', 1], ['g2', 1], ['g3', 1], ['g4', 1], ['g5', 1], ['g6', 1],
  ['math', 1], ['lvl', 2], ['old', 2], ['outside', 1], ['gone', 1], ['busy', 1],
] as const;
// Everyone with a section has a sign-up (the observer pool), except outside.
const SIGNED_UP = CURRENT.map(([netid]) => netid).filter((netid) => netid !== 'outside');
const signupOf = (netid: string) => SIGNED_UP.indexOf(netid) + 1;

async function candidates(netid: string) {
  const { rows } = await sql('SELECT observer_netid FROM observer_match WHERE signup_id = $1 ORDER BY observer_netid', [signupOf(netid)]);
  return rows.map((row) => row.observer_netid);
}

async function alerts(netid: string) {
  const { rows } = await sql('SELECT alert_type FROM alert WHERE signup_id = $1 AND resolved_date IS NULL', [signupOf(netid)]);
  return rows.map((row) => row.alert_type);
}

describe('observer matching against the database', { skip }, () => {
  useTestDatabase();

  beforeEach(async () => {
    await sql(`TRUNCATE department, term, professor RESTART IDENTITY CASCADE`);
    await sql(`INSERT INTO department (dept_name) VALUES ('Computer Science'), ('Mathematics')`);
    // Six terms, one a year apart going back; term 6 is the current one.
    for (let i = 1; i <= 6; i += 1) {
      await sql(`INSERT INTO term (season, year, start_date, end_date)
                 VALUES ($1, $2, CURRENT_DATE - 60 - (6 - $3) * 180, CURRENT_DATE + 90 - (6 - $3) * 180)`,
      [i % 2 ? 'spring' : 'fall', 2020 + i, i]);
    }
    for (const [netid] of [['ac1'], ...CURRENT]) {
      await sql(`INSERT INTO professor (netid, first_name, last_name, email, rank, dept_id, eval_interval_years, start_term, is_active)
                 VALUES ($1, $1, 'Test', $1 || '@example.edu', 'full', $2, 2, 1, $3)`,
      [netid, netid === 'math' ? 2 : 1, netid !== 'gone']);
    }
    await sql(`INSERT INTO ac_member (netid) VALUES ('ac1')`);
    await sql(`INSERT INTO template_version (version_no, status, created_by, published_date) VALUES (1, 'live', 'ac1', now())`);
    await sql(`INSERT INTO eval_cycle (term_id, started_by, start_date, signup_deadline, observation_deadline, feedback_deadline)
               VALUES (6, 'ac1', CURRENT_DATE - 30, CURRENT_DATE - 10, CURRENT_DATE + 30, CURRENT_DATE + 45)`);
    await sql(`INSERT INTO course (dept_id, course_num, title, course_level) VALUES (1, '1337', 'CS I', 1000), (1, '4485', 'Capstone', 4000)`);
    for (const [index, [netid, course]] of CURRENT.entries()) {
      await sql(`INSERT INTO section (course_id, term_id, section_num, instructor_id, class_mode) VALUES ($1, 6, $2, $3, 'in-person')`,
        [course, String(index + 1).padStart(3, '0'), netid]);
      await sql(`INSERT INTO meeting_time (section_id, day_of_week, start_time, end_time) VALUES ($1, 'monday', '10:00', '10:50')`, [index + 1]);
    }
    // old taught the 1000-level course five semesters ago, outside the two-year window.
    await sql(`INSERT INTO section (course_id, term_id, section_num, instructor_id, class_mode) VALUES (1, 1, '900', 'old', 'in-person')`);
    for (const netid of SIGNED_UP) {
      const sectionId = CURRENT.findIndex(([n]) => n === netid) + 1;
      await sql(`INSERT INTO sign_up (cycle_id, observee_netid, section_id) VALUES (1, $1, $2)`, [netid, sectionId]);
      await sql(`INSERT INTO proposed_date (signup_id, date) VALUES ($1, CURRENT_DATE + 7)`, [signupOf(netid)]);
    }
    // busy already observes g4, g5 and g6 (the limit of 3), so those three sign-ups are paired.
    for (const netid of ['g4', 'g5', 'g6']) {
      await sql(`INSERT INTO observer_match (signup_id, observer_netid) VALUES ($1, 'busy')`, [signupOf(netid)]);
      await sql(`INSERT INTO observation_request (signup_id, observer_netid, status, responded_date) VALUES ($1, 'busy', 'accepted', now())`, [signupOf(netid)]);
      await sql(`INSERT INTO observation (signup_id, observer_netid, version_id, scheduled_date) VALUES ($1, 'busy', 1, CURRENT_DATE + 7)`, [signupOf(netid)]);
    }
  });

  test('lists up to 5 eligible observers and leaves out everyone who breaks a rule', async () => {
    const rows = await runMatching(1);
    const ee = rows.find((row) => row.observee.netid === 'ee')!;
    // Eligible: g1-g6. Not: math (other department), lvl (other level), old (level taught too long ago),
    // outside (no sign-up), gone (inactive), busy (3 accepted), ee (self).
    assert.deepEqual(ee.candidates.map((c) => c.netid), ['g1', 'g2', 'g3', 'g4', 'g5']);
    assert.equal(ee.alert, null);
    assert.ok(ee.ranAt);
    assert.equal(ee.section.sectionId, '1');
    assert.equal(ee.candidates[0].displayName, 'Dr. g1 Test');
  });

  test('with g1-g6 out of the pool, nobody else qualifies: every other rule excludes someone', async () => {
    await sql(`DELETE FROM proposed_date WHERE signup_id IN (SELECT signup_id FROM sign_up WHERE observee_netid IN ('g1','g2','g3'))`);
    await sql(`DELETE FROM sign_up WHERE observee_netid IN ('g1','g2','g3')`);
    await sql(`UPDATE professor SET is_active = false WHERE netid IN ('g4','g5','g6')`);
    const ee = (await runMatching(1)).find((row) => row.observee.netid === 'ee')!;
    // math: other department; lvl: other level; old: level taught too long ago; outside: no sign-up;
    // gone: inactive; busy: already has 3; ee: self.
    assert.deepEqual(ee.candidates, []);
    assert.equal(ee.alert?.alertType, 'no_observer');
  });

  test('observers with fewer matches come first, so the work is spread out', async () => {
    await runMatching(1);
    // By g1's turn, g2-g5 each have one match from ee's list; ee and g6 have none.
    const g1 = await candidates('g1');
    assert.ok(g1.includes('ee') && g1.includes('g6'));
    assert.equal(g1.length, 5);
  });

  test('raises insufficient_observers and no_observer alerts', async () => {
    await runMatching(1);
    assert.deepEqual(await candidates('lvl'), ['old']);
    assert.deepEqual(await alerts('lvl'), ['insufficient_observers']);
    assert.deepEqual(await candidates('math'), []);
    assert.deepEqual(await alerts('math'), ['no_observer']);
    assert.deepEqual(await alerts('ee'), []);
  });

  test('sign-ups that already have an observer are left alone', async () => {
    await runMatching(1);
    for (const netid of ['g4', 'g5', 'g6']) assert.deepEqual(await candidates(netid), ['busy']);
  });

  test('running again keeps observers who were sent a request and does not duplicate alerts', async () => {
    await runMatching(1);
    await sql(`INSERT INTO observation_request (signup_id, observer_netid) VALUES ($1, 'g5')`, [signupOf('ee')]);
    await sql(`UPDATE alert SET resolved_by = 'ac1', resolved_date = now() WHERE signup_id = $1`, [signupOf('math')]);
    await runMatching(1);
    const ee = await candidates('ee');
    assert.ok(ee.includes('g5'));
    assert.equal(ee.length, 5);
    assert.deepEqual(await alerts('lvl'), ['insufficient_observers']);
    // The resolved alert is kept as history; a new open one is raised.
    const { rows } = await sql('SELECT count(*)::int AS n FROM alert WHERE signup_id = $1', [signupOf('math')]);
    assert.equal(rows[0].n, 2);
    assert.deepEqual(await alerts('math'), ['no_observer']);
  });

  // Sends ee a request from each observer, with the given status and age in hours.
  async function endRequests(rows: [string, string, number][]) {
    for (const [observer, status, hoursAgo] of rows) {
      await sql(`INSERT INTO observation_request (signup_id, observer_netid, status, sent_date, responded_date)
                 VALUES ($1, $2, $3, now() - make_interval(hours => $4),
                         CASE WHEN $3 = 'pending' THEN NULL ELSE now() - make_interval(hours => $4) END)`,
      [signupOf('ee'), observer, status, hoursAgo]);
    }
  }

  test('running again replaces observers whose request was declined, cancelled or expired', async () => {
    await runMatching(1);
    // ee's list is g1-g5: g1 declined, g2 cancelled, g3 expired, g4 pending past 48 hours, g5 still pending.
    await endRequests([['g1', 'declined', 5], ['g2', 'cancelled', 5], ['g3', 'expired', 60], ['g4', 'pending', 60], ['g5', 'pending', 1]]);
    const ee = (await runMatching(1)).find((row) => row.observee.netid === 'ee')!;
    // g5 keeps its slot and g6 is the only eligible replacement; the four ended observers are not shown or re-added.
    assert.deepEqual(ee.candidates.map((c) => c.netid), ['g5', 'g6']);
    assert.equal(ee.alert?.alertType, 'insufficient_observers');
    // Request history is preserved: the ended rows are still there.
    assert.deepEqual(await candidates('ee'), ['g1', 'g2', 'g3', 'g4', 'g5', 'g6']);
    const { rows } = await sql('SELECT count(*)::int AS n FROM observation_request WHERE signup_id = $1', [signupOf('ee')]);
    assert.equal(rows[0].n, 5);
  });

  test('when all five requests end and nobody else qualifies, running again raises no_observer', async () => {
    await runMatching(1);
    await endRequests([['g1', 'declined', 5], ['g2', 'declined', 5], ['g3', 'cancelled', 5], ['g4', 'expired', 60], ['g5', 'declined', 5]]);
    await sql(`UPDATE professor SET is_active = false WHERE netid = 'g6'`);
    const ee = (await runMatching(1)).find((row) => row.observee.netid === 'ee')!;
    assert.deepEqual(ee.candidates, []);
    assert.equal(ee.alert?.alertType, 'no_observer');
    assert.equal((await candidates('ee')).length, 5);
  });

  test('when all five requests end and others qualify, running again gives a new usable list', async () => {
    await runMatching(1);
    await endRequests([['g1', 'declined', 5], ['g2', 'declined', 5], ['g3', 'cancelled', 5], ['g4', 'expired', 60], ['g5', 'declined', 5]]);
    // Three more eligible observers join the pool.
    for (const netid of ['h1', 'h2', 'h3']) {
      await sql(`INSERT INTO professor (netid, first_name, last_name, email, rank, dept_id, eval_interval_years, start_term, is_active)
                 VALUES ($1, $1, 'Test', $1 || '@example.edu', 'full', 1, 2, 1, true)`, [netid]);
      await sql(`INSERT INTO section (course_id, term_id, section_num, instructor_id, class_mode) VALUES (1, 6, $2, $1, 'in-person')`,
        [netid, `10${netid.slice(1)}`]);
      await sql(`INSERT INTO sign_up (cycle_id, observee_netid, section_id) VALUES (1, $1, (SELECT max(section_id) FROM section))`, [netid]);
    }
    const ee = (await runMatching(1)).find((row) => row.observee.netid === 'ee')!;
    assert.deepEqual(ee.candidates.map((c) => c.netid).sort(), ['g6', 'h1', 'h2', 'h3']);
    assert.equal(ee.alert, null);
  });

  test('refuses before the sign-up deadline and for a cycle that does not exist', async () => {
    await sql(`UPDATE eval_cycle SET signup_deadline = CURRENT_DATE WHERE cycle_id = 1`);
    await assert.rejects(runMatching(1), { code: 'SIGNUP_OPEN' });
    assert.deepEqual(await candidates('ee'), []);
    await assert.rejects(runMatching(99), { code: 'NOT_FOUND' });
  });
});
