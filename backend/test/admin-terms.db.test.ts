// Database tests for POST /api/admin/terms and the next-term lookup. Setup is in db-test-helper.ts.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { after, before, beforeEach, describe, test } from 'node:test';
import { skip, sql, useTestDatabase } from './db-test-helper.js';
import { adminRouter } from '../src/routes/admin.routes.js';
import { errorHandler } from '../src/middleware/error.middleware.js';
import { findNextTermId } from '../src/services/term.service.js';

// Isolate the admin routes from Firebase: every request is an admin (auth is covered in accounts.db.test.ts).
const routeApp = express();
routeApp.use(express.json());
routeApp.use((req, _res, next) => {
  req.account = { email: 'ada.admin@example.edu', admin: { adminId: '1', email: 'ada.admin@example.edu', firstName: 'Ada', lastName: 'Admin' } };
  next();
});
routeApp.use('/api/admin', adminRouter);
routeApp.use(errorHandler);

describe('admin terms against the database', { skip }, () => {
  useTestDatabase();
  let base: string;
  let server: ReturnType<typeof routeApp.listen>;

  before(async () => {
    server = routeApp.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => server.once('listening', resolve).once('error', reject));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    if (server?.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  beforeEach(async () => {
    await sql('TRUNCATE term RESTART IDENTITY CASCADE');
  });

  async function addTerm(season: string, year: number, start: string, end: string) {
    await sql('INSERT INTO term (season, year, start_date, end_date) VALUES ($1, $2, $3, $4)', [season, year, start, end]);
  }

  async function post(body: unknown) {
    const response = await fetch(`${base}/api/admin/terms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }

  async function termLabels() {
    const { rows } = await sql("SELECT season || ' ' || year AS label FROM term ORDER BY start_date");
    return rows.map((row) => row.label);
  }

  describe('POST /api/admin/terms', () => {
    test('creates a term and returns it', async () => {
      await addTerm('spring', 2027, '2027-01-12', '2027-05-08');
      const { status, body } = await post({ season: 'fall', year: 2027, startDate: '2027-08-24', endDate: '2027-12-11' });
      assert.equal(status, 201);
      assert.deepEqual(body, {
        termId: '2', season: 'fall', year: 2027, label: 'Fall 2027', startDate: '2027-08-24', endDate: '2027-12-11',
      });
      assert.deepEqual(await termLabels(), ['spring 2027', 'fall 2027']);
    });

    test('rejects an invalid body without saving anything', async () => {
      const { status, body } = await post({ season: 'summer', year: 2027, startDate: '2027-06-01', endDate: '2027-07-01' });
      assert.equal(status, 400);
      assert.equal(body.error.code, 'INVALID_TERM');
      assert.deepEqual(await termLabels(), []);
    });

    test('rejects a season and year that already exist', async () => {
      await addTerm('spring', 2027, '2027-01-12', '2027-05-08');
      const { status, body } = await post({ season: 'spring', year: 2027, startDate: '2027-06-01', endDate: '2027-07-01' });
      assert.equal(status, 409);
      assert.equal(body.error.code, 'TERM_EXISTS');
      assert.match(body.error.message, /Spring 2027/);
    });

    test('rejects dates that overlap another term, including a shared first or last day', async () => {
      await addTerm('spring', 2027, '2027-01-12', '2027-05-08');
      for (const term of [
        { season: 'fall', year: 2026, startDate: '2026-08-24', endDate: '2027-01-12' },
        { season: 'fall', year: 2027, startDate: '2027-05-08', endDate: '2027-12-11' },
        { season: 'fall', year: 2027, startDate: '2027-02-01', endDate: '2027-03-01' },
      ]) {
        const { status, body } = await post(term);
        assert.equal(status, 409, JSON.stringify(term));
        assert.equal(body.error.code, 'TERM_OVERLAP');
        assert.match(body.error.message, /Spring 2027/);
      }
      assert.deepEqual(await termLabels(), ['spring 2027']);
    });

    test('rejects a term that would start after a later semester', async () => {
      await addTerm('fall', 2027, '2027-08-24', '2027-12-11');
      const { status, body } = await post({ season: 'spring', year: 2027, startDate: '2027-12-20', endDate: '2027-12-30' });
      assert.equal(status, 409);
      assert.equal(body.error.code, 'TERM_OUT_OF_ORDER');
      assert.match(body.error.message, /Fall 2027/);
    });

    test('rejects a term that would start before an earlier semester', async () => {
      await addTerm('spring', 2028, '2028-01-12', '2028-05-08');
      const { status, body } = await post({ season: 'fall', year: 2028, startDate: '2028-01-01', endDate: '2028-01-05' });
      assert.equal(status, 409);
      assert.equal(body.error.code, 'TERM_OUT_OF_ORDER');
      assert.match(body.error.message, /Spring 2028/);
    });

    test('allows a gap and filling it later', async () => {
      await addTerm('spring', 2027, '2027-01-12', '2027-05-08');
      assert.equal((await post({ season: 'spring', year: 2028, startDate: '2028-01-12', endDate: '2028-05-08' })).status, 201);
      assert.equal((await post({ season: 'fall', year: 2027, startDate: '2027-08-24', endDate: '2027-12-11' })).status, 201);
      assert.deepEqual(await termLabels(), ['spring 2027', 'fall 2027', 'spring 2028']);
    });

    test('allows a past term', async () => {
      assert.equal((await post({ season: 'fall', year: 2020, startDate: '2020-08-24', endDate: '2020-12-11' })).status, 201);
    });
  });

  describe('findNextTermId', () => {
    async function addRelative(season: string, year: number, startOffset: number, endOffset: number) {
      const { rows } = await sql(`INSERT INTO term (season, year, start_date, end_date)
                                  VALUES ($1, $2, CURRENT_DATE + $3::int, CURRENT_DATE + $4::int) RETURNING term_id`,
      [season, year, startOffset, endOffset]);
      return rows[0].term_id as number;
    }

    test('returns the earliest term that starts after today, not the current term', async () => {
      await addRelative('fall', 2090, -30, 30);
      await addRelative('fall', 2091, 200, 260);
      const next = await addRelative('spring', 2091, 60, 120);
      assert.equal(await findNextTermId(), next);
    });

    test('a term starting today is not the next term', async () => {
      await addRelative('fall', 2090, 0, 90);
      assert.equal(await findNextTermId(), null);
    });

    test('returns null when there is no future term', async () => {
      await addRelative('fall', 2090, -200, -100);
      await addRelative('spring', 2091, -30, 30);
      assert.equal(await findNextTermId(), null);
    });
  });
});
