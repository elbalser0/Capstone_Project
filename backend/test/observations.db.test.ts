// Database tests for the observation form and signing. Setup is in db-test-helper.ts.
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { getPool, skip, sql, useTestDatabase } from './db-test-helper.js';
import type { AuthUser } from '../src/services/user.service.js';

const { getObservation, listAssignments, signObservation, submitSignedForm } = await import('../src/services/observation.service.js');
const { inTransaction } = await import('../src/db/transaction.js');

function user(netid: string, role: AuthUser['role'] = 'faculty'): AuthUser {
  return {
    netid, firstName: netid, lastName: 'Test', displayName: `Dr. ${netid} Test`, email: `${netid}@example.edu`,
    rank: 'full', department: { deptId: '1', deptName: 'Computer Science' }, role,
  };
}
const observer = user('obs');
const observee = user('ee');
const someoneElse = user('other');

// The observee signs the version they just read, like the client does.
async function sign(signer: AuthUser) {
  const { lastSavedDate } = await getObservation(1, signer);
  return signObservation(1, signer, lastSavedDate);
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
  useTestDatabase();

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
               VALUES (1, lower(trim(to_char(CURRENT_DATE, 'FMDay'))), '10:00', '10:50')`);
    await sql(`INSERT INTO sign_up (cycle_id, observee_netid, section_id) VALUES (1, 'ee', 1)`);
    // The observation is today, so the form can be filled in. A week later (same weekday) is a second proposed date.
    await sql(`INSERT INTO proposed_date (signup_id, date) VALUES (1, CURRENT_DATE), (1, CURRENT_DATE + 7)`);
    await sql(`INSERT INTO observer_match (signup_id, observer_netid) VALUES (1, 'obs')`);
    await sql(`INSERT INTO observation_request (signup_id, observer_netid, status, responded_date)
               VALUES (1, 'obs', 'accepted', now())`);
    await sql(`INSERT INTO observation (signup_id, observer_netid, version_id, scheduled_date)
               VALUES (1, 'obs', 1, CURRENT_DATE)`);
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
    await assert.rejects(sign(observee), { code: 'FORM_NOT_SUBMITTED' });
    assert.equal((await observationRow()).observee_signed_date, null);
  });

  test('after the observee signs, the record is completed and locked', async () => {
    await submitSignedForm(1, observer, fullForm, 'Nice class');
    const signed = await sign(observee);
    assert.equal(signed.status, 'completed');
    assert.ok(signed.observerSignedDate);
    assert.ok(signed.observeeSignedDate);

    await assert.rejects(submitSignedForm(1, observer, [{ questionId: '1', rating: 1, comment: '' }, { questionId: '2', rating: 1, comment: '' }], 'Changed'),
      { code: 'LOCKED' });
    await assert.rejects(sign(observee), { code: 'LOCKED' });
    assert.deepEqual((await savedAnswers()).map((a) => a.rating), [4, 5]);
    assert.equal((await observationRow()).other_comments, 'Nice class');
  });

  test('only the observer fills in the form and only the observee signs; others get 404', async () => {
    await assert.rejects(submitSignedForm(1, observee, fullForm, ''), { code: 'FORBIDDEN' });
    await submitSignedForm(1, observer, fullForm, '');
    await assert.rejects(sign(observer), { code: 'FORBIDDEN' });
    await assert.rejects(getObservation(1, someoneElse), { code: 'NOT_FOUND' });
    await assert.rejects(submitSignedForm(1, someoneElse, fullForm, ''), { code: 'NOT_FOUND' });
    await assert.rejects(signObservation(1, someoneElse, new Date().toISOString()), { code: 'NOT_FOUND' });
  });

  test('the form shows each question\'s rating scale from this observation\'s template version', async () => {
    await sql(`UPDATE template_question SET min_label = 'Poor', max_label = 'Excellent' WHERE question_id = 1`);
    const { answers } = await getObservation(1, observer);
    assert.deepEqual(answers.map((a) => [a.ratingMin, a.ratingMax, a.minLabel, a.maxLabel, a.isRequired]),
      [[1, 5, 'Poor', 'Excellent', true], [1, 5, null, null, true]]);
  });

  test('the form cannot be submitted before the observation date', async () => {
    await sql(`UPDATE observation SET scheduled_date = CURRENT_DATE + 7 WHERE observation_id = 1`);
    await assert.rejects(submitSignedForm(1, observer, fullForm, ''), { code: 'NOT_YET_OBSERVED' });
    assert.deepEqual(await savedAnswers(), []);
    assert.equal((await observationRow()).observer_signed_date, null);
  });

  test('a missed observation cannot be filled in', async () => {
    await sql(`UPDATE observation SET status = 'not_completed', reason_not_completed = 'Class cancelled' WHERE observation_id = 1`);
    await assert.rejects(submitSignedForm(1, observer, fullForm, ''), { code: 'NOT_SCHEDULED' });
    assert.deepEqual(await savedAnswers(), []);
  });

  test('an answer for a question from another template version is rejected', async () => {
    await sql(`INSERT INTO template_version (version_no, status, created_by) VALUES (2, 'draft', 'ac1')`);
    await sql(`INSERT INTO template_question (version_id, order_no, title, wording, rating_min, rating_max, is_required)
               VALUES (2, 1, 'Other', 'From version 2', 1, 5, true)`);
    await assert.rejects(submitSignedForm(1, observer, [...fullForm, { questionId: '3', rating: 3, comment: '' }], ''),
      { code: 'INVALID_ANSWERS' });
    assert.deepEqual(await savedAnswers(), []);
  });

  test('the observee cannot sign a version they never saw', async () => {
    await submitSignedForm(1, observer, fullForm, 'First');
    const seen = (await getObservation(1, observee)).lastSavedDate;
    await submitSignedForm(1, observer, [{ questionId: '1', rating: 2, comment: '' }, { questionId: '2', rating: 2, comment: '' }], 'Changed');
    await assert.rejects(signObservation(1, observee, seen), { code: 'STALE_FORM' });
    assert.equal((await observationRow()).observee_signed_date, null);
    // After reloading, the observee signs the new version.
    const signed = await sign(observee);
    assert.equal(signed.status, 'completed');
    assert.equal(signed.otherComments, 'Changed');
  });

  test('double-clicking Sign: one request signs, the other gets LOCKED', async () => {
    await submitSignedForm(1, observer, fullForm, '');
    const { lastSavedDate } = await getObservation(1, observee);
    // Hold the row so both requests read it before either UPDATE runs, like a real double-click.
    const holder = await getPool().connect();
    let both: Promise<PromiseSettledResult<unknown>[]>;
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM observation WHERE observation_id = 1 FOR UPDATE');
      both = Promise.allSettled([signObservation(1, observee, lastSavedDate), signObservation(1, observee, lastSavedDate)]);
      while ((await sql(`SELECT count(*)::int AS n FROM pg_stat_activity
                         WHERE wait_event_type = 'Lock' AND query LIKE '%UPDATE observation%'`)).rows[0].n < 2) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } finally {
      await holder.query('COMMIT');
      holder.release();
    }
    const results = await both;
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    assert.equal(failed.reason.code, 'LOCKED');
  });

  test('an AC member who is not part of the observation can read it but not fill it in or sign it', async () => {
    const ac = user('ac1', 'AC');
    const detail = await getObservation(1, ac);
    assert.equal(detail.observee.netid, 'ee');
    await assert.rejects(submitSignedForm(1, ac, fullForm, ''), { code: 'FORBIDDEN' });
    await submitSignedForm(1, observer, fullForm, '');
    await assert.rejects(sign(ac), { code: 'FORBIDDEN' });
    assert.equal((await observationRow()).observee_signed_date, null);
  });

  test('AC members who are the observer or observee still fill in and sign as usual', async () => {
    await sql(`INSERT INTO ac_member (netid) VALUES ('obs'), ('ee')`);
    await submitSignedForm(1, user('obs', 'AC'), fullForm, '');
    const signed = await sign(user('ee', 'AC'));
    assert.equal(signed.status, 'completed');
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
