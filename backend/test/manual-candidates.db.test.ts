// Database-backed coverage for AC manual candidates. Uses only the isolated *_test database.
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { skip, sql, useTestDatabase } from './db-test-helper.js';

const { addManualCandidate } = await import('../src/services/matching.service.js');

const signupId = 1;

async function addMatch(observerNetid: string, roundNo = 1) {
  await sql(
    'INSERT INTO observer_match (signup_id, observer_netid, round_no) VALUES ($1, $2, $3)',
    [signupId, observerNetid, roundNo],
  );
}

async function addAlert(type: 'no_observer' | 'insufficient_observers' | 'no_acceptance') {
  await sql('INSERT INTO alert (signup_id, alert_type) VALUES ($1, $2)', [signupId, type]);
}

describe('manual candidates against the database', { skip }, () => {
  useTestDatabase();

  beforeEach(async () => {
    await sql('TRUNCATE department, term, professor RESTART IDENTITY CASCADE');
    await sql("INSERT INTO department (dept_name) VALUES ('Computer Science')");
    await sql(`INSERT INTO term (season, year, start_date, end_date)
               VALUES ('fall', 2026, CURRENT_DATE - 60, CURRENT_DATE + 60)`);
    for (const netid of ['ac', 'owner', 'observer', 'observer2', 'observer3', 'inactive', 'other1', 'other2', 'other3']) {
      await sql(`INSERT INTO professor (netid, first_name, last_name, email, rank, dept_id, eval_interval_years, start_term, is_active)
                 VALUES ($1, $1, 'Test', $1 || '@example.edu', 'associate', 1, 2, 1, $2)`,
      [netid, netid !== 'inactive']);
    }
    await sql("INSERT INTO ac_member (netid) VALUES ('ac')");
    await sql(`INSERT INTO eval_cycle (term_id, started_by, start_date, signup_deadline, observation_deadline, feedback_deadline)
               VALUES (1, 'ac', CURRENT_DATE - 20, CURRENT_DATE - 10, CURRENT_DATE + 10, CURRENT_DATE + 20)`);
    await sql("INSERT INTO course (dept_id, course_num, title, course_level) VALUES (1, '4000', 'Test Course', 4000)");
    await sql(`INSERT INTO section (course_id, term_id, section_num, instructor_id, class_mode)
               VALUES (1, 1, '001', 'owner', 'in-person')`);
    await sql("INSERT INTO sign_up (cycle_id, observee_netid, section_id) VALUES (1, 'owner', 1)");
  });

  test('adds an active professor, records the next round, and refreshes alerts', async () => {
    await addMatch('observer');
    await addAlert('no_observer');
    await addAlert('no_acceptance');

    const result = await addManualCandidate(signupId, 'observer2');

    assert.deepEqual(result, {
      signupId: '1',
      observer: {
        netid: 'observer2', firstName: 'observer2', lastName: 'Test',
        displayName: 'Dr. observer2 Test', rank: 'associate',
      },
      roundNo: 2,
    });
    const matches = await sql('SELECT observer_netid, round_no FROM observer_match WHERE signup_id = $1 ORDER BY observer_netid', [signupId]);
    assert.deepEqual(matches.rows, [
      { observer_netid: 'observer', round_no: 1 },
      { observer_netid: 'observer2', round_no: 2 },
    ]);
    const alerts = await sql('SELECT alert_type, resolved_date IS NOT NULL AS resolved FROM alert WHERE signup_id = $1 ORDER BY alert_id', [signupId]);
    assert.deepEqual(alerts.rows, [
      { alert_type: 'no_observer', resolved: true },
      { alert_type: 'no_acceptance', resolved: true },
      { alert_type: 'insufficient_observers', resolved: false },
    ]);
  });

  test('rejects a missing sign-up', async () => {
    await assert.rejects(addManualCandidate(999, 'observer'), { status: 404, code: 'NOT_FOUND' });
  });

  test('rejects additions before the sign-up deadline', async () => {
    await sql('UPDATE eval_cycle SET signup_deadline = CURRENT_DATE WHERE cycle_id = 1');
    await assert.rejects(addManualCandidate(signupId, 'observer'), { status: 409, code: 'SIGNUP_OPEN' });
  });

  test('rejects additions after the observation deadline', async () => {
    await sql('UPDATE eval_cycle SET observation_deadline = CURRENT_DATE - 1 WHERE cycle_id = 1');
    await assert.rejects(addManualCandidate(signupId, 'observer'), { status: 409, code: 'OBSERVATION_CLOSED' });
  });

  test('rejects self-assignment, inactive professors, and candidates already in the match history', async () => {
    await assert.rejects(addManualCandidate(signupId, 'owner'), { status: 400, code: 'INVALID_CANDIDATE' });
    await assert.rejects(addManualCandidate(signupId, 'inactive'), { status: 404, code: 'CANDIDATE_NOT_FOUND' });
    await addMatch('observer');
    await sql(`INSERT INTO observation_request (signup_id, observer_netid, status, responded_date)
               VALUES ($1, 'observer', 'declined', now())`, [signupId]);
    await assert.rejects(addManualCandidate(signupId, 'observer'), { status: 409, code: 'ALREADY_MATCHED' });
  });

  test('rejects additions once the sign-up has three usable candidates', async () => {
    await addMatch('observer');
    await addMatch('observer2');
    await addMatch('observer3');
    await assert.rejects(addManualCandidate(signupId, 'other1'), { status: 409, code: 'ENOUGH_CANDIDATES' });
  });

  test('rejects a sign-up that already has an observation', async () => {
    await addMatch('observer');
    await sql(`INSERT INTO observation_request (signup_id, observer_netid, status, responded_date)
               VALUES ($1, 'observer', 'accepted', now())`, [signupId]);
    await sql('INSERT INTO proposed_date (signup_id, date) VALUES ($1, CURRENT_DATE + 2)', [signupId]);
    await sql("INSERT INTO template_version (version_no, status, created_by, published_date) VALUES (1, 'live', 'ac', now())");
    await sql(`INSERT INTO observation (signup_id, observer_netid, version_id, scheduled_date)
               VALUES ($1, 'observer', 1, CURRENT_DATE + 2)`, [signupId]);
    await assert.rejects(addManualCandidate(signupId, 'observer2'), { status: 409, code: 'ALREADY_PAIRED' });
  });

  test('rejects an observer who already has three observations in the cycle', async () => {
    await sql("INSERT INTO template_version (version_no, status, created_by, published_date) VALUES (1, 'live', 'ac', now())");
    for (const [index, observee] of ['other1', 'other2', 'other3'].entries()) {
      const section = await sql(`INSERT INTO section (course_id, term_id, section_num, instructor_id, class_mode)
                                 VALUES (1, 1, $1, $2, 'in-person') RETURNING section_id`,
      [String(index + 2).padStart(3, '0'), observee]);
      const signup = await sql(`INSERT INTO sign_up (cycle_id, observee_netid, section_id)
                                 VALUES (1, $1, $2) RETURNING signup_id`, [observee, section.rows[0].section_id]);
      const id = signup.rows[0].signup_id;
      await sql('INSERT INTO observer_match (signup_id, observer_netid) VALUES ($1, $2)', [id, 'observer']);
      await sql(`INSERT INTO observation_request (signup_id, observer_netid, status, responded_date)
                 VALUES ($1, 'observer', 'accepted', now())`, [id]);
      await sql('INSERT INTO proposed_date (signup_id, date) VALUES ($1, CURRENT_DATE + $2::int)', [id, index + 3]);
      await sql(`INSERT INTO observation (signup_id, observer_netid, version_id, scheduled_date)
                 SELECT $1, 'observer', version_id, CURRENT_DATE + $2::int FROM template_version`, [id, index + 3]);
    }
    await assert.rejects(addManualCandidate(signupId, 'observer'), { status: 409, code: 'LIMIT_REACHED' });
  });
});
