-- ---------------------------------------------------------------------------
-- claim.lua — Atomic job claim script
-- ---------------------------------------------------------------------------
--
-- WHY THIS MUST BE ATOMIC (executed as a single Redis Lua script):
--
-- The claim operation has three steps:
--   1. Find a ready job         (ZRANGEBYSCORE)
--   2. Remove it from the queue (ZREM)
--   3. Acquire a lock on it     (SET NX PX)
--
-- Without atomicity, a classic race condition occurs:
--
--   Time  Worker-A                      Worker-B
--   ────  ──────────────────────────    ──────────────────────────
--   T1    ZRANGEBYSCORE → job-123
--   T2                                  ZRANGEBYSCORE → job-123
--   T3    ZREM job-123 → OK
--   T4                                  ZREM job-123 → 0 (already gone)
--   T5    SET lock:job-123 → OK
--   T6                                  SET lock:job-123 → nil (NX fails)
--
-- Worker-B gets a "nil" lock but has already read job-123 from the sorted set.
-- In a naive implementation, Worker-B might still think it has the job and
-- start processing it, or it might retry and find nothing — either way, the
-- window between ZRANGEBYSCORE and ZREM allows two workers to "see" the
-- same job.
--
-- Redis executes Lua scripts atomically — the server is single-threaded and
-- blocks all other commands while the script runs. This guarantees that the
-- entire read-remove-lock sequence completes without any interleaving from
-- other clients. Only one worker can ever claim a specific job.
--
-- KEYS[1] = sorted set key         e.g. "queue:default"
-- KEYS[2] = lock key prefix        e.g. "queue:lock:"
-- KEYS[3] = priority hash key      e.g. "queue:default:priorities"
--
-- ARGV[1] = current timestamp (epoch ms) — upper bound for ready jobs
-- ARGV[2] = worker_id              — stored as the lock value
-- ARGV[3] = lock timeout (ms)      — the visibility timeout / PX value
--
-- Returns: job_id (string) on success, nil if no claimable job found
-- ---------------------------------------------------------------------------

-- Step 1: Find all jobs whose score (available_at) <= now.
-- We fetch a batch (up to 50) so we can pick the highest-priority one.
local candidates = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, 50)

if #candidates == 0 then
    return nil
end

-- Step 2: Among candidates, find the one with the highest priority.
-- Priority is stored in a Redis hash (KEYS[3]) as job_id → priority.
-- Higher numeric priority = should be processed first.
local best_job = nil
local best_priority = -1

for _, job_id in ipairs(candidates) do
    local raw = redis.call('HGET', KEYS[3], job_id)
    local p = 5 -- default priority if not found in hash
    if raw then
        p = tonumber(raw)
    end
    if p > best_priority then
        best_priority = p
        best_job = job_id
    end
end

if not best_job then
    return nil
end

-- Step 3: Atomically remove from sorted set + acquire distributed lock.
--
-- SET <key> <value> PX <timeout> NX
--   NX = only set if key does NOT exist (distributed lock acquire)
--   PX = auto-expire after <timeout> ms (visibility timeout)
--
-- If the lock already exists (shouldn't happen inside an atomic script,
-- but defense-in-depth), we skip this job. In practice, this branch only
-- triggers if a previous claim's lock hasn't expired yet (e.g., the job
-- was somehow re-added to the sorted set while still being processed).
local lock_key = KEYS[2] .. best_job
local acquired = redis.call('SET', lock_key, ARGV[2], 'PX', tonumber(ARGV[3]), 'NX')

if not acquired then
    -- Lock exists — another worker holds this job (edge case).
    -- Remove from the sorted set anyway to prevent other scripts from
    -- repeatedly trying this stale entry.
    redis.call('ZREM', KEYS[1], best_job)
    return nil
end

-- Lock acquired — remove from the ready queue and priority hash
redis.call('ZREM', KEYS[1], best_job)

return best_job
