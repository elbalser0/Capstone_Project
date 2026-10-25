import type { PoolClient } from 'pg';
import { getPool } from './pool.js';

// Runs work in a transaction. If ROLLBACK itself fails, the broken connection is
// discarded instead of going back to the pool, and the original error is kept.
export async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  let releaseError: Error | undefined;
  // A connection that drops while checked out emits 'error'; without a listener that
  // would crash the server. Note it so the connection is discarded on release.
  const onError = (error: Error) => {
    releaseError ??= error;
  };
  client.on('error', onError);
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      releaseError ??= rollbackError as Error;
    }
    throw error;
  } finally {
    // A discarded connection keeps the listener in case it reports more errors later.
    if (!releaseError) client.off('error', onError);
    client.release(releaseError);
  }
}
