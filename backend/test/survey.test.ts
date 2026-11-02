import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { app } from '../src/app.js';
import { readSurvey } from '../src/routes/survey.routes.js';

test('survey endpoints require a login', async () => {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => server.once('listening', resolve).once('error', reject));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    assert.equal((await fetch(`${base}/api/cycles/1/survey-responses`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`${base}/api/cycles/1/survey-responses`)).status, 401);
  } finally {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('survey fields are checked and text is trimmed', () => {
  assert.deepEqual(readSurvey({ respondentRole: 'observee', processOk: 'false', difficulties: '  late form ', additionalFeedback: '' }),
    { respondentRole: 'observee', processOk: false, difficulties: 'late form', additionalFeedback: null });
  assert.deepEqual(readSurvey({ respondentRole: 'observer', processOk: true }),
    { respondentRole: 'observer', processOk: true, difficulties: null, additionalFeedback: null });
  for (const fields of [{}, { respondentRole: 'ac', processOk: 'true' }, { respondentRole: 'observer', processOk: 'yes' },
    { respondentRole: 'observer', processOk: 'true', difficulties: 5 }, { respondentRole: 'observer', processOk: 'true', difficulties: 'x'.repeat(5001) }]) {
    assert.throws(() => readSurvey(fields), { code: 'INVALID_SURVEY' });
  }
});
