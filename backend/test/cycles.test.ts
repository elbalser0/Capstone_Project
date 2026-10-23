import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { app } from '../src/app.js';
import { checkDeadlineOrder, cyclePhase } from '../src/services/cycle.service.js';

test('cycle endpoints require a login', async () => {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => server.once('listening', resolve).once('error', reject));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const deadlines = { signupDeadline: '2026-11-01', observationDeadline: '2026-11-20', feedbackDeadline: '2026-12-05' };
    const requests: [string, string, unknown?][] = [
      ['GET', '/api/cycles/current'],
      ['GET', '/api/cycles/1/signups'],
      ['POST', '/api/cycles', { termId: '11', ...deadlines }],
      ['PATCH', '/api/cycles/1', { feedbackDeadline: '2026-12-06' }],
    ];
    for (const [method, path, body] of requests) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      assert.equal(response.status, 401, `${method} ${path}`);
    }
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
});

test('deadlines must be in order', () => {
  const ok = { signupDeadline: '2026-11-01', observationDeadline: '2026-11-20', feedbackDeadline: '2026-12-05' };
  assert.doesNotThrow(() => checkDeadlineOrder('2026-10-23', ok));
  assert.doesNotThrow(() => checkDeadlineOrder('2026-11-01', { ...ok, observationDeadline: '2026-11-01' }));
  assert.throws(() => checkDeadlineOrder('2026-11-02', ok), { code: 'INVALID_DEADLINES' });
  assert.throws(() => checkDeadlineOrder('2026-10-23', { ...ok, observationDeadline: '2026-10-30' }), { code: 'INVALID_DEADLINES' });
  assert.throws(() => checkDeadlineOrder('2026-10-23', { ...ok, feedbackDeadline: '2026-11-19' }), { code: 'INVALID_DEADLINES' });
});

test('cycle phase follows today and the deadlines', () => {
  const d = { signupDeadline: '2026-11-01', observationDeadline: '2026-11-20', feedbackDeadline: '2026-12-05' };
  assert.equal(cyclePhase('2026-11-01', d, false), 'signup');
  assert.equal(cyclePhase('2026-11-02', d, false), 'matching');
  assert.equal(cyclePhase('2026-11-02', d, true), 'observation');
  assert.equal(cyclePhase('2026-11-21', d, true), 'feedback');
  assert.equal(cyclePhase('2026-12-06', d, true), 'closed');
});
