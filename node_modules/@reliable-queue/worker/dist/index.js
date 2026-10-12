"use strict";
// ---------------------------------------------------------------------------
// Worker entry point — wires everything together and starts processing
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@reliable-queue/core");
const semaphore_1 = require("./semaphore");
const heartbeat_1 = require("./heartbeat");
const reaper_1 = require("./reaper");
const shutdown_1 = require("./shutdown");
const worker_1 = require("./worker");
async function main() {
    const config = (0, core_1.loadConfig)();
    console.log(`[worker] Starting worker ${config.workerId}`);
    console.log(`[worker] Queue: ${config.queueName}, Concurrency: ${config.workerConcurrency}`);
    // --- Infrastructure setup ---
    await (0, core_1.migrate)(config);
    const pool = (0, core_1.getPool)(config);
    const redis = (0, core_1.getRedis)(config);
    const queueService = new core_1.QueueService(pool, redis);
    const semaphore = new semaphore_1.Semaphore(config.workerConcurrency);
    // --- Heartbeat: report liveness to Postgres --------------------------
    const heartbeat = new heartbeat_1.HeartbeatService(pool, config.workerId, config.heartbeatIntervalMs, () => semaphore.active);
    heartbeat.start();
    // --- Reaper: recover stale jobs (leader-elected) ---------------------
    const reaper = new reaper_1.ReaperService(redis, queueService, config.workerId, config.reaperIntervalMs, config.reaperLockTtlMs);
    reaper.start();
    // --- Graceful shutdown -----------------------------------------------
    (0, shutdown_1.installShutdownHandlers)();
    (0, shutdown_1.onShutdown)(async () => {
        console.log('[worker] Waiting for in-flight jobs to complete...');
        // Wait up to 30 seconds for in-flight jobs
        const deadline = Date.now() + 30_000;
        while (semaphore.active > 0 && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 500));
        }
        if (semaphore.active > 0) {
            console.warn(`[worker] Force-exiting with ${semaphore.active} job(s) still in flight`);
        }
    });
    (0, shutdown_1.onShutdown)(async () => {
        heartbeat.stop();
        reaper.stop();
    });
    (0, shutdown_1.onShutdown)(async () => {
        await (0, core_1.closeRedis)();
        await (0, core_1.closePool)();
    });
    // --- Start processing -----------------------------------------------
    await (0, worker_1.startWorkerLoop)(queueService, config, semaphore);
}
main().catch((err) => {
    console.error('[worker] Fatal error:', err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map