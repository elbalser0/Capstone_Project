// Database tests for login accounts (professors and admins). Setup is in db-test-helper.ts.
// Firebase is mocked: the bearer token is used as the verified email address.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, mock, test } from 'node:test';
import { skip, sql, useTestDatabase } from './db-test-helper.js';
import { firebaseAuth } from '../src/config/firebase.js';
import { findAccountByEmail } from '../src/services/user.service.js';

// Imported after the helper so the app uses the test database.
const { app } = await import('../src/app.js');

describe('login accounts against the database', { skip }, () => {
  useTestDatabase();
  let base: string;
  let server: ReturnType<typeof app.listen>;

  before(async () => {
    mock.method(firebaseAuth, 'verifyIdToken', async (token: string) => ({ email: token, email_verified: true }) as never);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => server.once('listening', resolve).once('error', reject));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    mock.restoreAll();
    if (server?.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  beforeEach(async () => {
    await sql('TRUNCATE department, term, professor, app_admin RESTART IDENTITY CASCADE');
    await sql("INSERT INTO department (dept_name) VALUES ('Computer Science')");
    await sql(`INSERT INTO term (season, year, start_date, end_date) VALUES ('fall', 2024, '2024-08-24', '2024-12-11')`);
    for (const [netid, first, last, email, active] of [
      ['pro123456', 'Paula', 'Prof', 'paula.prof@example.edu', true],
      ['bot123456', 'Bo', 'Both', 'bo.both@example.edu', true],
      ['acm123456', 'Ann', 'Committee', 'ann.committee@example.edu', true],
      ['old123456', 'Olga', 'Former', 'olga.former@example.edu', false],
    ] as const) {
      await sql(`INSERT INTO professor (netid, first_name, last_name, email, rank, dept_id,
                                        eval_interval_years, start_term, is_active)
                 VALUES ($1, $2, $3, $4, 'associate', 1, 2, 1, $5)`, [netid, first, last, email, active]);
    }
    await sql("INSERT INTO ac_member (netid) VALUES ('acm123456')");
    await sql(`INSERT INTO app_admin (email, first_name, last_name, is_active) VALUES
               ('ada.admin@example.edu', 'Ada', 'Admin', true),
               ('Bo.Both@Example.edu', 'Bo', 'Both', true),
               ('olga.former@example.edu', 'Olga', 'Former', true),
               ('gone.admin@example.edu', 'Gone', 'Admin', false)`);
  });

  async function get(path: string, email?: string) {
    const response = await fetch(`${base}${path}`, {
      headers: email === undefined ? {} : { authorization: `Bearer ${email}` },
    });
    return { status: response.status, body: await response.json() };
  }

  describe('findAccountByEmail', () => {
    test('a professor only', async () => {
      const account = await findAccountByEmail('paula.prof@example.edu');
      assert.equal(account.email, 'paula.prof@example.edu');
      assert.equal(account.professor?.netid, 'pro123456');
      assert.equal(account.admin, undefined);
    });

    test('an admin only', async () => {
      const account = await findAccountByEmail('ada.admin@example.edu');
      assert.equal(account.professor, undefined);
      assert.deepEqual(account.admin, { adminId: '1', email: 'ada.admin@example.edu', firstName: 'Ada', lastName: 'Admin' });
    });

    test('both a professor and an admin, matching email case-insensitively', async () => {
      const account = await findAccountByEmail('BO.BOTH@example.EDU');
      assert.equal(account.professor?.netid, 'bot123456');
      assert.equal(account.admin?.adminId, '2');
    });

    test('neither', async () => {
      const account = await findAccountByEmail('stranger@example.edu');
      assert.equal(account.professor, undefined);
      assert.equal(account.admin, undefined);
    });

    test('an inactive admin is not an admin', async () => {
      assert.equal((await findAccountByEmail('gone.admin@example.edu')).admin, undefined);
    });

    test('an inactive professor who is an active admin is only an admin', async () => {
      const account = await findAccountByEmail('olga.former@example.edu');
      assert.equal(account.professor, undefined);
      assert.equal(account.admin?.firstName, 'Olga');
    });
  });

  describe('GET /api/me', () => {
    test('a professor gets the existing profile with isAdmin false', async () => {
      const { status, body } = await get('/api/me', 'paula.prof@example.edu');
      assert.equal(status, 200);
      assert.deepEqual(body, {
        netid: 'pro123456', firstName: 'Paula', lastName: 'Prof', displayName: 'Dr. Paula Prof',
        email: 'paula.prof@example.edu', rank: 'associate',
        department: { deptId: '1', deptName: 'Computer Science' }, role: 'faculty', isAdmin: false,
      });
    });

    test('an AC member keeps role AC', async () => {
      const { body } = await get('/api/me', 'ann.committee@example.edu');
      assert.equal(body.role, 'AC');
      assert.equal(body.isAdmin, false);
    });

    test('a professor who is also an admin gets isAdmin true', async () => {
      const { status, body } = await get('/api/me', 'bo.both@example.edu');
      assert.equal(status, 200);
      assert.equal(body.netid, 'bot123456');
      assert.equal(body.role, 'faculty');
      assert.equal(body.isAdmin, true);
    });

    test('an admin who is not a professor gets the admin shape', async () => {
      const { status, body } = await get('/api/me', 'ada.admin@example.edu');
      assert.equal(status, 200);
      assert.deepEqual(body, {
        netid: null, firstName: 'Ada', lastName: 'Admin', displayName: 'Ada Admin',
        email: 'ada.admin@example.edu', rank: null, department: null, role: 'admin', isAdmin: true,
      });
    });

    test('an account that is neither gets 403 NOT_A_PROFESSOR', async () => {
      for (const email of ['stranger@example.edu', 'gone.admin@example.edu']) {
        const { status, body } = await get('/api/me', email);
        assert.equal(status, 403, email);
        assert.equal(body.error.code, 'NOT_A_PROFESSOR', email);
      }
    });
  });

  describe('route guards', () => {
    test('an admin who is not a professor cannot use the professor routes', async () => {
      for (const path of ['/api/me/evaluation-status', '/api/me/signup', '/api/me/requests', '/api/cycles/current']) {
        const { status, body } = await get(path, 'ada.admin@example.edu');
        assert.equal(status, 403, path);
        assert.equal(body.error.code, 'NOT_A_PROFESSOR', path);
      }
    });

    test('a professor still reaches the professor routes', async () => {
      const { status } = await get('/api/cycles/current', 'paula.prof@example.edu');
      assert.equal(status, 200);
    });

    test('a professor who is not an admin gets 403 FORBIDDEN from admin routes', async () => {
      for (const email of ['paula.prof@example.edu', 'ann.committee@example.edu']) {
        const { status, body } = await get('/api/admin/anything', email);
        assert.equal(status, 403, email);
        assert.equal(body.error.code, 'FORBIDDEN', email);
      }
    });

    test('POST /api/admin/import is open to admins only, professor or not', async () => {
      async function postTerm(email: string) {
        const form = new FormData();
        form.append('term', new Blob(['term_id,season,year,start_date,end_date\n900,spring,2027,2027-01-12,2027-05-08\n'],
          { type: 'text/csv' }), 'term.csv');
        const response = await fetch(`${base}/api/admin/import`, {
          method: 'POST', headers: { authorization: `Bearer ${email}` }, body: form,
        });
        return { status: response.status, body: await response.json() };
      }

      // An admin who is not a professor can import.
      const adminOnly = await postTerm('ada.admin@example.edu');
      assert.equal(adminOnly.status, 200);
      assert.equal(adminOnly.body.imported.term, 1);

      // An AC member who is not an admin, and plain faculty, cannot.
      for (const email of ['ann.committee@example.edu', 'paula.prof@example.edu']) {
        const refused = await postTerm(email);
        assert.equal(refused.status, 403, email);
        assert.equal(refused.body.error.message, 'Only admins can do this.', email);
      }
      assert.equal((await sql("SELECT count(*)::int AS n FROM term WHERE year = 2027")).rows[0].n, 1);
    });

    test('an admin reaches the admin router', async () => {
      for (const email of ['ada.admin@example.edu', 'bo.both@example.edu']) {
        const { status, body } = await get('/api/admin/anything', email);
        assert.equal(status, 404, email);
        assert.equal(body.error.code, 'NOT_FOUND', email);
      }
    });
  });
});
