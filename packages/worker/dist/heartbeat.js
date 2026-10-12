"use strict";
// ---------------------------------------------------------------------------
// Worker heartbeat — periodically writes to worker_heartbeats table
// ---------------------------------------------------------------------------
//
// The dashboard uses this table to determine which workers are alive.
// If last_seen_at is older than ~30 seconds, the dashboard marks the
// worker as "dead" (it may have crashed or been scaled down).
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.HeartbeatService = void 0;
class HeartbeatService {
    pool;
    workerId;
    intervalMs;
    getJobsInFlight;
    timer = null;
    constructor(pool, workerId, intervalMs, getJobsInFlight) {
        this.pool = pool;
        this.workerId = workerId;
        this.intervalMs = intervalMs;
        this.getJobsInFlight = getJobsInFlight;
    }
    start() {
        // Send an initial heartbeat immediately
        this.beat();
        this.timer = setInterval(() => {
            this.beat();
        }, this.intervalMs);
        // Don't let the heartbeat timer keep the process alive during shutdown
        if (this.timer.unref) {
            this.timer.unref();
        }
        console.log(`[heartbeat] Started (every ${this.intervalMs}ms)`);
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            console.log('[heartbeat] Stopped');
        }
    }
    async beat() {
        try {
            await this.pool.query(`INSERT INTO worker_heartbeats (worker_id, last_seen_at, jobs_in_flight)
         VALUES ($1, NOW(), $2)
         ON CONFLICT (worker_id)
         DO UPDATE SET last_seen_at = NOW(), jobs_in_flight = $2`, [this.workerId, this.getJobsInFlight()]);
        }
        catch (err) {
            // Non-fatal — if a single heartbeat fails, the next one will retry
            console.error('[heartbeat] Failed to write:', err.message);
        }
    }
}
exports.HeartbeatService = HeartbeatService;
//# sourceMappingURL=heartbeat.js.map