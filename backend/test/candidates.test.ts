import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { app } from '../src/app.js';
import { closePool, getPool } from '../src/db/pool.js';
import { errorHandler } from '../src/middleware/error.middleware.js';
import { signupsRouter } from '../src/routes/faculty-scaffold.routes.js';
import { listSignupCandidates } from '../src/services/candidate.service.js';

test('candidate routes require login and a valid signup ID', async () => {
  const routeApp = express();
  routeApp.use('/api/signups', signupsRouter);
  routeApp.use(errorHandler);
  for (const [testApp, expected] of [[app, 401], [routeApp, 400]] as const) {
    const server = testApp.listen(0, '127.0.0.1');
    try {
      await new Promise<void>((resolve, reject) => server.once('listening', resolve).once('error', reject));
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const response = await fetch(`${base}/api/signups/0/candidates`);
      assert.equal(response.status, expected);
      if (expected === 400) assert.equal((await response.json()).error.code, 'INVALID_SIGNUP_ID');
    } finally {
      if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
});

test('candidates are scoped to the signup owner and include request state', async () => {
  process.env.DATABASE_URL ??= 'postgresql://localhost/test';
  const pool = getPool();
  const originalQuery = pool.query;
  let rows: unknown[] = [];
  pool.query = (async (sql: string, params: unknown[]) => {
    assert.match(sql, /signup\.signup_id = \$1 AND signup\.observee_netid = \$2/);
    assert.deepEqual(params, [9, 'maya']);
    return { rows };
  }) as typeof pool.query;
  try {
    await assert.rejects(listSignupCandidates(9, 'maya'), { status: 404, code: 'NOT_FOUND' });
    rows = [{ observer_netid: null }];
    assert.deepEqual(await listSignupCandidates(9, 'maya'), []);

    rows = [{
      observer_netid: 'grace', first_name: 'Grace', last_name: 'Hopper', rank: 'full', round_no: 1,
      request_status: 'pending', sent_date: new Date('2026-10-22T11:00:00Z'),
      db_now: new Date('2026-10-22T12:00:00Z'),
      teaches: ['Computer Science 1337'], free_at_proposed_times: true,
    }];
    assert.deepEqual(await listSignupCandidates(9, 'maya'), [{
      observer: { netid: 'grace', firstName: 'Grace', lastName: 'Hopper', displayName: 'Dr. Grace Hopper', rank: 'full' },
      roundNo: 1,
      request: { status: 'pending', sentDate: '2026-10-22T11:00:00.000Z' },
      teaches: ['Computer Science 1337'], freeAtProposedTimes: true,
    }]);
  } finally {
    pool.query = originalQuery;
    await closePool();
  }
});
