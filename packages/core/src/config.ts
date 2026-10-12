// ---------------------------------------------------------------------------
// Centralised configuration loaded from environment variables
// ---------------------------------------------------------------------------

export interface Config {
  /** Redis connection URL, e.g. redis://localhost:6380 */
  redisUrl: string;

  /** PostgreSQL connection URL */
  databaseUrl: string;

  /** Default queue name when none is specified */
  queueName: string;

  /** Unique identifier for this worker instance */
  workerId: string;

  /** How many jobs a single worker processes in parallel */
  workerConcurrency: number;

  /** How long (ms) a claimed job stays locked before the reaper reclaims it */
  visibilityTimeoutMs: number;

  /** Interval (ms) between worker heartbeat writes */
  heartbeatIntervalMs: number;

  /** Interval (ms) between reaper scans for stale jobs */
  reaperIntervalMs: number;

  /** TTL (ms) of the reaper leader lock */
  reaperLockTtlMs: number;

  /** Interval (ms) between worker poll cycles */
  pollIntervalMs: number;

  /** Base delay (ms) for exponential backoff */
  backoffBaseMs: number;

  /** Maximum delay (ms) cap for exponential backoff */
  backoffCapMs: number;

  /** HTTP server host */
  host: string;

  /** HTTP server port */
  port: number;
}

/**
 * Build a Config from process.env, falling back to sensible defaults.
 * Call once at startup in each service entry-point.
 */
export function loadConfig(overrides: Partial<Config> = {}): Config {
  const env = process.env;

  return {
    redisUrl:            overrides.redisUrl            ?? env.REDIS_URL            ?? 'redis://localhost:6380',
    databaseUrl:         overrides.databaseUrl         ?? env.DATABASE_URL         ?? 'postgresql://rq_user:rq_password@localhost:5432/reliable_queue',
    queueName:           overrides.queueName           ?? env.QUEUE_NAME           ?? 'default',
    workerId:            overrides.workerId            ?? env.WORKER_ID            ?? `worker-${process.pid}-${Date.now()}`,
    workerConcurrency:   overrides.workerConcurrency   ?? int(env.WORKER_CONCURRENCY, 5),
    visibilityTimeoutMs: overrides.visibilityTimeoutMs ?? int(env.VISIBILITY_TIMEOUT_MS, 30_000),
    heartbeatIntervalMs: overrides.heartbeatIntervalMs ?? int(env.HEARTBEAT_INTERVAL_MS, 10_000),
    reaperIntervalMs:    overrides.reaperIntervalMs    ?? int(env.REAPER_INTERVAL_MS, 15_000),
    reaperLockTtlMs:     overrides.reaperLockTtlMs     ?? int(env.REAPER_LOCK_TTL_MS, 30_000),
    pollIntervalMs:      overrides.pollIntervalMs      ?? int(env.POLL_INTERVAL_MS, 100),
    backoffBaseMs:       overrides.backoffBaseMs        ?? int(env.BACKOFF_BASE_MS, 1_000),
    backoffCapMs:        overrides.backoffCapMs         ?? int(env.BACKOFF_CAP_MS, 60_000),
    host:                overrides.host                ?? env.HOST                 ?? '0.0.0.0',
    port:                overrides.port                ?? int(env.PORT, 3000),
  };
}

/** Parse an env var as an integer, returning `fallback` on failure */
function int(val: string | undefined, fallback: number): number {
  if (val === undefined) return fallback;
  const n = parseInt(val, 10);
  return Number.isNaN(n) ? fallback : n;
}
