// Database tests for POST /api/observations/{observationId}/forward. Setup is in db-test-helper.ts.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { after, before, beforeEach, describe, test } from 'node:test';
import { skip, sql, useTestDatabase } from './db-test-helper.js';
import type { AuthUser } from '../src/services/user.service.js';

const { observationsRouter } = await import('../src/routes/observations.routes.js');
const { errorHandler } = await import('../src/middleware/error.middleware.js');
const { setMailTransportForTests, waitForEmails } = await import('../src/services/email.service.js');
const { signObservation, submitSignedForm, getObservation } = await import('../src/services/observation.service.js');

function user(netid: string, role: AuthUser['role'] = 'faculty'): AuthUser {
  return {
    netid, firstName: netid, lastName: 'Test', displayName: `Dr. ${netid} Test`, email: `${netid}@example.edu`,
    rank: 'full', department: { deptId: '1', deptName: 'Computer Science' }, role,
  };
}

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const netid = req.header('x-test-user') ?? 'ac1';
  req.user = user(netid, netid === 'ac1' ? 'AC' : 'faculty');
  next();
});
app.use('/api/observations', observationsRouter);
app.use(errorHandler);

type Mail = { to: string; subject: string; text: string };
let sent: Mail[] = [];

describe('forwarding an observation against the database', { skip }, () => {
  useTestDatabase();
  let base: string;
  let server: ReturnType<typeof app.listen>;

  before(async () => {
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => server.once('listening', resolve).once('error', reject));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    setMailTransportForTests({ sendMail: async (mail: Mail) => { sent.push(mail); return {}; } } as unknown as Parameters<typeof setMailTransportForTests>[0]);
  });

  after(async () => {
    setMailTransportForTests(undefined);
    if (server?.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  beforeEach(async () => {
    sent = [];
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

  async function forward(body: unknown, netid = 'ac1', id = '1') {
    const response = await fetch(`${base}/api/observations/${id}/forward`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': netid }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }

  test('forwards a locked record: saves a row with a token and emails the record', async () => {
    await lock();
    const result = await forward({ email: '  chair@example.edu ' });
    assert.equal(result.status, 201);
    assert.equal(result.body.forwardId, '1');
    assert.ok(!Number.isNaN(Date.parse(result.body.sharedDate)));
    const { rows } = await sql('SELECT observation_id, recipient_email, shared_by, link_token FROM forwarded_observation');
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].observation_id, rows[0].recipient_email, rows[0].shared_by], [1, 'chair@example.edu', 'ac1']);
    assert.ok(rows[0].link_token.length >= 32);
    await waitForEmails();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'chair@example.edu');
    assert.equal(sent[0].subject, 'Observation record: Dr. ee Test, Fall 2020');
    for (const part of ['Observee: Dr. ee Test', 'Observer: Dr. obs Test', '1337 Computer Science I, section 001',
      'Organization: 4 of 5', '  Clear structure', 'Engagement: 5 of 5', 'Other comments: Nice class', 'Signed by the observee on']) {
      assert.ok(sent[0].text.includes(part), part);
    }
  });

  test('each forward gets its own row and token', async () => {
    await lock();
    await forward({ email: 'a@example.edu' });
    await forward({ email: 'a@example.edu' });
    const { rows } = await sql('SELECT DISTINCT link_token FROM forwarded_observation');
    assert.equal(rows.length, 2);
  });

  test('a record that is not signed by both is refused with 409 and nothing is saved', async () => {
    const unsigned = await forward({ email: 'a@example.edu' });
    assert.equal(unsigned.status, 409);
    assert.equal(unsigned.body.error.code, 'NOT_LOCKED');
    await submitSignedForm(1, user('obs'), [{ questionId: '1', rating: 4, comment: '' }, { questionId: '2', rating: 5, comment: '' }], '');
    assert.equal((await forward({ email: 'a@example.edu' })).status, 409);
    assert.equal((await sql('SELECT count(*)::int AS n FROM forwarded_observation')).rows[0].n, 0);
  });

  test('a bad email gets 400, faculty 403, a bad id 400 and an unknown observation 404', async () => {
    await lock();
    for (const body of [{ email: 'not-an-email' }, { email: '' }, {}, { email: 5 }]) {
      const bad = await forward(body);
      assert.equal(bad.status, 400);
      assert.equal(bad.body.error.code, 'INVALID_EMAIL');
    }
    assert.equal((await forward({ email: 'a@example.edu' }, 'ee')).status, 403);
    assert.equal((await forward({ email: 'a@example.edu' }, 'ac1', 'abc')).status, 400);
    assert.equal((await forward({ email: 'a@example.edu' }, 'ac1', '99')).status, 404);
    assert.equal((await sql('SELECT count(*)::int AS n FROM forwarded_observation')).rows[0].n, 0);
    await waitForEmails();
    assert.equal(sent.length, 0);
  });
});
