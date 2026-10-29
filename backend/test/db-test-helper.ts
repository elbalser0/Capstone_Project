// Shared setup for the *.db.test.ts files. Run them with a separate, empty PostgreSQL database
// by setting TEST_DATABASE_URL in backend/.env or in the shell:
//   TEST_DATABASE_URL=postgresql://.../assessment_test npm test
// The database name must end in "_test" because the setup drops and rebuilds the schema.
// Without TEST_DATABASE_URL the database tests are skipped.
import { readFile } from 'node:fs/promises';
import { after, before } from 'node:test';
import type { PoolClient } from 'pg';
// Load backend/.env so TEST_DATABASE_URL can live there. Shell variables still win.
import '../src/env.js';

// Neon's pooled host (-pooler) does not keep the session advisory lock below, so test files
// would rebuild the schema at the same time. Use the direct host for the same database.
const url = process.env.TEST_DATABASE_URL?.trim().replace('-pooler.', '.');
export const skip = !url
  ? 'set TEST_DATABASE_URL to run database tests'
  : !new URL(url).pathname.replace('/', '').endsWith('_test')
    ? 'TEST_DATABASE_URL must point to a database whose name ends in _test'
    : false;
// Must be set before any src/ module creates the pool.
if (!skip) process.env.DATABASE_URL = url;

const { getPool, closePool } = await import('../src/db/pool.js');
export { getPool };

// Database test files run in parallel and all rebuild the schema, so each one holds
// this lock for its whole run and the others wait their turn.
export const TEST_DB_LOCK = 4485;

export async function sql(text: string, params: unknown[] = []) {
  return getPool().query(text, params);
}

// Call inside a describe block: takes the lock, rebuilds the schema, and cleans up afterwards.
export function useTestDatabase() {
  let lock: PoolClient | undefined;

  before(async () => {
    lock = await getPool().connect();
    await lock.query('SELECT pg_advisory_lock($1)', [TEST_DB_LOCK]);
    await sql('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await sql(await readFile(new URL('../../database/schema.sql', import.meta.url), 'utf8'));
  });

  // If connect() or the lock failed, lock is undefined; closePool still runs so the process can exit.
  after(async () => {
    try {
      if (lock) {
        try {
          await lock.query('SELECT pg_advisory_unlock($1)', [TEST_DB_LOCK]);
        } finally {
          lock.release();
        }
      }
    } finally {
      await closePool();
    }
  });
}
