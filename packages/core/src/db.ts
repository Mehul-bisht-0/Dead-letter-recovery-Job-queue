// ---------------------------------------------------------------------------
// PostgreSQL connection pool and schema migration
// ---------------------------------------------------------------------------

import { Pool, PoolClient } from 'pg';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { Config } from './config';

let pool: Pool | null = null;

/**
 * Get or create the singleton Postgres connection pool.
 * Reuses the same pool across the entire process.
 */
export function getPool(config: Config): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    pool.on('error', (err) => {
      console.error('[db] Unexpected pool error:', err.message);
    });
  }
  return pool;
}

/**
 * Run the schema migration — creates tables if they don't exist.
 * Safe to call multiple times (all DDL uses IF NOT EXISTS).
 */
export async function migrate(config: Config): Promise<void> {
  const p = getPool(config);
  const client = await p.connect();
  const sql = readFileSync(resolveCoreAsset('schema.sql'), 'utf-8');

  await client.query('SELECT pg_advisory_lock(hashtext($1))', ['reliable-queue:migrate']);
  try {
    await client.query(sql);
    console.log('[db] Schema migration complete');
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['reliable-queue:migrate']);
    client.release();
  }
}

/**
 * Execute a callback inside a Postgres transaction.
 * Automatically commits on success, rolls back on error.
 */
export async function withTransaction<T>(
  p: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Gracefully shut down the pool (used during process exit).
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('[db] Connection pool closed');
  }
}

function resolveCoreAsset(relativePath: string): string {
  const candidates = [
    join(__dirname, relativePath),
    join(__dirname, '..', 'src', relativePath),
  ];

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`Unable to find core asset: ${relativePath}`);
  }

  return found;
}
