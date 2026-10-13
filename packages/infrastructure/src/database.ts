import { Pool, type PoolClient } from 'pg';
import type { Config } from './config';
export function createPool(config: Config): Pool {
  return new Pool({
    connectionString: config.databaseUrl,
    max: 20,
    connectionTimeoutMillis: config.databaseTimeoutMs,
    idleTimeoutMillis: 30000,
    statement_timeout: config.databaseTimeoutMs,
    query_timeout: config.databaseTimeoutMs + 1000,
    idle_in_transaction_session_timeout: config.databaseTimeoutMs,
  });
}
export async function transaction<T>(
  pool: Pool,
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* Keep the original failure. */
    }
    throw error;
  } finally {
    client.release();
  }
}
