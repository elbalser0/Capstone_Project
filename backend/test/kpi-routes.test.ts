import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { app } from '../src/app.js';
import { errorHandler } from '../src/middleware/error.middleware.js';
import { cyclesRouter } from '../src/routes/cycles.routes.js';
import type { AuthUser } from '../src/services/user.service.js';

const paths = ['/api/cycles/latest/kpis', '/api/cycles/1/kpis'];

async function withServer(target: express.Express, run: (base: string) => Promise<void>) {
  const server = target.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => server.once('listening', resolve).once('error', reject));
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function appAs(role: AuthUser['role']) {
  const routeApp = express();
  routeApp.use((req, _res, next) => { req.user = { netid: 'someone', role } as AuthUser; next(); });
  routeApp.use('/api/cycles', cyclesRouter);
  routeApp.use(errorHandler);
  return routeApp;
}

test('KPI endpoints require a login', async () => {
  await withServer(app, async (base) => {
    for (const path of paths) assert.equal((await fetch(`${base}${path}`)).status, 401, path);
  });
});

test('KPI endpoints are for the committee only', async () => {
  await withServer(appAs('faculty'), async (base) => {
    for (const path of paths) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 403, path);
      assert.equal((await response.json()).error.code, 'FORBIDDEN', path);
    }
  });
});

test('a cycle id must be a positive integer or latest', async () => {
  await withServer(appAs('AC'), async (base) => {
    for (const id of ['abc', '0', '-1', '1.5', 'Latest']) {
      const response = await fetch(`${base}/api/cycles/${id}/kpis`);
      assert.equal(response.status, 400, id);
      assert.equal((await response.json()).error.code, 'INVALID_CYCLE_ID', id);
    }
  });
});
