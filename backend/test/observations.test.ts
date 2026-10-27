import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { app } from '../src/app.js';
import { readReportMissed, readSignBody, readSignedForm } from '../src/routes/observations.routes.js';
import { checkAnswers } from '../src/services/observation.service.js';

test('observation endpoints require a login', async () => {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => server.once('listening', resolve).once('error', reject));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const [method, path] of [
      ['GET', '/api/me/assignments'], ['GET', '/api/observations/1'],
      ['POST', '/api/observations/1/signed-form'], ['POST', '/api/observations/1/sign'],
      ['GET', '/api/me/observations?as=observee'], ['POST', '/api/observations/1/report-missed'],
    ]) {
      const response = await fetch(`${base}${path}`, {
        method, headers: { 'content-type': 'application/json' },
        body: method === 'POST' ? JSON.stringify({ answers: [], otherComments: '' }) : undefined,
      });
      assert.equal(response.status, 401, `${method} ${path}`);
    }
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
});

const questions = [
  { question_id: 1, title: 'Organization', wording: 'Was the class organized?', rating_min: 1, rating_max: 5, is_required: true },
  { question_id: 2, title: 'Engagement', wording: 'Were students engaged?', rating_min: 1, rating_max: 5, is_required: true },
  { question_id: 3, title: 'Extra', wording: 'Anything else?', rating_min: 1, rating_max: 5, is_required: false },
];

test('the form needs a rating in range for every required question', () => {
  const ok = [{ questionId: '1', rating: 4, comment: '' }, { questionId: '2', rating: 5, comment: 'Great' }];
  assert.doesNotThrow(() => checkAnswers(questions, ok));
  assert.throws(() => checkAnswers(questions, [ok[0]]), { code: 'ANSWERS_REQUIRED' });
  assert.throws(() => checkAnswers(questions, [ok[0], { questionId: '2', rating: 6, comment: '' }]), { code: 'INVALID_ANSWERS' });
  assert.throws(() => checkAnswers(questions, [...ok, { questionId: '9', rating: 3, comment: '' }]), { code: 'INVALID_ANSWERS' });
  assert.throws(() => checkAnswers(questions, [...ok, ok[0]]), { code: 'INVALID_ANSWERS' });
});

test('the signed-form body is checked and trimmed', () => {
  assert.deepEqual(readSignedForm({ answers: [{ questionId: '1', rating: 4, comment: ' good ' }], otherComments: ' ok ' }), {
    answers: [{ questionId: '1', rating: 4, comment: 'good' }], otherComments: 'ok',
  });
  assert.throws(() => readSignedForm({ answers: 'nope' }), { code: 'INVALID_FORM' });
  assert.throws(() => readSignedForm({ answers: [{ questionId: 1, rating: 4 }] }), { code: 'INVALID_FORM' });
});

test('the sign body must carry the lastSavedDate the observee read', () => {
  assert.equal(readSignBody({ lastSavedDate: '2026-10-26T15:04:05.123456+00:00' }), '2026-10-26T15:04:05.123456+00:00');
  assert.equal(readSignBody({ lastSavedDate: '2026-10-26T15:04:05Z' }), '2026-10-26T15:04:05Z');
  assert.throws(() => readSignBody(undefined), { code: 'INVALID_SIGN' });
  assert.throws(() => readSignBody({}), { code: 'INVALID_SIGN' });
  assert.throws(() => readSignBody({ lastSavedDate: 'yesterday' }), { code: 'INVALID_SIGN' });
  assert.throws(() => readSignBody({ lastSavedDate: '2026-13-45T99:00:00Z' }), { code: 'INVALID_SIGN' });
});

test('report-missed needs a reason, trimmed', () => {
  assert.equal(readReportMissed({ reason: '  Class was cancelled  ' }), 'Class was cancelled');
  assert.throws(() => readReportMissed({ reason: '   ' }), { code: 'REASON_REQUIRED' });
  assert.throws(() => readReportMissed({}), { code: 'REASON_REQUIRED' });
  assert.throws(() => readReportMissed(undefined), { code: 'REASON_REQUIRED' });
  assert.throws(() => readReportMissed({ reason: 5 }), { code: 'REASON_REQUIRED' });
});
