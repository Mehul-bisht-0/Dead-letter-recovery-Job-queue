import Redis from 'ioredis';
import { Config } from './config';
/**
 * Get or create the singleton Redis client.
 * ioredis automatically reconnects on transient failures.
 */
export declare function getRedis(config: Config): Redis;
/**
 * Gracefully close the Redis connection.
 */
export declare function closeRedis(): Promise<void>;
/** Sorted set holding job IDs scored by available_at for a queue */
export declare function queueKey(queueName: string): string;
/** Hash mapping job_id → priority for the claim script */
export declare function priorityHashKey(queueName: string): string;
/** Per-job distributed lock key (SET NX PX) */
export declare function lockKey(jobId: string): string;
/** Leader election key for the reaper process */
export declare const REAPER_LEADER_KEY = "reliable-queue:reaper:leader";
