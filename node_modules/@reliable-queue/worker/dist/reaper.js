"use strict";
// ---------------------------------------------------------------------------
// Reaper — reclaims stale jobs from workers that crashed mid-processing
// ---------------------------------------------------------------------------
//
// LEADER ELECTION:
//   If multiple worker instances run the reaper, only ONE should be active
//   at any time. We use a simple leader-election pattern:
//
//     SET reliable-queue:reaper:leader <worker_id> PX <ttl> NX
//
//   NX  → only succeeds if the key doesn't exist (no current leader)
//   PX  → auto-expires after <ttl> ms (in case the leader crashes)
//
//   The leader renews its lock every ttl/3 ms — well before expiry.
//   If the leader dies, the key expires and another instance takes over.
//
// SPLIT-BRAIN RISK:
//   There's a narrow window where the old leader's renewal could race with
//   a new leader's acquisition after TTL expiry. Redis SET NX is atomic,
//   so only one wins. The old leader checks its renewal succeeded and
//   steps down if it lost the lock. This isn't Raft-level consensus, but
//   it's sufficient here because the reaper is idempotent — if two
//   reapers briefly overlap, they both try to requeue the same stale
//   jobs, but the Postgres UPDATE uses a WHERE clause that prevents
//   double-requeuing (status must still be 'processing').
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReaperService = void 0;
const core_1 = require("@reliable-queue/core");
class ReaperService {
    redis;
    queueService;
    workerId;
    intervalMs;
    lockTtlMs;
    timer = null;
    renewTimer = null;
    isLeader = false;
    constructor(redis, queueService, workerId, intervalMs, lockTtlMs) {
        this.redis = redis;
        this.queueService = queueService;
        this.workerId = workerId;
        this.intervalMs = intervalMs;
        this.lockTtlMs = lockTtlMs;
    }
    start() {
        // Try to acquire leadership immediately, then on every interval
        this.tryAcquireLeadership();
        this.timer = setInterval(() => {
            if (this.isLeader) {
                this.reap();
            }
            else {
                this.tryAcquireLeadership();
            }
        }, this.intervalMs);
        if (this.timer.unref) {
            this.timer.unref();
        }
        console.log(`[reaper] Started (interval ${this.intervalMs}ms, TTL ${this.lockTtlMs}ms)`);
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        if (this.renewTimer) {
            clearInterval(this.renewTimer);
            this.renewTimer = null;
        }
        // Release leadership on graceful shutdown
        if (this.isLeader) {
            this.releaseLock().catch(() => { });
        }
        console.log('[reaper] Stopped');
    }
    async tryAcquireLeadership() {
        try {
            // SET key value PX ttl NX — atomic leader election
            const result = await this.redis.set(core_1.REAPER_LEADER_KEY, this.workerId, 'PX', this.lockTtlMs, 'NX');
            if (result === 'OK') {
                this.isLeader = true;
                console.log('[reaper] Acquired leadership');
                this.startRenewal();
                // Immediately do a reap cycle
                this.reap();
            }
        }
        catch (err) {
            console.error('[reaper] Failed to acquire leadership:', err.message);
        }
    }
    /**
     * Renew the leader lock at ttl/3 intervals — well before it expires.
     * If renewal fails (e.g., another process grabbed the lock), step down.
     */
    startRenewal() {
        if (this.renewTimer) {
            clearInterval(this.renewTimer);
        }
        const renewInterval = Math.floor(this.lockTtlMs / 3);
        this.renewTimer = setInterval(async () => {
            try {
                // Only renew if we still own the lock — compare-and-extend
                // Using a Lua script for atomicity: check value, then PEXPIRE
                const renewed = await this.redis.eval(`if redis.call('GET', KEYS[1]) == ARGV[1] then
             return redis.call('PEXPIRE', KEYS[1], ARGV[2])
           else
             return 0
           end`, 1, core_1.REAPER_LEADER_KEY, this.workerId, this.lockTtlMs.toString());
                if (renewed === 0) {
                    // We lost the lock — step down
                    console.log('[reaper] Lost leadership (lock owned by another instance)');
                    this.isLeader = false;
                    clearInterval(this.renewTimer);
                    this.renewTimer = null;
                }
            }
            catch (err) {
                console.error('[reaper] Lock renewal failed:', err.message);
                // Assume we lost leadership to be safe
                this.isLeader = false;
                clearInterval(this.renewTimer);
                this.renewTimer = null;
            }
        }, renewInterval);
        if (this.renewTimer.unref) {
            this.renewTimer.unref();
        }
    }
    async reap() {
        try {
            const count = await this.queueService.requeueStaleJobs();
            if (count > 0) {
                console.log(`[reaper] Recovered ${count} stale job(s)`);
            }
        }
        catch (err) {
            console.error('[reaper] Reap cycle failed:', err.message);
        }
    }
    async releaseLock() {
        // Only delete if we still own it (Lua CAS delete)
        await this.redis.eval(`if redis.call('GET', KEYS[1]) == ARGV[1] then
         return redis.call('DEL', KEYS[1])
       else
         return 0
       end`, 1, core_1.REAPER_LEADER_KEY, this.workerId);
        this.isLeader = false;
    }
}
exports.ReaperService = ReaperService;
//# sourceMappingURL=reaper.js.map