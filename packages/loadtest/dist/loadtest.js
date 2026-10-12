"use strict";
// ---------------------------------------------------------------------------
// Basic load test (throughput benchmark)
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@reliable-queue/core");
async function main() {
    const config = (0, core_1.loadConfig)();
    const pool = (0, core_1.getPool)(config);
    const redis = (0, core_1.getRedis)(config);
    const queue = new core_1.QueueService(pool, redis);
    const DURATION_SEC = 10;
    const BATCH_SIZE = 50;
    console.log(`[loadtest] Starting enqueue benchmark for ${DURATION_SEC}s...`);
    let count = 0;
    const start = Date.now();
    const end = start + (DURATION_SEC * 1000);
    // Run in a tight loop pushing batches
    while (Date.now() < end) {
        const batch = Array.from({ length: BATCH_SIZE }).map((_, i) => queue.enqueue({
            queue_name: 'benchmark',
            payload: { idx: count + i },
        }));
        await Promise.all(batch);
        count += BATCH_SIZE;
    }
    const durationMs = Date.now() - start;
    const rate = (count / (durationMs / 1000)).toFixed(2);
    console.log(`[loadtest] Enqueued ${count} jobs in ${durationMs}ms`);
    console.log(`[loadtest] Rate: ${rate} jobs/sec`);
    await (0, core_1.closeRedis)();
    await (0, core_1.closePool)();
}
main().catch(err => {
    console.error('[loadtest] Error:', err);
    process.exit(1);
});
//# sourceMappingURL=loadtest.js.map