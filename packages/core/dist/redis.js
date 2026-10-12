"use strict";
// ---------------------------------------------------------------------------
// Redis client factory
// ---------------------------------------------------------------------------
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.REAPER_LEADER_KEY = void 0;
exports.getRedis = getRedis;
exports.closeRedis = closeRedis;
exports.queueKey = queueKey;
exports.priorityHashKey = priorityHashKey;
exports.lockKey = lockKey;
const ioredis_1 = __importDefault(require("ioredis"));
let redis = null;
/**
 * Get or create the singleton Redis client.
 * ioredis automatically reconnects on transient failures.
 */
function getRedis(config) {
    if (!redis) {
        redis = new ioredis_1.default(config.redisUrl, {
            maxRetriesPerRequest: null, // infinite retries for blocking commands
            enableReadyCheck: true,
            retryStrategy(times) {
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
async function closeRedis() {
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
function queueKey(queueName) {
    return `queue:${queueName}`;
}
/** Hash mapping job_id → priority for the claim script */
function priorityHashKey(queueName) {
    return `queue:${queueName}:priorities`;
}
/** Per-job distributed lock key (SET NX PX) */
function lockKey(jobId) {
    return `queue:lock:${jobId}`;
}
/** Leader election key for the reaper process */
exports.REAPER_LEADER_KEY = 'reliable-queue:reaper:leader';
//# sourceMappingURL=redis.js.map