// Unit tests for the login guards and the GET /api/me response. No database; Firebase is mocked.
import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { firebaseAuth } from '../src/config/firebase.js';
import {
  authenticate,
  requireAdmin,
  requireLogin,
  requireProfessor,
} from '../src/middleware/auth.middleware.js';
import { ApiError } from '../src/middleware/error.middleware.js';
import { meResponse } from '../src/routes/me.routes.js';
import type { Account, AdminAccount, AuthUser } from '../src/services/user.service.js';

const professor: AuthUser = {
  netid: 'abc123456', firstName: 'Maya', lastName: 'Lin', displayName: 'Dr. Maya Lin',
  email: 'maya.lin@example.edu', rank: 'associate', department: { deptId: '1', deptName: 'Computer Science' },
  role: 'faculty',
};
const admin: AdminAccount = { adminId: '1', email: 'admin@example.edu', firstName: 'Ada', lastName: 'Admin' };

// Runs one middleware and returns what it passed to next(), or undefined when it passed nothing.
async function run(
  middleware: (req: Request, res: Response, next: NextFunction) => unknown,
  req: Partial<Request>,
): Promise<unknown> {
  let called = false;
  let received: unknown;
  await middleware(req as Request, {} as Response, (error?: unknown) => {
    called = true;
    received = error;
  });
  assert.ok(called, 'next() was not called');
  return received;
}

function assertApiError(error: unknown, status: number, code: string) {
  assert.ok(error instanceof ApiError, `expected an ApiError, got ${String(error)}`);
  assert.equal(error.status, status);
  assert.equal(error.code, code);
}

describe('requireProfessor', () => {
  test('rejects an account without a professor', async () => {
    assertApiError(await run(requireProfessor, { account: { email: admin.email, admin } }), 403, 'NOT_A_PROFESSOR');
  });

  test('passes a professor through', async () => {
    assert.equal(await run(requireProfessor, { user: professor }), undefined);
  });
});

describe('requireAdmin', () => {
  test('rejects a request with no account', async () => {
    const error = await run(requireAdmin, {});
    assertApiError(error, 403, 'FORBIDDEN');
    assert.equal((error as ApiError).message, 'Only admins can do this.');
  });

  test('rejects a professor who is not an admin', async () => {
    assertApiError(await run(requireAdmin, { user: professor, account: { email: professor.email, professor } }), 403, 'FORBIDDEN');
  });

  test('passes an admin through', async () => {
    assert.equal(await run(requireAdmin, { account: { email: admin.email, admin } }), undefined);
  });
});

describe('requireLogin', () => {
  test('is authenticate followed by requireProfessor', () => {
    assert.deepEqual(requireLogin, [authenticate, requireProfessor]);
  });
});

describe('authenticate token checks', () => {
  afterEach(() => mock.restoreAll());

  const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } }) as Partial<Request>;

  test('rejects a request without a bearer token', async () => {
    const verify = mock.method(firebaseAuth, 'verifyIdToken', async () => {
      throw new Error('should not be called');
    });
    assertApiError(await run(authenticate, { headers: {} }), 401, 'UNAUTHENTICATED');
    assertApiError(await run(authenticate, { headers: { authorization: 'Basic abc' } }), 401, 'UNAUTHENTICATED');
    assert.equal(verify.mock.callCount(), 0);
  });

  test('rejects a token Firebase cannot verify', async () => {
    mock.method(firebaseAuth, 'verifyIdToken', async () => {
      throw new Error('expired');
    });
    assertApiError(await run(authenticate, bearer('bad')), 401, 'INVALID_TOKEN');
  });

  test('rejects a token without a verified email', async () => {
    mock.method(firebaseAuth, 'verifyIdToken', async () => ({ email: 'x@example.edu', email_verified: false }) as never);
    assertApiError(await run(authenticate, bearer('unverified')), 401, 'UNVERIFIED_EMAIL');
    mock.restoreAll();
    mock.method(firebaseAuth, 'verifyIdToken', async () => ({ email_verified: true }) as never);
    assertApiError(await run(authenticate, bearer('no-email')), 401, 'UNVERIFIED_EMAIL');
  });

  test('passes the token after "Bearer " to Firebase', async () => {
    const verify = mock.method(firebaseAuth, 'verifyIdToken', async () => {
      throw new Error('stop here');
    });
    await run(authenticate, bearer('the-token'));
    assert.deepEqual(verify.mock.calls[0].arguments, ['the-token']);
  });
});

describe('GET /api/me response', () => {
  test('a professor gets their profile with isAdmin false', () => {
    const account: Account = { email: professor.email, professor };
    assert.deepEqual(meResponse(account), { ...professor, isAdmin: false });
  });

  test('a professor who is also an admin keeps their role and gets isAdmin true', () => {
    const ac: AuthUser = { ...professor, role: 'AC' };
    assert.deepEqual(meResponse({ email: ac.email, professor: ac, admin }), { ...ac, isAdmin: true });
  });

  test('an admin who is not a professor gets the admin shape', () => {
    assert.deepEqual(meResponse({ email: admin.email, admin }), {
      netid: null,
      firstName: 'Ada',
      lastName: 'Admin',
      displayName: 'Ada Admin',
      email: 'admin@example.edu',
      rank: null,
      department: null,
      role: 'admin',
      isAdmin: true,
    });
  });
});
