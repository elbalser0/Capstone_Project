// Database tests for the observation form and signing. Same setup as requests.db.test.ts:
//   TEST_DATABASE_URL=postgresql://.../assessment_test npm test
// The database name must end in "_test" because these tests drop and rebuild the schema.
// Without TEST_DATABASE_URL they are skipped.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { AuthUser } from '../src/services/user.service.js';

const url = process.env.TEST_DATABASE_URL?.trim();
const skip = !url
  ? 'set TEST_DATABASE_URL to run database tests'
  : !new URL(url).pathname.replace('/', '').endsWith('_test')
    ? 'TEST_DATABASE_URL must point to a database whose name ends in _test'
    : false;
if (!skip) process.env.DATABASE_URL = url;

const { getPool, closePool } = await import('../src/db/pool.js');
const { getObservation, listAssignments, signObservation, submitSignedForm } = await import('../src/services/observation.service.js');
const { inTransaction } = await import('../src/db/transaction.js');

function user(netid: string): AuthUser {
  return {
    netid, firstName: netid, lastName: 'Test', displayName: `Dr. ${netid} Test`, email: `${netid}@example.edu`,
    rank: 'full', department: { deptId: '1', deptName: 'Computer Science' }, role: 'faculty',
  };
}
const observer = user('obs');
const observee = user('ee');
const someoneElse = user('other');

async function sql(text: string, params: unknown[] = []) {
  return getPool().query(text, params);
}

async function observationRow() {
  const { rows } = await sql(`SELECT status, observer_signed_date, observee_signed_date, other_comments
                              FROM observation WHERE observation_id = 1`);
  return rows[0];
}

async function savedAnswers() {
  const { rows } = await sql(`SELECT question_id, rating, comment FROM observation_answer
                              WHERE observation_id = 1 ORDER BY question_id`);
  return rows;
}

const fullForm = [
  { questionId: '1', rating: 4, comment: 'Clear structure' },
  { questionId: '2', rating: 5, comment: '' },
];

describe('observation form and signing against the database', { skip }, () => {
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
               VALUES ('fall', 2020, CURRENT_DATE - 60, CURRENT_DATE + 90)`);
    for (const netid of ['ac1', 'obs', 'ee', 'other']) {
      await sql(`INSERT INTO professor (netid, first_name, last_name, email, rank, dept_id, eval_interval_years, start_term)
                 VALUES ($1, $1, 'Test', $1 || '@example.edu', 'full', 1, 2, 1)`, [netid]);
    }
    await sql(`INSERT INTO ac_member (netid) VALUES ('ac1')`);
    await sql(`INSERT INTO template_version (version_no, status, created_by, published_date) VALUES (1, 'live', 'ac1', now())`);
    await sql(`INSERT INTO template_question (version_id, order_no, title, wording, rating_min, rating_max, is_required)
               VALUES (1, 1, 'Organization', 'Was the class organized?', 1, 5, true),
                      (1, 2, 'Engagement', 'Were students engaged?', 1, 5, true)`);
    await sql(`INSERT INTO eval_cycle (term_id, started_by, start_date, signup_deadline, observation_deadline, feedback_deadline)
               VALUES (1, 'ac1', CURRENT_DATE - 30, CURRENT_DATE - 10, CURRENT_DATE + 30, CURRENT_DATE + 45)`);
    await sql(`INSERT INTO course (dept_id, course_num, title, course_level) VALUES (1, '1337', 'Computer Science I', 1000)`);
    await sql(`INSERT INTO section (course_id, term_id, section_num, instructor_id, class_mode) VALUES (1, 1, '001', 'ee', 'in-person')`);
    await sql(`INSERT INTO meeting_time (section_id, day_of_week, start_time, end_time)
               VALUES (1, lower(trim(to_char(CURRENT_DATE + 7, 'FMDay'))), '10:00', '10:50')`);
    await sql(`INSERT INTO sign_up (cycle_id, observee_netid, section_id) VALUES (1, 'ee', 1)`);
    await sql(`INSERT INTO proposed_date (signup_id, date) VALUES (1, CURRENT_DATE + 7)`);
    await sql(`INSERT INTO observer_match (signup_id, observer_netid) VALUES (1, 'obs')`);
    await sql(`INSERT INTO observation_request (signup_id, observer_netid, status, responded_date)
               VALUES (1, 'obs', 'accepted', now())`);
    await sql(`INSERT INTO observation (signup_id, observer_netid, version_id, scheduled_date)
               VALUES (1, 'obs', 1, CURRENT_DATE + 7)`);
  });

  after(async () => {
    await lock.query('SELECT pg_advisory_unlock(4485)');
    lock.release();
    await closePool();
  });

  test('the observer submits the form: answers are saved and the observer has signed', async () => {
    const result = await submitSignedForm(1, observer, fullForm, 'Nice class');
    assert.equal(result.status, 'scheduled');
    assert.ok(result.observerSignedDate);
    assert.equal(result.observeeSignedDate, null);
    assert.deepEqual(result.answers.map((a) => [a.questionId, a.rating, a.comment]),
      [['1', 4, 'Clear structure'], ['2', 5, '']]);
    assert.equal(result.otherComments, 'Nice class');
    assert.deepEqual(await savedAnswers(), [
      { question_id: 1, rating: 4, comment: 'Clear structure' },
      { question_id: 2, rating: 5, comment: '' },
    ]);
  });

  test('a form with a missing answer is rejected and nothing is saved', async () => {
    await assert.rejects(submitSignedForm(1, observer, [fullForm[0]], 'x'), { code: 'ANSWERS_REQUIRED' });
    assert.deepEqual(await savedAnswers(), []);
    const row = await observationRow();
    assert.equal(row.observer_signed_date, null);
    assert.equal(row.other_comments, null);
  });

  test('the observer can resubmit before the observee signs; answers are replaced', async () => {
    await submitSignedForm(1, observer, fullForm, 'First');
    await submitSignedForm(1, observer, [{ questionId: '1', rating: 2, comment: 'Fixed' }, { questionId: '2', rating: 3, comment: '' }], 'Second');
    assert.deepEqual((await savedAnswers()).map((a) => a.rating), [2, 3]);
    assert.equal((await observationRow()).other_comments, 'Second');
  });

  test('the observee cannot sign before the observer submits the form', async () => {
    await assert.rejects(signObservation(1, observee), { code: 'FORM_NOT_SUBMITTED' });
    assert.equal((await observationRow()).observee_signed_date, null);
  });

  test('after the observee signs, the record is completed and locked', async () => {
    await submitSignedForm(1, observer, fullForm, 'Nice class');
    const signed = await signObservation(1, observee);
    assert.equal(signed.status, 'completed');
    assert.ok(signed.observerSignedDate);
    assert.ok(signed.observeeSignedDate);

    await assert.rejects(submitSignedForm(1, observer, [{ questionId: '1', rating: 1, comment: '' }, { questionId: '2', rating: 1, comment: '' }], 'Changed'),
      { code: 'LOCKED' });
    await assert.rejects(signObservation(1, observee), { code: 'LOCKED' });
    assert.deepEqual((await savedAnswers()).map((a) => a.rating), [4, 5]);
    assert.equal((await observationRow()).other_comments, 'Nice class');
  });

  test('only the observer fills in the form and only the observee signs; others get 404', async () => {
    await assert.rejects(submitSignedForm(1, observee, fullForm, ''), { code: 'FORBIDDEN' });
    await submitSignedForm(1, observer, fullForm, '');
    await assert.rejects(signObservation(1, observer), { code: 'FORBIDDEN' });
    await assert.rejects(getObservation(1, someoneElse), { code: 'NOT_FOUND' });
    await assert.rejects(submitSignedForm(1, someoneElse, fullForm, ''), { code: 'NOT_FOUND' });
    await assert.rejects(signObservation(1, someoneElse), { code: 'NOT_FOUND' });
  });

  test('the observer sees the observation in their assignments', async () => {
    const assignments = await listAssignments('obs');
    assert.equal(assignments.length, 1);
    assert.equal(assignments[0].observee.netid, 'ee');
    assert.equal(assignments[0].status, 'scheduled');
    assert.deepEqual(await listAssignments('ee'), []);
  });

  test('if the connection dies mid-transaction, the original error is kept and the pool still works', async () => {
    // pg_terminate_backend on its own connection breaks it, so the ROLLBACK fails too.
    await assert.rejects(inTransaction(async (client) => {
      await client.query("UPDATE observation SET other_comments = 'half done' WHERE observation_id = 1");
      await client.query('SELECT pg_terminate_backend(pg_backend_pid())');
    }), (error: Error) => !/ROLLBACK/i.test(error.message));
    assert.equal((await observationRow()).other_comments, null);
    // The broken connection was discarded, so the next queries work.
    for (let i = 0; i < 12; i += 1) {
      assert.equal((await sql('SELECT 1 AS ok')).rows[0].ok, 1);
    }
  });
});
