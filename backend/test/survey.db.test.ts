// Database tests for the end-of-process survey. Setup is in db-test-helper.ts.
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { skip, sql, useTestDatabase } from './db-test-helper.js';

const { listSurveyResponses, submitSurvey } = await import('../src/services/survey.service.js');
const { MAX_FILE_BYTES, MAX_FORM_BYTES, surveyRouter } = await import('../src/routes/survey.routes.js');
const { errorHandler } = await import('../src/middleware/error.middleware.js');

const answers = { processOk: true, difficulties: null, additionalFeedback: null };

// Posts like the frontend does (multipart form data) as the given professor.
async function post(netid: string, form: FormData | { stream: ReadableStream; type: string }, cycle = '1') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { netid, role: netid === 'ac1' ? 'AC' : 'faculty' } as typeof req.user; next(); });
  app.use('/api/cycles/:cycleId/survey-responses', surveyRouter);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/cycles/${cycle}/survey-responses`,
      form instanceof FormData
        ? { method: 'POST', body: form }
        // A streamed body is sent chunked, without a Content-Length header.
        : { method: 'POST', body: form.stream, headers: { 'Content-Type': form.type }, duplex: 'half' } as RequestInit);
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// GET the trouble file as the given professor.
async function download(netid: string, responseId: string) {
  const app = express();
  app.use((req, _res, next) => { req.user = { netid, role: netid === 'ac1' ? 'AC' : 'faculty' } as typeof req.user; next(); });
  app.use('/api/cycles/:cycleId/survey-responses', surveyRouter);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/cycles/1/survey-responses/${responseId}/trouble-file`);
    return { status: response.status, headers: response.headers, body: Buffer.from(await response.arrayBuffer()) };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

describe('survey against the database', { skip }, () => {
  useTestDatabase();

  // Cycle 1: observation deadline was yesterday, feedback deadline in 10 days (survey open).
  // ee signed up and obs observed them; other did neither.
  beforeEach(async () => {
    await sql(`TRUNCATE department, term, professor RESTART IDENTITY CASCADE`);
    await sql(`INSERT INTO department (dept_name) VALUES ('Computer Science')`);
    await sql(`INSERT INTO term (season, year, start_date, end_date) VALUES ('fall', 2026, CURRENT_DATE - 90, CURRENT_DATE + 30)`);
    for (const netid of ['ac1', 'ee', 'obs', 'other']) {
      await sql(`INSERT INTO professor (netid, first_name, last_name, email, rank, dept_id, eval_interval_years, start_term)
                 VALUES ($1, $1, 'Test', $1 || '@example.edu', 'full', 1, 2, 1)`, [netid]);
    }
    await sql(`INSERT INTO ac_member (netid) VALUES ('ac1')`);
    await sql(`INSERT INTO template_version (version_no, status, created_by, published_date) VALUES (1, 'live', 'ac1', now())`);
    await sql(`INSERT INTO eval_cycle (term_id, started_by, start_date, signup_deadline, observation_deadline, feedback_deadline)
               VALUES (1, 'ac1', CURRENT_DATE - 60, CURRENT_DATE - 40, CURRENT_DATE - 1, CURRENT_DATE + 10)`);
    await sql(`INSERT INTO course (dept_id, course_num, title, course_level) VALUES (1, '1337', 'CS I', 1000)`);
    await sql(`INSERT INTO section (course_id, term_id, section_num, instructor_id, class_mode) VALUES (1, 1, '001', 'ee', 'in-person')`);
    await sql(`INSERT INTO sign_up (cycle_id, observee_netid, section_id) VALUES (1, 'ee', 1)`);
    await sql(`INSERT INTO proposed_date (signup_id, date) VALUES (1, CURRENT_DATE - 5)`);
    await sql(`INSERT INTO observer_match (signup_id, observer_netid) VALUES (1, 'obs')`);
    await sql(`INSERT INTO observation_request (signup_id, observer_netid, status, sent_date, responded_date)
               VALUES (1, 'obs', 'accepted', now() - interval '20 days', now() - interval '19 days')`);
    await sql(`INSERT INTO observation (signup_id, observer_netid, version_id, scheduled_date) VALUES (1, 'obs', 1, CURRENT_DATE - 5)`);
  });

  test('observee and observer submit form data; the AC list shows both, newest first', async () => {
    const first = await post('ee', form({ respondentRole: 'observee', processOk: 'false', difficulties: ' Scheduling ', additionalFeedback: '' }));
    assert.equal(first.status, 201);
    assert.match(first.body.responseId, /^\d+$/);
    assert.equal((await post('obs', form({ respondentRole: 'observer', processOk: 'true' }))).status, 201);

    const list = await listSurveyResponses(1);
    assert.deepEqual(list.map((r) => [r.respondent.netid, r.respondentRole, r.processOk, r.difficulties, r.additionalFeedback]),
      [['obs', 'observer', true, '', ''], ['ee', 'observee', false, 'Scheduling', '']]);
    assert.equal(list[0].respondent.displayName, 'Dr. obs Test');
    assert.equal(list[0].troubleFileKey, null);
    assert.match(list[0].submittedDate, /^\d{4}-\d{2}-\d{2}$/);
  });

  test('one response per role', async () => {
    await submitSurvey(1, 'ee', { respondentRole: 'observee', ...answers });
    await assert.rejects(submitSurvey(1, 'ee', { respondentRole: 'observee', ...answers }), { status: 409, code: 'ALREADY_SUBMITTED' });
    assert.equal((await listSurveyResponses(1)).length, 1);
  });

  test('only participants can answer, in the role they had', async () => {
    await assert.rejects(submitSurvey(1, 'other', { respondentRole: 'observee', ...answers }), { status: 403, code: 'NOT_A_PARTICIPANT' });
    await assert.rejects(submitSurvey(1, 'ee', { respondentRole: 'observer', ...answers }), { status: 403, code: 'NOT_A_PARTICIPANT' });
    await assert.rejects(submitSurvey(1, 'obs', { respondentRole: 'observee', ...answers }), { status: 403, code: 'NOT_A_PARTICIPANT' });
  });

  test('the survey is only open after the observation deadline through the feedback deadline', async () => {
    await sql(`UPDATE eval_cycle SET observation_deadline = CURRENT_DATE, feedback_deadline = CURRENT_DATE + 10`);
    await assert.rejects(submitSurvey(1, 'ee', { respondentRole: 'observee', ...answers }), { status: 409, code: 'SURVEY_CLOSED' });
    await sql(`UPDATE eval_cycle SET observation_deadline = CURRENT_DATE - 10, feedback_deadline = CURRENT_DATE - 1`);
    await assert.rejects(submitSurvey(1, 'ee', { respondentRole: 'observee', ...answers }), { status: 409, code: 'SURVEY_CLOSED' });
    await sql(`UPDATE eval_cycle SET feedback_deadline = CURRENT_DATE`);
    assert.ok((await submitSurvey(1, 'ee', { respondentRole: 'observee', ...answers })).responseId);
  });

  test('bad input and unknown cycles are rejected without saving', async () => {
    assert.equal((await post('ee', form({ respondentRole: 'observee' }))).body.error.code, 'INVALID_SURVEY');
    assert.deepEqual(await post('ee', form({ respondentRole: 'observee', processOk: 'true' }), 'abc').then((r) => r.status), 400);
    await assert.rejects(submitSurvey(99, 'ee', { respondentRole: 'observee', ...answers }), { status: 404, code: 'NOT_FOUND' });
    await assert.rejects(listSurveyResponses(99), { status: 404, code: 'NOT_FOUND' });
    assert.equal((await sql('SELECT count(*)::int AS n FROM survey_response')).rows[0].n, 0);
  });

  test('a trouble file is stored with the response and only the AC can download it', async () => {
    const withFile = form({ respondentRole: 'observee', processOk: 'false', difficulties: 'see file' });
    withFile.append('troubleFile', new Blob(['scheduling notes'], { type: 'text/plain' }), 'notes é.txt');
    const created = await post('ee', withFile);
    assert.equal(created.status, 201);
    const [listed] = await listSurveyResponses(1);
    assert.match(listed.troubleFileKey!, /^\d+$/);
    const { rows: [saved] } = await sql('SELECT file_name, file_type, file_size, uploaded_by FROM survey_attachment');
    assert.deepEqual(saved, { file_name: 'notes é.txt', file_type: 'text/plain', file_size: '16', uploaded_by: 'ee' });

    const file = await download('ac1', created.body.responseId);
    assert.equal(file.status, 200);
    assert.equal(file.body.toString(), 'scheduling notes');
    assert.match(file.headers.get('content-type')!, /^text\/plain/);
    assert.equal(file.headers.get('content-disposition'), "attachment; filename*=UTF-8''notes%20%C3%A9.txt");
    assert.equal((await download('ee', created.body.responseId)).status, 403);
    assert.equal((await download('ac1', '999')).status, 404);
    assert.equal((await download('ac1', 'abc')).status, 400);

    // A response without a file has no download.
    const plain = await post('obs', form({ respondentRole: 'observer', processOk: 'true' }));
    assert.equal((await download('ac1', plain.body.responseId)).status, 404);
  });

  test('a duplicate response with a file is rejected and leaves no stored file', async () => {
    await submitSurvey(1, 'ee', { respondentRole: 'observee', ...answers });
    const again = form({ respondentRole: 'observee', processOk: 'true' });
    again.append('troubleFile', new Blob(['x']), 'x.txt');
    assert.deepEqual(await post('ee', again).then((r) => [r.status, r.body.error.code]), [409, 'ALREADY_SUBMITTED']);
    assert.equal((await sql('SELECT count(*)::int AS n FROM survey_attachment')).rows[0].n, 0);
  });

  test('a file over 10 MB is rejected and nothing is saved', async () => {
    const big = form({ respondentRole: 'observee', processOk: 'true' });
    big.append('troubleFile', new Blob([new Uint8Array(MAX_FILE_BYTES + 1)]), 'big.bin');
    assert.deepEqual(await post('ee', big).then((r) => [r.status, r.body.error.code]), [400, 'FILE_TOO_LARGE']);
    assert.equal((await sql('SELECT count(*)::int AS n FROM survey_response')).rows[0].n, 0);
    assert.equal((await sql('SELECT count(*)::int AS n FROM survey_attachment')).rows[0].n, 0);
  });

  test('a form over the size limit is rejected even when sent chunked without Content-Length', async () => {
    const big = form({ respondentRole: 'observee', processOk: 'true', difficulties: 'x'.repeat(MAX_FORM_BYTES + 1) });
    const encoded = new Request('http://x/', { method: 'POST', body: big });
    const type = encoded.headers.get('content-type')!;
    const bytes = new Uint8Array(await encoded.arrayBuffer());
    let offset = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (offset >= bytes.length) return controller.close();
        controller.enqueue(bytes.subarray(offset, offset += 64 * 1024));
      },
    });
    assert.deepEqual(await post('ee', { stream, type }).then((r) => [r.status, r.body.error.code]), [413, 'TOO_LARGE']);
    // A normal chunked form still works.
    const small = new Request('http://x/', { method: 'POST', body: form({ respondentRole: 'observee', processOk: 'true' }) });
    const smallBytes = new Uint8Array(await small.arrayBuffer());
    const smallStream = new ReadableStream({ start(c) { c.enqueue(smallBytes); c.close(); } });
    assert.equal((await post('ee', { stream: smallStream, type: small.headers.get('content-type')! })).status, 201);
    assert.equal((await sql('SELECT count(*)::int AS n FROM survey_response')).rows[0].n, 1);
  });
});
