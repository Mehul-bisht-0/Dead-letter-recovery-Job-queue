// ---------------------------------------------------------------------------
// Core barrel export — everything consumers need from @reliable-queue/core
// ---------------------------------------------------------------------------

export { type Job, type DeadLetter, type WorkerHeartbeat, type AuditEntry } from './types';
export { type EnqueueOptions, type EnqueueResult, type JobHandler } from './types';
export { type JobStatus } from './types';
export { type Config, loadConfig } from './config';
export { computeBackoff, computeBackoffBase } from './backoff';
export { getPool, migrate, withTransaction, closePool } from './db';
export { getRedis, closeRedis, queueKey, priorityHashKey, lockKey, REAPER_LEADER_KEY } from './redis';
export { QueueService } from './queue';
