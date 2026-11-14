// Database tests for POST and GET /api/observations/{observationId}/issue-file. Setup is in db-test-helper.ts.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { after, before, beforeEach, describe, test } from 'node:test';
import { skip, sql, useTestDatabase } from './db-test-helper.js';
import type { AuthUser } from '../src/services/user.service.js';

const { observationsRouter } = await import('../src/routes/observations.routes.js');
const { errorHandler } = await import('../src/middleware/error.middleware.js');
const { signObservation, submitSignedForm, getObservation } = await import('../src/services/observation.service.js');

function user(netid: string, role: AuthUser['role'] = 'faculty'): AuthUser {
  return {
    netid, firstName: netid, lastName: 'Test', displayName: `Dr. ${netid} Test`, email: `${netid}@example.edu`,
    rank: 'full', department: { deptId: '1', deptName: 'Computer Science' }, role,
  };
}

const app = express();
app.use((req, _res, next) => {
  const netid = req.header('x-test-user') ?? 'ac1';
  req.user = user(netid, netid === 'ac1' ? 'AC' : 'faculty');
  next();
});
app.use('/api/observations', observationsRouter);
app.use(errorHandler);

describe('observation issue file against the database', { skip }, () => {
  useTestDatabase();
  let base: string;
  let server: ReturnType<typeof app.listen>;

  before(async () => {
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => server.once('listening', resolve).once('error', reject));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    if (server?.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
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


  async function lock() {
    await submitSignedForm(1, user('obs'), [
      { questionId: '1', rating: 4, comment: 'Clear structure' },
      { questionId: '2', rating: 5, comment: '' },
    ], 'Nice class');
    const { lastSavedDate } = await getObservation(1, user('ee'));
    await signObservation(1, user('ee'), lastSavedDate);
  }

  async function upload(netid: string, content: string | null, name = 'proof.pdf', id = '1') {
    const form = new FormData();
    if (content !== null) form.append('file', new Blob([content], { type: 'application/pdf' }), name);
    const response = await fetch(`${base}/api/observations/${id}/issue-file`, {
      method: 'POST', headers: { 'x-test-user': netid }, body: form,
    });
    return { status: response.status, body: await response.json() };
  }

  async function download(netid: string) {
    return fetch(`${base}/api/observations/1/issue-file`, { headers: { 'x-test-user': netid } });
  }

  test('the observee attaches a file; the observation shows its name and anyone who can see it can download it', async () => {
    const result = await upload('ee', 'pdf bytes', 'missed class.pdf');
    assert.equal(result.status, 200);
    assert.equal(result.body.observationId, '1');
    assert.equal(result.body.issueFileName, 'missed class.pdf');
    for (const netid of ['ee', 'obs', 'ac1']) {
      const file = await download(netid);
      assert.equal(file.status, 200, netid);
      assert.equal(file.headers.get('content-type'), 'application/pdf');
      assert.equal(file.headers.get('content-disposition'), "attachment; filename*=UTF-8''missed%20class.pdf");
      assert.equal(await file.text(), 'pdf bytes');
    }
  });

  test('a new file replaces the old one and the old one is deleted', async () => {
    await upload('ee', 'first');
    const second = await upload('obs', 'second', 'notes.txt');
    assert.equal(second.body.issueFileName, 'notes.txt');
    assert.equal(await (await download('ee')).text(), 'second');
    assert.equal((await sql('SELECT count(*)::int AS n FROM survey_attachment')).rows[0].n, 1);
  });

  test('a locked record is refused with 409 and nothing is saved', async () => {
    await lock();
    const result = await upload('ee', 'late');
    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, 'RECORD_LOCKED');
    assert.equal((await sql('SELECT count(*)::int AS n FROM survey_attachment')).rows[0].n, 0);
  });

  test('missing or too-large files, the AC, outsiders and a missing file are refused', async () => {
    const missing = await upload('ee', null);
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error.code, 'FILE_REQUIRED');
    const big = await upload('ee', 'x'.repeat(10 * 1024 * 1024 + 1));
    assert.equal(big.status, 400);
    assert.equal(big.body.error.code, 'FILE_TOO_LARGE');
    assert.equal((await upload('ac1', 'pdf')).status, 403);
    assert.equal((await upload('outsider', 'pdf')).status, 404);
    assert.equal((await upload('ee', 'pdf', 'a.pdf', 'abc')).status, 400);
    const none = await download('ee');
    assert.equal(none.status, 404);
    assert.equal((await none.json()).error.code, 'NO_FILE');
    assert.equal((await sql('SELECT count(*)::int AS n FROM survey_attachment')).rows[0].n, 0);
  });
});
