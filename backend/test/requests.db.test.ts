// Database tests for confirm/decline. They need a separate, empty PostgreSQL database:
//   TEST_DATABASE_URL=postgresql://.../assessment_test npm test
// The database name must end in "_test" because these tests drop and rebuild the schema.
// Without TEST_DATABASE_URL they are skipped.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, describe, test } from 'node:test';

const url = process.env.TEST_DATABASE_URL?.trim();
const skip = !url
  ? 'set TEST_DATABASE_URL to run database tests'
  : !new URL(url).pathname.replace('/', '').endsWith('_test')
    ? 'TEST_DATABASE_URL must point to a database whose name ends in _test'
    : false;
if (!skip) process.env.DATABASE_URL = url;

const { getPool, closePool } = await import('../src/db/pool.js');
const { confirmRequest, declineRequest } = await import('../src/services/request.service.js');

const OBSERVEE = ['ee1', 'ee2', 'ee3', 'ee4', 'ee5', 'ee6'];
const dayOffset = (days: number) => `(CURRENT_DATE + ${days})::date`;

async function sql(text: string, params: unknown[] = []) {
  return getPool().query(text, params);
}

async function status(signupId: number, observer: string) {
  const { rows } = await sql('SELECT status FROM observation_request WHERE signup_id = $1 AND observer_netid = $2', [signupId, observer]);
  return rows[0]?.status;
}

// Sign-up N belongs to observee eeN, with proposed dates in 7 and 9 days plus one 3 days ago.
async function addRequest(signupId: number, observer: string, hoursAgo = 1) {
  await sql('INSERT INTO observer_match (signup_id, observer_netid) VALUES ($1, $2)', [signupId, observer]);
  await sql(`INSERT INTO observation_request (signup_id, observer_netid, sent_date)
             VALUES ($1, $2, now() - make_interval(hours => $3))`, [signupId, observer, hoursAgo]);
}

async function addAccepted(signupId: number, observer: string) {
  await sql('INSERT INTO observer_match (signup_id, observer_netid) VALUES ($1, $2)', [signupId, observer]);
  await sql(`INSERT INTO observation_request (signup_id, observer_netid, status, sent_date, responded_date)
             VALUES ($1, $2, 'accepted', now() - interval '2 hours', now())`, [signupId, observer]);
  await sql(`INSERT INTO observation (signup_id, observer_netid, version_id, scheduled_date)
             VALUES ($1, $2, 1, ${dayOffset(7)})`, [signupId, observer]);
}

const futureDate = async (days: number) => (await sql(`SELECT ${dayOffset(days)}::text AS d`)).rows[0].d as string;

describe('confirm and decline against the database', { skip }, () => {
  // Database test files run in parallel and all rebuild the schema, so each one holds
  // this lock for its whole run and the others wait their turn.
  let lock: import('pg').PoolClient;

  before(async () => {
    lock = await getPool().connect();
    await lock.query('SELECT pg_advisory_lock(4485)');
    await sql('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await sql(await readFile(new URL('../../database/schema.sql', import.meta.url), 'utf8'));
  });

  beforeEach(async () => {
    await sql(`TRUNCATE department, term, professor RESTART IDENTITY CASCADE`);
    await sql(`INSERT INTO department (dept_name) VALUES ('Computer Science')`);
    await sql(`INSERT INTO term (season, year, start_date, end_date)
               VALUES ('fall', 2020, ${dayOffset(-60)}, ${dayOffset(90)})`);
    const people = ['ac1', 'obsA', 'obsB', 'obsC', ...OBSERVEE];
    for (const netid of people) {
      await sql(`INSERT INTO professor (netid, first_name, last_name, email, rank, dept_id, eval_interval_years, start_term)
                 VALUES ($1, $1, 'Test', $1 || '@example.edu', 'full', 1, 2, 1)`, [netid]);
    }
    await sql(`INSERT INTO ac_member (netid) VALUES ('ac1')`);
    await sql(`INSERT INTO template_version (version_no, status, created_by, published_date) VALUES (1, 'live', 'ac1', now())`);
    await sql(`INSERT INTO eval_cycle (term_id, started_by, start_date, signup_deadline, observation_deadline, feedback_deadline)
               VALUES (1, 'ac1', ${dayOffset(-30)}, ${dayOffset(-10)}, ${dayOffset(30)}, ${dayOffset(45)})`);
    await sql(`INSERT INTO course (dept_id, course_num, title, course_level) VALUES (1, '1337', 'Computer Science I', 1000)`);
    for (const [index, netid] of OBSERVEE.entries()) {
      await sql(`INSERT INTO section (course_id, term_id, section_num, instructor_id, class_mode)
                 VALUES (1, 1, $1, $2, 'in-person')`, [`00${index + 1}`, netid]);
      for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']) {
        await sql(`INSERT INTO meeting_time (section_id, day_of_week, start_time, end_time)
                   VALUES ($1, $2, '10:00', '10:50')`, [index + 1, day]);
      }
      await sql(`INSERT INTO sign_up (cycle_id, observee_netid, section_id) VALUES (1, $1, $2)`, [netid, index + 1]);
      await sql(`INSERT INTO proposed_date (signup_id, date)
                 VALUES ($1, ${dayOffset(7)}), ($1, ${dayOffset(9)}), ($1, ${dayOffset(-3)})`, [index + 1]);
    }
  });

  after(async () => {
    await lock.query('SELECT pg_advisory_unlock(4485)');
    lock.release();
    await closePool();
  });

  test('confirm creates the observation and sets the request to accepted', async () => {
    await addRequest(1, 'obsA');
    const date = await futureDate(7);
    const result = await confirmRequest(1, 'obsA', date);
    assert.equal(result.status, 'accepted');
    assert.ok(result.respondedDate);
    const { rows } = await sql('SELECT observer_netid, scheduled_date::text, status FROM observation WHERE signup_id = 1');
    assert.deepEqual(rows, [{ observer_netid: 'obsA', scheduled_date: date, status: 'scheduled' }]);
  });

  test('confirm cancels the other pending requests on the sign-up but leaves expired ones alone', async () => {
    await addRequest(1, 'obsA');
    await addRequest(1, 'obsB');
    await addRequest(1, 'obsC', 72);
    await confirmRequest(1, 'obsA', await futureDate(7));
    assert.equal(await status(1, 'obsB'), 'cancelled');
    assert.equal(await status(1, 'obsC'), 'pending'); // still reads as expired
  });

  test('the observer who confirms second gets ALREADY_PAIRED', async () => {
    await addRequest(1, 'obsA');
    await addRequest(1, 'obsB');
    await confirmRequest(1, 'obsA', await futureDate(7));
    await assert.rejects(confirmRequest(1, 'obsB', await futureDate(9)), { code: 'ALREADY_PAIRED' });
  });

  test('two observers confirming the same sign-up at once: only one is paired', async () => {
    await addRequest(1, 'obsA');
    await addRequest(1, 'obsB');
    const date = await futureDate(7);
    const results = await Promise.allSettled([confirmRequest(1, 'obsA', date), confirmRequest(1, 'obsB', date)]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    assert.equal(failed.reason.code, 'ALREADY_PAIRED');
    assert.equal((await sql('SELECT count(*)::int AS n FROM observation WHERE signup_id = 1')).rows[0].n, 1);
  });

  test('the limit of 3 holds when the same observer confirms two sign-ups at once', async () => {
    await addAccepted(1, 'obsA');
    await addAccepted(2, 'obsA');
    await addRequest(3, 'obsA');
    await addRequest(4, 'obsA');
    await addRequest(5, 'obsA');
    await addRequest(6, 'obsA', 72);
    const date = await futureDate(7);
    const results = await Promise.allSettled([confirmRequest(3, 'obsA', date), confirmRequest(4, 'obsA', date)]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    assert.equal(failed.reason.code, 'LIMIT_REACHED');
    assert.equal((await sql(`SELECT count(*)::int AS n FROM observation WHERE observer_netid = 'obsA'`)).rows[0].n, 3);
    // Reaching 3 cancels the observer's other open requests, but not expired ones.
    assert.equal(await status(5, 'obsA'), 'cancelled');
    assert.equal(await status(6, 'obsA'), 'pending');
  });

  test('confirming a request you already accepted returns NOT_PENDING, even at the limit', async () => {
    await addAccepted(1, 'obsA');
    await addAccepted(2, 'obsA');
    await addAccepted(3, 'obsA');
    await assert.rejects(confirmRequest(1, 'obsA', await futureDate(7)), { code: 'NOT_PENDING', message: 'This request is accepted.' });
  });

  test('confirm or decline on an expired, declined, or cancelled request returns NOT_PENDING', async () => {
    await addRequest(1, 'obsA', 72);
    await sql(`INSERT INTO observer_match (signup_id, observer_netid) VALUES (2, 'obsA'), (3, 'obsA')`);
    await sql(`INSERT INTO observation_request (signup_id, observer_netid, status, responded_date)
               VALUES (2, 'obsA', 'declined', now()), (3, 'obsA', 'cancelled', NULL)`);
    const date = await futureDate(7);
    for (const signupId of [1, 2, 3]) {
      await assert.rejects(confirmRequest(signupId, 'obsA', date), { code: 'NOT_PENDING' }, `confirm ${signupId}`);
      await assert.rejects(declineRequest(signupId, 'obsA'), { code: 'NOT_PENDING' }, `decline ${signupId}`);
    }
    await assert.rejects(confirmRequest(1, 'obsA', date), /expired/);
  });

  test('confirm rejects a date that was not proposed, or one that has passed', async () => {
    await addRequest(1, 'obsA');
    await assert.rejects(confirmRequest(1, 'obsA', await futureDate(8)), { code: 'INVALID_DATE' });
    await assert.rejects(confirmRequest(1, 'obsA', await futureDate(-3)), { code: 'DATE_PASSED' });
    assert.equal(await status(1, 'obsA'), 'pending');
  });

  test('confirm rejects a date when the observer teaches at the same time', async () => {
    // obsA teaches 10:30-11:20 on Mondays; the observed class meets 10:00-10:50 every day.
    await sql(`INSERT INTO section (course_id, term_id, section_num, instructor_id, class_mode)
               VALUES (1, 1, '900', 'obsA', 'in-person')`);
    await sql(`INSERT INTO meeting_time (section_id, day_of_week, start_time, end_time)
               VALUES (7, 'monday', '10:30', '11:20'), (7, 'tuesday', '10:50', '12:05')`);
    await sql(`DELETE FROM proposed_date WHERE signup_id = 1`);
    const { rows } = await sql(`
      SELECT d::date::text AS date, lower(trim(to_char(d, 'FMDay'))) AS day
      FROM generate_series(CURRENT_DATE + 1, CURRENT_DATE + 7, interval '1 day') AS d`);
    const dayDate = (day: string) => rows.find((row) => row.day === day).date as string;
    for (const day of ['monday', 'tuesday', 'wednesday']) {
      await sql('INSERT INTO proposed_date (signup_id, date) VALUES (1, $1)', [dayDate(day)]);
    }
    await addRequest(1, 'obsA');

    // Monday overlaps (10:30 starts before 10:50 ends).
    await assert.rejects(confirmRequest(1, 'obsA', dayDate('monday')),
      { code: 'SCHEDULE_CONFLICT', message: 'You teach 1337.900 from 10:30 to 11:20 at that time.' });
    assert.equal(await status(1, 'obsA'), 'pending');
    // Tuesday's class starts exactly when the observed class ends, so it doesn't overlap.
    const result = await confirmRequest(1, 'obsA', dayDate('tuesday'));
    assert.equal(result.status, 'accepted');
  });

  test('a class in a different term does not count as a conflict', async () => {
    await sql(`INSERT INTO term (season, year, start_date, end_date)
               VALUES ('spring', 2021, ${dayOffset(100)}, ${dayOffset(200)})`);
    await sql(`INSERT INTO section (course_id, term_id, section_num, instructor_id, class_mode)
               VALUES (1, 2, '901', 'obsA', 'in-person')`);
    for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']) {
      await sql(`INSERT INTO meeting_time (section_id, day_of_week, start_time, end_time)
                 VALUES (7, $1, '10:00', '10:50')`, [day]);
    }
    await addRequest(1, 'obsA');
    const result = await confirmRequest(1, 'obsA', await futureDate(7));
    assert.equal(result.status, 'accepted');
  });

  test('decline sets the request to declined', async () => {
    await addRequest(1, 'obsA');
    const result = await declineRequest(1, 'obsA');
    assert.equal(result.status, 'declined');
    assert.ok(result.respondedDate);
  });

  test('confirm and decline return NOT_FOUND for a request that does not exist', async () => {
    await assert.rejects(confirmRequest(99, 'obsA', await futureDate(7)), { code: 'NOT_FOUND' });
    await assert.rejects(declineRequest(1, 'obsA'), { code: 'NOT_FOUND' });
  });
});
