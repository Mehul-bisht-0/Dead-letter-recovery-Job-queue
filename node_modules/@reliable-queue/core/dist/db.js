"use strict";
// ---------------------------------------------------------------------------
// PostgreSQL connection pool and schema migration
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPool = getPool;
exports.migrate = migrate;
exports.withTransaction = withTransaction;
exports.closePool = closePool;
const pg_1 = require("pg");
const fs_1 = require("fs");
const path_1 = require("path");
let pool = null;
/**
 * Get or create the singleton Postgres connection pool.
 * Reuses the same pool across the entire process.
 */
function getPool(config) {
    if (!pool) {
        pool = new pg_1.Pool({
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
async function migrate(config) {
    const p = getPool(config);
    const client = await p.connect();
    const sql = (0, fs_1.readFileSync)(resolveCoreAsset('schema.sql'), 'utf-8');
    await client.query('SELECT pg_advisory_lock(hashtext($1))', ['reliable-queue:migrate']);
    try {
        await client.query(sql);
        console.log('[db] Schema migration complete');
    }
    finally {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['reliable-queue:migrate']);
        client.release();
    }
}
/**
 * Execute a callback inside a Postgres transaction.
 * Automatically commits on success, rolls back on error.
 */
async function withTransaction(p, fn) {
    const client = await p.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    }
    catch (err) {
        await client.query('ROLLBACK');
        throw err;
    }
    finally {
        client.release();
    }
}
/**
 * Gracefully shut down the pool (used during process exit).
 */
async function closePool() {
    if (pool) {
        await pool.end();
        pool = null;
        console.log('[db] Connection pool closed');
    }
}
function resolveCoreAsset(relativePath) {
    const candidates = [
        (0, path_1.join)(__dirname, relativePath),
        (0, path_1.join)(__dirname, '..', 'src', relativePath),
    ];
    const found = candidates.find((candidate) => (0, fs_1.existsSync)(candidate));
    if (!found) {
        throw new Error(`Unable to find core asset: ${relativePath}`);
    }
    return found;
}
//# sourceMappingURL=db.js.map