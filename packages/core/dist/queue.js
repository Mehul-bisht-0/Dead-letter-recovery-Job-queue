"use strict";
// ---------------------------------------------------------------------------
// QueueService — the core queue engine used by API (enqueue) and Worker
// (claim, ack, nack). All Redis + Postgres coordination lives here.
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueueService = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
const backoff_1 = require("./backoff");
const redis_1 = require("./redis");
const db_1 = require("./db");
// Load the Lua claim script once at module level
const CLAIM_SCRIPT = (0, fs_1.readFileSync)(resolveCoreAsset((0, path_1.join)('lua', 'claim.lua')), 'utf-8');
class QueueService {
    pool;
    redis;
    constructor(pool, redis) {
        this.pool = pool;
        this.redis = redis;
    }
    // -------------------------------------------------------------------------
    // Enqueue — called by the API to add a new job
    // -------------------------------------------------------------------------
    async enqueue(options) {
        const { queue_name, payload, priority = 5, delay_ms, max_attempts = 3, idempotency_key, } = options;
        return (0, db_1.withTransaction)(this.pool, async (client) => {
            // --- Idempotency check (within transaction) -----------------------
            // We use a Postgres advisory lock keyed on the hash of
            // queue_name + idempotency_key. This serialises concurrent inserts
            // with the same key, preventing the race where two requests both
            // pass the SELECT check and both INSERT.
            if (idempotency_key) {
                await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${queue_name}:${idempotency_key}`]);
                const existing = await client.query(`SELECT * FROM jobs
           WHERE queue_name = $1
             AND idempotency_key = $2
             AND created_at > NOW() - INTERVAL '24 hours'
           ORDER BY created_at DESC
           LIMIT 1`, [queue_name, idempotency_key]);
                if (existing.rows.length > 0) {
                    return { job: mapRow(existing.rows[0]), created: false };
                }
            }
            // --- Insert job into Postgres ------------------------------------
            const available_at = delay_ms
                ? new Date(Date.now() + delay_ms)
                : new Date();
            const result = await client.query(`INSERT INTO jobs
           (queue_name, payload, priority, max_attempts, available_at, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`, [queue_name, JSON.stringify(payload), priority, max_attempts, available_at, idempotency_key]);
            const job = mapRow(result.rows[0]);
            // --- Push into Redis sorted set ----------------------------------
            // Score = available_at epoch ms (used by ZRANGEBYSCORE in claim.lua)
            await this.redis.zadd((0, redis_1.queueKey)(queue_name), available_at.getTime().toString(), job.id);
            // Store priority in a hash so the Lua script can pick the
            // highest-priority candidate from the ready batch.
            await this.redis.hset((0, redis_1.priorityHashKey)(queue_name), job.id, priority.toString());
            return { job, created: true };
        });
    }
    // -------------------------------------------------------------------------
    // Claim — called by the worker to atomically acquire the next job
    // -------------------------------------------------------------------------
    async claim(queueName, workerId, visibilityTimeoutMs) {
        const now = Date.now();
        // Execute the atomic Lua claim script
        const jobId = await this.redis.eval(CLAIM_SCRIPT, 3, // number of KEYS
        (0, redis_1.queueKey)(queueName), // KEYS[1]
        'queue:lock:', // KEYS[2] — lock prefix
        (0, redis_1.priorityHashKey)(queueName), // KEYS[3]
        now.toString(), // ARGV[1] — current time
        workerId, // ARGV[2]
        visibilityTimeoutMs.toString());
        if (!jobId)
            return null;
        // Update Postgres: mark the job as processing
        const lockedUntil = new Date(now + visibilityTimeoutMs);
        const result = await this.pool.query(`UPDATE jobs
       SET status = 'processing',
           locked_by = $1,
           locked_until = $2,
           attempts = attempts + 1,
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`, [workerId, lockedUntil, jobId]);
        if (result.rows.length === 0) {
            // Job vanished from Postgres (shouldn't happen, but be defensive)
            await this.redis.del((0, redis_1.lockKey)(jobId));
            return null;
        }
        return mapRow(result.rows[0]);
    }
    // -------------------------------------------------------------------------
    // Ack — mark a job as completed (called after successful processing)
    // -------------------------------------------------------------------------
    async ack(jobId, resultData) {
        await this.pool.query(`UPDATE jobs
       SET status = 'completed',
           result = $1,
           locked_by = NULL,
           locked_until = NULL,
           updated_at = NOW()
       WHERE id = $2`, [resultData ? JSON.stringify(resultData) : null, jobId]);
        // Release the Redis lock and clean up priority hash entry
        const job = await this.getJob(jobId);
        await this.redis.del((0, redis_1.lockKey)(jobId));
        if (job) {
            await this.redis.hdel((0, redis_1.priorityHashKey)(job.queue_name), jobId);
        }
    }
    // -------------------------------------------------------------------------
    // Nack — handle a failed job: retry with backoff or move to DLQ
    // -------------------------------------------------------------------------
    async nack(jobId, errorMessage, backoffBaseMs = 1_000, backoffCapMs = 60_000) {
        const jobResult = await this.pool.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
        if (jobResult.rows.length === 0) {
            await this.redis.del((0, redis_1.lockKey)(jobId));
            return 'dead-lettered';
        }
        const job = mapRow(jobResult.rows[0]);
        if (job.attempts < job.max_attempts) {
            // ---- Retry with exponential backoff + jitter --------------------
            const delay = (0, backoff_1.computeBackoff)(job.attempts - 1, backoffBaseMs, backoffCapMs);
            const nextAvailableAt = new Date(Date.now() + delay);
            await this.pool.query(`UPDATE jobs
         SET status = 'pending',
             error = $1,
             available_at = $2,
             locked_by = NULL,
             locked_until = NULL,
             updated_at = NOW()
         WHERE id = $3`, [errorMessage, nextAvailableAt, jobId]);
            // Push back into Redis sorted set with new score
            await this.redis.zadd((0, redis_1.queueKey)(job.queue_name), nextAvailableAt.getTime().toString(), jobId);
            // Release the lock
            await this.redis.del((0, redis_1.lockKey)(jobId));
            return 'retried';
        }
        else {
            // ---- Move to Dead Letter Queue ---------------------------------
            return this.moveToDLQ(job, errorMessage);
        }
    }
    // -------------------------------------------------------------------------
    // Move to DLQ — job has exhausted all retry attempts
    // -------------------------------------------------------------------------
    async moveToDLQ(job, errorMessage) {
        // Build failure history from all previous errors
        const historyResult = await this.pool.query(`SELECT error, updated_at FROM jobs WHERE id = $1`, [job.id]);
        const failureHistory = [{
                attempt: job.attempts,
                error: errorMessage,
                failed_at: new Date().toISOString(),
            }];
        await (0, db_1.withTransaction)(this.pool, async (client) => {
            // Insert dead letter record
            await client.query(`INSERT INTO dead_letters
           (original_job_id, queue_name, payload, failure_reason, failure_history)
         VALUES ($1, $2, $3, $4, $5)`, [
                job.id,
                job.queue_name,
                JSON.stringify(job.payload),
                errorMessage,
                JSON.stringify(failureHistory),
            ]);
            // Mark the job as dead
            await client.query(`UPDATE jobs
         SET status = 'dead',
             error = $1,
             locked_by = NULL,
             locked_until = NULL,
             updated_at = NOW()
         WHERE id = $2`, [errorMessage, job.id]);
            // Log to audit trail
            await client.query(`INSERT INTO audit_log (action, entity_type, entity_id, details)
         VALUES ('moved_to_dlq', 'job', $1, $2)`, [job.id, JSON.stringify({ reason: errorMessage, attempts: job.attempts })]);
        });
        // Clean up Redis
        await this.redis.del((0, redis_1.lockKey)(job.id));
        await this.redis.hdel((0, redis_1.priorityHashKey)(job.queue_name), job.id);
        return 'dead-lettered';
    }
    // -------------------------------------------------------------------------
    // Replay from DLQ — re-enqueue a dead-lettered job
    // -------------------------------------------------------------------------
    async replayFromDLQ(dlqId) {
        const dlqResult = await this.pool.query('SELECT * FROM dead_letters WHERE id = $1', [dlqId]);
        if (dlqResult.rows.length === 0) {
            throw new Error(`Dead letter entry ${dlqId} not found`);
        }
        const dlq = dlqResult.rows[0];
        return (0, db_1.withTransaction)(this.pool, async (client) => {
            // Reset the original job
            const jobResult = await client.query(`UPDATE jobs
         SET status = 'pending',
             attempts = 0,
             error = NULL,
             locked_by = NULL,
             locked_until = NULL,
             available_at = NOW(),
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`, [dlq.original_job_id]);
            if (jobResult.rows.length === 0) {
                throw new Error(`Original job ${dlq.original_job_id} not found`);
            }
            const job = mapRow(jobResult.rows[0]);
            // Remove the dead letter entry
            await client.query('DELETE FROM dead_letters WHERE id = $1', [dlqId]);
            // Log the replay in audit trail
            await client.query(`INSERT INTO audit_log (action, entity_type, entity_id, details)
         VALUES ('dlq_replay', 'dead_letter', $1, $2)`, [dlqId, JSON.stringify({ original_job_id: dlq.original_job_id, queue_name: dlq.queue_name })]);
            // Re-enqueue into Redis
            await this.redis.zadd((0, redis_1.queueKey)(job.queue_name), Date.now().toString(), job.id);
            await this.redis.hset((0, redis_1.priorityHashKey)(job.queue_name), job.id, job.priority.toString());
            return job;
        });
    }
    // -------------------------------------------------------------------------
    // Requeue stale jobs — called by the reaper for crash recovery
    // -------------------------------------------------------------------------
    async requeueStaleJobs() {
        // Find jobs stuck in "processing" whose lock has expired
        const staleResult = await this.pool.query(`SELECT * FROM jobs
       WHERE status = 'processing'
         AND locked_until < NOW()`);
        let requeued = 0;
        for (const row of staleResult.rows) {
            const job = mapRow(row);
            await this.pool.query(`UPDATE jobs
         SET status = 'pending',
             locked_by = NULL,
             locked_until = NULL,
             available_at = NOW(),
             updated_at = NOW()
         WHERE id = $1 AND status = 'processing'`, [job.id]);
            // Re-add to Redis sorted set
            await this.redis.zadd((0, redis_1.queueKey)(job.queue_name), Date.now().toString(), job.id);
            // Ensure priority is in the hash
            await this.redis.hset((0, redis_1.priorityHashKey)(job.queue_name), job.id, job.priority.toString());
            // Clean up the expired lock key (if it still exists)
            await this.redis.del((0, redis_1.lockKey)(job.id));
            requeued++;
        }
        if (requeued > 0) {
            console.log(`[reaper] Requeued ${requeued} stale job(s)`);
        }
        return requeued;
    }
    // -------------------------------------------------------------------------
    // Query helpers
    // -------------------------------------------------------------------------
    async getJob(jobId) {
        const result = await this.pool.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
        return result.rows.length > 0 ? mapRow(result.rows[0]) : null;
    }
    async listJobs(filters) {
        const conditions = [];
        const params = [];
        let paramIdx = 1;
        if (filters.queue_name) {
            conditions.push(`queue_name = $${paramIdx++}`);
            params.push(filters.queue_name);
        }
        if (filters.status) {
            conditions.push(`status = $${paramIdx++}`);
            params.push(filters.status);
        }
        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const limit = filters.limit ?? 50;
        const offset = filters.offset ?? 0;
        const [dataResult, countResult] = await Promise.all([
            this.pool.query(`SELECT * FROM jobs ${where} ORDER BY created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`, [...params, limit, offset]),
            this.pool.query(`SELECT COUNT(*)::int AS total FROM jobs ${where}`, params),
        ]);
        return {
            jobs: dataResult.rows.map(mapRow),
            total: countResult.rows[0].total,
        };
    }
    async listDeadLetters(limit = 50, offset = 0) {
        const [dataResult, countResult] = await Promise.all([
            this.pool.query('SELECT * FROM dead_letters ORDER BY moved_at DESC LIMIT $1 OFFSET $2', [limit, offset]),
            this.pool.query('SELECT COUNT(*)::int AS total FROM dead_letters'),
        ]);
        return {
            items: dataResult.rows.map(mapDLQ),
            total: countResult.rows[0].total,
        };
    }
    /** Get the depth (number of entries) in a Redis queue sorted set */
    async getQueueDepth(queueName) {
        return this.redis.zcard((0, redis_1.queueKey)(queueName));
    }
}
exports.QueueService = QueueService;
// ---------------------------------------------------------------------------
// Row mapping helpers
// ---------------------------------------------------------------------------
function mapRow(row) {
    return {
        id: row.id,
        queue_name: row.queue_name,
        payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
        status: row.status,
        priority: row.priority,
        attempts: row.attempts,
        max_attempts: row.max_attempts,
        created_at: new Date(row.created_at),
        updated_at: new Date(row.updated_at),
        available_at: new Date(row.available_at),
        locked_by: row.locked_by,
        locked_until: row.locked_until ? new Date(row.locked_until) : null,
        idempotency_key: row.idempotency_key,
        result: row.result,
        error: row.error,
    };
}
function mapDLQ(row) {
    return {
        id: row.id,
        original_job_id: row.original_job_id,
        queue_name: row.queue_name,
        payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
        failure_reason: row.failure_reason,
        failure_history: typeof row.failure_history === 'string'
            ? JSON.parse(row.failure_history)
            : row.failure_history,
        moved_at: new Date(row.moved_at),
    };
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
//# sourceMappingURL=queue.js.map