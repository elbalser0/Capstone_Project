import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { app } from '../src/app.js';
import { alertFor } from '../src/services/matching.service.js';

test('matching requires a login', async () => {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => server.once('listening', resolve).once('error', reject));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    assert.equal((await fetch(`${base}/api/cycles/1/matching`, { method: 'POST' })).status, 401);
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
});

test('no observers raises no_observer, fewer than 3 raises insufficient_observers', () => {
  assert.equal(alertFor(0), 'no_observer');
  assert.equal(alertFor(1), 'insufficient_observers');
  assert.equal(alertFor(2), 'insufficient_observers');
  assert.equal(alertFor(3), null);
  assert.equal(alertFor(5), null);
});
