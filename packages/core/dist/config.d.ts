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
export declare function loadConfig(overrides?: Partial<Config>): Config;
