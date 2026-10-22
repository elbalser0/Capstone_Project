import { closePool, getPool } from './pool.js';

// TODO: Run this against the shared development database when DATABASE_URL is available.
// This verifies connectivity only; schema creation and migrations are separate work.
try {
  // Connectivity only: no application tables or schema assumptions.
  await getPool().query('SELECT 1');
  console.log('PostgreSQL connection successful.');
} catch {
  console.error('PostgreSQL connection check failed. Verify DATABASE_URL, server availability, and provider TLS settings.');
  process.exitCode = 1;
} finally {
  await closePool();
}
