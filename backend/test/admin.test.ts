import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { app } from '../src/app.js';

test('GET /api/me and admin endpoints require a login', async () => {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => server.once('listening', resolve).once('error', reject));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const requests: [string, string][] = [
      ['GET', '/api/me'],
      ['GET', '/api/me/evaluation-status'],
      ['GET', '/api/admin/professors'],
      ['GET', '/api/admin/departments'],
      ['POST', '/api/admin/terms'],
      ['GET', '/api/admin/anything'],
      ['POST', '/api/admin/professors'],
      ['PATCH', '/api/admin/professors/abc123456'],
    ];
    for (const [method, path] of requests) {
      const response = await fetch(`${base}${path}`, { method });
      assert.equal(response.status, 401, `${method} ${path}`);
      assert.equal((await response.json()).error.code, 'UNAUTHENTICATED', `${method} ${path}`);
    }
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
});
