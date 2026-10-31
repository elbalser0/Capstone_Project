import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { app } from '../src/app.js';
import { readPublish, readTemplate } from '../src/routes/templates.routes.js';

const question = { title: 'Content', wording: 'Is the content clear?', ratingMin: 1, ratingMax: 5, minLabel: 'Poor', maxLabel: 'Great', isRequired: true };

test('template endpoints require a login', async () => {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => server.once('listening', resolve).once('error', reject));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    assert.equal((await fetch(`${base}/api/templates/active`)).status, 401);
    assert.equal((await fetch(`${base}/api/templates`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`${base}/api/templates/1/publish`, { method: 'PATCH' })).status, 401);
  } finally {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('a new template is checked and trimmed', () => {
  assert.deepEqual(readTemplate({ changeNote: '  Added a question ', questions: [{ ...question, title: ' Content ', minLabel: '' }] }), {
    changeNote: 'Added a question',
    questions: [{ ...question, minLabel: '' }],
  });
  assert.equal(readTemplate({ questions: [{ ...question, isRequired: undefined }] }).questions[0].isRequired, true);
  assert.throws(() => readTemplate({ questions: [] }), { code: 'QUESTIONS_REQUIRED' });
  assert.throws(() => readTemplate({ changeNote: 'x' }), { code: 'QUESTIONS_REQUIRED' });
  for (const body of [
    [], 'x', { questions: ['x'] }, { changeNote: 5, questions: [question] },
    { questions: [{ ...question, title: '  ' }] }, { questions: [{ ...question, wording: undefined }] },
    { questions: [{ ...question, ratingMin: 1.5 }] }, { questions: [{ ...question, ratingMax: 1 }] },
    { questions: [{ ...question, ratingMax: 500 }] }, { questions: [{ ...question, isRequired: 'yes' }] },
    { questions: [{ ...question, minLabel: 3 }] }, { questions: Array(101).fill(question) },
  ]) {
    assert.throws(() => readTemplate(body), { code: 'INVALID_TEMPLATE' }, JSON.stringify(body).slice(0, 80));
  }
});

test('publish takes an optional change note', () => {
  assert.equal(readPublish(undefined), undefined);
  assert.equal(readPublish({}), undefined);
  assert.equal(readPublish({ changeNote: '  ' }), undefined);
  assert.equal(readPublish({ changeNote: ' v2 ' }), 'v2');
  assert.throws(() => readPublish({ changeNote: 5 }), { code: 'INVALID_TEMPLATE' });
});
