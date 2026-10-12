import { describe as vitestDescribe, it, expect, beforeAll, afterAll } from 'vitest';
import { loadConfig, getPool, getRedis, migrate, QueueService, closePool, closeRedis } from '@reliable-queue/core';

const describeIntegration =
  process.env.RUN_INTEGRATION_TESTS === '1' ? vitestDescribe : vitestDescribe.skip;

describeIntegration('Idempotency', () => {
  let queue: QueueService;

  beforeAll(async () => {
    const config = loadConfig();
    await migrate(config);
    queue = new QueueService(getPool(config), getRedis(config));
  });

  afterAll(async () => {
    await closePool();
    await closeRedis();
  });

  it('deduplicates jobs with the same idempotency key', async () => {
    const key = `test-key-${Date.now()}`;
    
    // First enqueue should create
    const res1 = await queue.enqueue({
      queue_name: 'test',
      payload: { a: 1 },
      idempotency_key: key
    });
    
    expect(res1.created).toBe(true);

    // Second enqueue with same key should return the existing job
    const res2 = await queue.enqueue({
      queue_name: 'test',
      payload: { a: 2 }, // Different payload ignored
      idempotency_key: key
    });

    expect(res2.created).toBe(false);
    expect(res2.job.id).toBe(res1.job.id);
  });
});
