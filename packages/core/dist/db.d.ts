import { Pool, PoolClient } from 'pg';
import { Config } from './config';
/**
 * Get or create the singleton Postgres connection pool.
 * Reuses the same pool across the entire process.
 */
export declare function getPool(config: Config): Pool;
/**
 * Run the schema migration — creates tables if they don't exist.
 * Safe to call multiple times (all DDL uses IF NOT EXISTS).
 */
export declare function migrate(config: Config): Promise<void>;
/**
 * Execute a callback inside a Postgres transaction.
 * Automatically commits on success, rolls back on error.
 */
export declare function withTransaction<T>(p: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T>;
/**
 * Gracefully shut down the pool (used during process exit).
 */
export declare function closePool(): Promise<void>;
