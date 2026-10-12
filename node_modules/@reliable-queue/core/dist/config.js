"use strict";
// ---------------------------------------------------------------------------
// Centralised configuration loaded from environment variables
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = loadConfig;
/**
 * Build a Config from process.env, falling back to sensible defaults.
 * Call once at startup in each service entry-point.
 */
function loadConfig(overrides = {}) {
    const env = process.env;
    return {
        redisUrl: overrides.redisUrl ?? env.REDIS_URL ?? 'redis://localhost:6380',
        databaseUrl: overrides.databaseUrl ?? env.DATABASE_URL ?? 'postgresql://rq_user:rq_password@localhost:5432/reliable_queue',
        queueName: overrides.queueName ?? env.QUEUE_NAME ?? 'default',
        workerId: overrides.workerId ?? env.WORKER_ID ?? `worker-${process.pid}-${Date.now()}`,
        workerConcurrency: overrides.workerConcurrency ?? int(env.WORKER_CONCURRENCY, 5),
        visibilityTimeoutMs: overrides.visibilityTimeoutMs ?? int(env.VISIBILITY_TIMEOUT_MS, 30_000),
        heartbeatIntervalMs: overrides.heartbeatIntervalMs ?? int(env.HEARTBEAT_INTERVAL_MS, 10_000),
        reaperIntervalMs: overrides.reaperIntervalMs ?? int(env.REAPER_INTERVAL_MS, 15_000),
        reaperLockTtlMs: overrides.reaperLockTtlMs ?? int(env.REAPER_LOCK_TTL_MS, 30_000),
        pollIntervalMs: overrides.pollIntervalMs ?? int(env.POLL_INTERVAL_MS, 100),
        backoffBaseMs: overrides.backoffBaseMs ?? int(env.BACKOFF_BASE_MS, 1_000),
        backoffCapMs: overrides.backoffCapMs ?? int(env.BACKOFF_CAP_MS, 60_000),
        host: overrides.host ?? env.HOST ?? '0.0.0.0',
        port: overrides.port ?? int(env.PORT, 3000),
    };
}
/** Parse an env var as an integer, returning `fallback` on failure */
function int(val, fallback) {
    if (val === undefined)
        return fallback;
    const n = parseInt(val, 10);
    return Number.isNaN(n) ? fallback : n;
}
//# sourceMappingURL=config.js.map