"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@reliable-queue/core");
const describeIntegration = process.env.RUN_INTEGRATION_TESTS === '1' ? vitest_1.describe : vitest_1.describe.skip;
describeIntegration('Claim Atomicity & DLQ', () => {
    let queue;
    let redis;
    (0, vitest_1.beforeAll)(async () => {
        const config = (0, core_1.loadConfig)();
        await (0, core_1.migrate)(config);
        redis = (0, core_1.getRedis)(config);
        queue = new core_1.QueueService((0, core_1.getPool)(config), redis);
    });
    (0, vitest_1.afterAll)(async () => {
        await (0, core_1.closePool)();
        await (0, core_1.closeRedis)();
    });
    (0, vitest_1.it)('claims jobs atomically', async () => {
        const res = await queue.enqueue({
            queue_name: 'test-claim',
            payload: { test: 1 }
        });
        const job = await queue.claim('test-claim', 'worker-1', 10000);
        (0, vitest_1.expect)(job).not.toBeNull();
        (0, vitest_1.expect)(job?.id).toBe(res.job.id);
        (0, vitest_1.expect)(job?.status).toBe('processing');
        // Redis should have the lock set
        const lock = await redis.get((0, core_1.lockKey)(job.id));
        (0, vitest_1.expect)(lock).toBe('worker-1');
        // Second claim should return nothing (job is locked)
        const job2 = await queue.claim('test-claim', 'worker-2', 10000);
        (0, vitest_1.expect)(job2).toBeNull();
    });
    (0, vitest_1.it)('moves to DLQ after max attempts', async () => {
        const res = await queue.enqueue({
            queue_name: 'test-dlq',
            payload: { fail: true },
            max_attempts: 1
        });
        const job = await queue.claim('test-dlq', 'worker-1', 10000);
        (0, vitest_1.expect)(job).not.toBeNull();
        // Nack the job — it should go straight to DLQ because max_attempts is 1
        const outcome = await queue.nack(job.id, 'Simulated failure');
        (0, vitest_1.expect)(outcome).toBe('dead-lettered');
        // Check Postgres
        const deadJob = await queue.getJob(job.id);
        (0, vitest_1.expect)(deadJob?.status).toBe('dead');
        const dlq = await queue.listDeadLetters(10, 0);
        (0, vitest_1.expect)(dlq.total).toBeGreaterThanOrEqual(1);
        const entry = dlq.items.find(i => i.original_job_id === job.id);
        (0, vitest_1.expect)(entry).toBeDefined();
        (0, vitest_1.expect)(entry?.failure_reason).toBe('Simulated failure');
    });
});
//# sourceMappingURL=claim.test.js.map