"use strict";
// ---------------------------------------------------------------------------
// Seed script to populate the queue for testing
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@reliable-queue/core");
async function main() {
    const config = (0, core_1.loadConfig)();
    await (0, core_1.migrate)(config);
    const pool = (0, core_1.getPool)(config);
    const redis = (0, core_1.getRedis)(config);
    const queueService = new core_1.QueueService(pool, redis);
    console.log('[seed] Enqueueing sample jobs...');
    const promises = [];
    // 1. 80 normal jobs (will succeed)
    for (let i = 0; i < 80; i++) {
        promises.push(queueService.enqueue({
            queue_name: config.queueName,
            payload: { type: 'email', to: `user${i}@example.com` },
            priority: Math.floor(Math.random() * 10) + 1 // random priority 1-10
        }));
    }
    // 2. 15 jobs designed to fail temporarily (to test retries)
    // Our simulated worker will throw an error if `payload.fail` is true.
    // In a real scenario, this would be a flaky downstream API.
    for (let i = 0; i < 15; i++) {
        promises.push(queueService.enqueue({
            queue_name: config.queueName,
            payload: { type: 'webhook', fail: true, failReason: 'Connection timeout' },
            max_attempts: 3 // Will retry 2 times before DLQ
        }));
    }
    // 3. 5 jobs designed to always fail (to quickly populate DLQ)
    for (let i = 0; i < 5; i++) {
        promises.push(queueService.enqueue({
            queue_name: config.queueName,
            payload: { type: 'payment', fail: true, failReason: 'Invalid card format' },
            max_attempts: 1 // No retries, goes straight to DLQ
        }));
    }
    // 4. Test idempotency (should only create 1 job)
    promises.push(queueService.enqueue({
        queue_name: config.queueName,
        payload: { type: 'dedup_test' },
        idempotency_key: 'seed-idempotency-key'
    }));
    promises.push(queueService.enqueue({
        queue_name: config.queueName,
        payload: { type: 'dedup_test' },
        idempotency_key: 'seed-idempotency-key'
    }));
    await Promise.all(promises);
    console.log(`[seed] Enqueued 101 jobs successfully.`);
    await (0, core_1.closeRedis)();
    await (0, core_1.closePool)();
}
main().catch((err) => {
    console.error('[seed] Fatal error:', err);
    process.exit(1);
});
//# sourceMappingURL=seed.js.map