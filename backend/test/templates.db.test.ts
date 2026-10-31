// Database tests for the template endpoints. Setup is in db-test-helper.ts.
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { skip, sql, useTestDatabase } from './db-test-helper.js';

const { createDraft, getActiveTemplate, loadTemplateVersions, publishDraft } = await import('../src/services/template.service.js');
const { templatesRouter } = await import('../src/routes/templates.routes.js');
const { errorHandler } = await import('../src/middleware/error.middleware.js');

const q = (title: string) => ({ title, wording: `${title}?`, ratingMin: 1, ratingMax: 5, minLabel: 'Low', maxLabel: 'High', isRequired: true });
const statuses = async () => (await sql('SELECT version_no, status FROM template_version ORDER BY version_no')).rows
  .map((r) => `${r.version_no}:${r.status}`);

async function call(role: 'AC' | 'faculty', method: string, path: string, body?: unknown) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { netid: 'ac1', role } as typeof req.user; next(); });
  app.use('/api/templates', templatesRouter);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/templates${path}`, {
      method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('templates against the database', { skip }, () => {
  useTestDatabase();

  beforeEach(async () => {
    await sql(`TRUNCATE department, term, professor RESTART IDENTITY CASCADE`);
    await sql(`INSERT INTO department (dept_name) VALUES ('Computer Science')`);
    await sql(`INSERT INTO term (season, year, start_date, end_date) VALUES ('fall', 2026, CURRENT_DATE - 60, CURRENT_DATE + 60)`);
    for (const [netid, first] of [['ac1', 'Isabel'], ['ee', 'Ee'], ['obs', 'Obs']]) {
      await sql(`INSERT INTO professor (netid, first_name, last_name, email, rank, dept_id, eval_interval_years, start_term)
                 VALUES ($1, $2, 'Nakamura', $1 || '@example.edu', 'full', 1, 2, 1)`, [netid, first]);
    }
    await sql(`INSERT INTO ac_member (netid) VALUES ('ac1')`);
  });

  test('no live version yet returns NOT_FOUND', async () => {
    await assert.rejects(getActiveTemplate(), { status: 404, code: 'NOT_FOUND' });
  });

  test('create a draft, publish it, and it becomes the active template with its questions in order', async () => {
    const draft = await createDraft('ac1', 'First version', [q('Content'), q('Delivery')]);
    assert.equal(draft.status, 'draft');
    assert.equal(draft.versionNo, 1);
    assert.equal(draft.publishedDate, null);
    assert.equal(draft.createdBy.displayName, 'Dr. Isabel Nakamura');
    assert.match(draft.createdDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(draft.questions.map((x) => [x.orderNo, x.title, x.ratingMin, x.ratingMax, x.minLabel, x.isRequired]),
      [[1, 'Content', 1, 5, 'Low', true], [2, 'Delivery', 1, 5, 'Low', true]]);
    await assert.rejects(getActiveTemplate(), { code: 'NOT_FOUND' }); // drafts are not active

    const live = await publishDraft(Number(draft.versionId), 'Ready for fall');
    assert.equal(live.status, 'live');
    assert.equal(live.changeNote, 'Ready for fall');
    assert.match(live.publishedDate!, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(await getActiveTemplate(), live);
  });

  test('saving a draft replaces the previous draft; publishing retires the live version', async () => {
    const v1 = await createDraft('ac1', 'v1', [q('A')]);
    await publishDraft(Number(v1.versionId), undefined);
    await createDraft('ac1', 'first try', [q('B')]);
    const v2 = await createDraft('ac1', 'second try', [q('C'), q('D')]);
    assert.deepEqual(await statuses(), ['1:live', '2:draft']);
    assert.deepEqual(v2.questions.map((x) => x.title), ['C', 'D']);
    assert.equal((await sql("SELECT count(*)::int AS n FROM template_question WHERE title = 'B'")).rows[0].n, 0);

    const live = await publishDraft(Number(v2.versionId), '');
    assert.equal(live.changeNote, 'second try'); // empty note keeps the draft's note
    assert.deepEqual(await statuses(), ['1:retired', '2:live']);
    assert.equal((await getActiveTemplate()).versionNo, 2);
    assert.deepEqual((await loadTemplateVersions('true', [])).map((v) => v.versionNo), [2, 1]);
  });

  test('only a draft can be published, and unknown versions return NOT_FOUND', async () => {
    const v1 = await createDraft('ac1', 'v1', [q('A')]);
    await publishDraft(Number(v1.versionId), undefined);
    await assert.rejects(publishDraft(Number(v1.versionId), undefined), { status: 409, code: 'NOT_DRAFT' });
    await assert.rejects(publishDraft(99, undefined), { status: 404, code: 'NOT_FOUND' });
    assert.deepEqual(await statuses(), ['1:live']);
  });

  test('two publishes at once leave exactly one live version', async () => {
    const v1 = await createDraft('ac1', 'v1', [q('A')]);
    const results = await Promise.allSettled([publishDraft(Number(v1.versionId), 'a'), publishDraft(Number(v1.versionId), 'b')]);
    assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
    assert.deepEqual(await statuses(), ['1:live']);
  });

  test('observationsCount counts observations that used the version', async () => {
    const v1 = await createDraft('ac1', 'v1', [q('A')]);
    await publishDraft(Number(v1.versionId), undefined);
    await sql(`INSERT INTO eval_cycle (term_id, started_by, start_date, signup_deadline, observation_deadline, feedback_deadline)
               VALUES (1, 'ac1', CURRENT_DATE - 30, CURRENT_DATE - 10, CURRENT_DATE + 30, CURRENT_DATE + 45)`);
    await sql(`INSERT INTO course (dept_id, course_num, title, course_level) VALUES (1, '1337', 'CS I', 1000)`);
    await sql(`INSERT INTO section (course_id, term_id, section_num, instructor_id, class_mode) VALUES (1, 1, '001', 'ee', 'in-person')`);
    await sql(`INSERT INTO sign_up (cycle_id, observee_netid, section_id) VALUES (1, 'ee', 1)`);
    await sql(`INSERT INTO proposed_date (signup_id, date) VALUES (1, CURRENT_DATE + 7)`);
    await sql(`INSERT INTO observer_match (signup_id, observer_netid) VALUES (1, 'obs')`);
    await sql(`INSERT INTO observation_request (signup_id, observer_netid, status, responded_date) VALUES (1, 'obs', 'accepted', now())`);
    await sql(`INSERT INTO observation (signup_id, observer_netid, version_id, scheduled_date) VALUES (1, 'obs', $1, CURRENT_DATE + 7)`, [Number(v1.versionId)]);
    assert.equal((await getActiveTemplate()).observationsCount, 1);
  });

  test('routes: AC only for create and publish, anyone signed in reads the active version', async () => {
    assert.deepEqual(await call('faculty', 'POST', '', { questions: [q('A')] }).then((r) => r.status), 403);
    const created = await call('AC', 'POST', '', { changeNote: 'v1', questions: [q('A')] });
    assert.equal(created.status, 201);
    assert.equal((await call('faculty', 'PATCH', `/${created.body.versionId}/publish`)).status, 403);
    assert.deepEqual(await call('AC', 'PATCH', '/abc/publish').then((r) => [r.status, r.body.error.code]), [400, 'INVALID_VERSION_ID']);
    assert.deepEqual(await call('AC', 'POST', '', { questions: [] }).then((r) => [r.status, r.body.error.code]), [400, 'QUESTIONS_REQUIRED']);
    const published = await call('AC', 'PATCH', `/${created.body.versionId}/publish`, { changeNote: 'Fall' });
    assert.deepEqual([published.status, published.body.status, published.body.changeNote], [200, 'live', 'Fall']);
    const active = await call('faculty', 'GET', '/active');
    assert.deepEqual([active.status, active.body.versionId, active.body.questions.length], [200, created.body.versionId, 1]);
  });
});
