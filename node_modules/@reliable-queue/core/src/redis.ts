// ---------------------------------------------------------------------------
// Redis client factory
// ---------------------------------------------------------------------------

import Redis from 'ioredis';
import { Config } from './config';

let redis: Redis | null = null;

/**
 * Get or create the singleton Redis client.
 * ioredis automatically reconnects on transient failures.
 */
export function getRedis(config: Config): Redis {
  if (!redis) {
    redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: null,   // infinite retries for blocking commands
      enableReadyCheck: true,
      retryStrategy(times: number) {
        // Exponential backoff capped at 3 s
        return Math.min(times * 200, 3_000);
      },
    });

    redis.on('error', (err) => {
      console.error('[redis] Connection error:', err.message);
    });

    redis.on('connect', () => {
      console.log('[redis] Connected');
    });
  }
  return redis;
}

/**
 * Gracefully close the Redis connection.
 */
export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
    console.log('[redis] Connection closed');
  }
}

// ---------------------------------------------------------------------------
// Redis key helpers — single source of truth for key naming conventions
// ---------------------------------------------------------------------------

/** Sorted set holding job IDs scored by available_at for a queue */
export function queueKey(queueName: string): string {
  return `queue:${queueName}`;
}

/** Hash mapping job_id → priority for the claim script */
export function priorityHashKey(queueName: string): string {
  return `queue:${queueName}:priorities`;
}

/** Per-job distributed lock key (SET NX PX) */
export function lockKey(jobId: string): string {
  return `queue:lock:${jobId}`;
}

/** Leader election key for the reaper process */
export const REAPER_LEADER_KEY = 'reliable-queue:reaper:leader';
