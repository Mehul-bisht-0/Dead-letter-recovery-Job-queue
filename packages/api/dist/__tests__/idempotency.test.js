"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@reliable-queue/core");
const describeIntegration = process.env.RUN_INTEGRATION_TESTS === '1' ? vitest_1.describe : vitest_1.describe.skip;
describeIntegration('Idempotency', () => {
    let queue;
    (0, vitest_1.beforeAll)(async () => {
        const config = (0, core_1.loadConfig)();
        await (0, core_1.migrate)(config);
        queue = new core_1.QueueService((0, core_1.getPool)(config), (0, core_1.getRedis)(config));
    });
    (0, vitest_1.afterAll)(async () => {
        await (0, core_1.closePool)();
        await (0, core_1.closeRedis)();
    });
    (0, vitest_1.it)('deduplicates jobs with the same idempotency key', async () => {
        const key = `test-key-${Date.now()}`;
        // First enqueue should create
        const res1 = await queue.enqueue({
            queue_name: 'test',
            payload: { a: 1 },
            idempotency_key: key
        });
        (0, vitest_1.expect)(res1.created).toBe(true);
        // Second enqueue with same key should return the existing job
        const res2 = await queue.enqueue({
            queue_name: 'test',
            payload: { a: 2 }, // Different payload ignored
            idempotency_key: key
        });
        (0, vitest_1.expect)(res2.created).toBe(false);
        (0, vitest_1.expect)(res2.job.id).toBe(res1.job.id);
    });
});
//# sourceMappingURL=idempotency.test.js.map