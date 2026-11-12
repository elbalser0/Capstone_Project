import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { PoolClient } from 'pg';
import { app } from '../src/app.js';
import { requireAC } from '../src/middleware/auth.middleware.js';
import { listTerms } from '../src/services/term.service.js';

test('GET /api/terms requires a login', async () => {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => server.once('listening', resolve).once('error', reject));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const response = await fetch(`${base}/api/terms`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: { code: 'UNAUTHENTICATED', message: 'Missing login token.' } });
  } finally {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('GET /api/terms/{termId}/due-preview requires a login', async () => {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => server.once('listening', resolve).once('error', reject));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const response = await fetch(`${base}/api/terms/2/due-preview`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: { code: 'UNAUTHENTICATED', message: 'Missing login token.' } });
  } finally {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('GET /api/terms is restricted to AC members', () => {
  let error: unknown;
  requireAC({ user: { role: 'faculty' } } as never, {} as never, (nextError) => { error = nextError; });
  assert.equal((error as { status?: number; code?: string }).status, 403);
  assert.equal((error as { status?: number; code?: string }).code, 'FORBIDDEN');

  error = undefined;
  requireAC({ user: { role: 'AC' } } as never, {} as never, (nextError) => { error = nextError; });
  assert.equal(error, undefined);
});

test('terms are mapped to the frontend shape and queried oldest first', async () => {
  let queryText = '';
  const fakeDb = {
    async query(sql: string) {
      queryText = sql;
      return { rows: [
        { term_id: 2, season: 'fall', year: 2026, start_date: '2026-08-24', end_date: '2026-12-11' },
        { term_id: 3, season: 'spring', year: 2027, start_date: '2027-01-11', end_date: '2027-05-05' },
      ] };
    },
  } as unknown as Pick<PoolClient, 'query'>;

  assert.deepEqual(await listTerms(fakeDb), [
    { termId: '2', season: 'fall', year: 2026, label: 'Fall 2026', startDate: '2026-08-24', endDate: '2026-12-11' },
    { termId: '3', season: 'spring', year: 2027, label: 'Spring 2027', startDate: '2027-01-11', endDate: '2027-05-05' },
  ]);
  assert.match(queryText, /ORDER BY start_date, term_id/);
});
