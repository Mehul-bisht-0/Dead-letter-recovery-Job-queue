import { describe as vitestDescribe, it, expect, beforeAll, afterAll } from 'vitest';
import { loadConfig, getPool, getRedis, migrate, QueueService, closePool, closeRedis, lockKey } from '@reliable-queue/core';

const describeIntegration =
  process.env.RUN_INTEGRATION_TESTS === '1' ? vitestDescribe : vitestDescribe.skip;

describeIntegration('Claim Atomicity & DLQ', () => {
  let queue: QueueService;
  let redis: any;

  beforeAll(async () => {
    const config = loadConfig();
    await migrate(config);
    redis = getRedis(config);
    queue = new QueueService(getPool(config), redis);
  });

  afterAll(async () => {
    await closePool();
    await closeRedis();
  });

  it('claims jobs atomically', async () => {
    const res = await queue.enqueue({
      queue_name: 'test-claim',
      payload: { test: 1 }
    });

    const job = await queue.claim('test-claim', 'worker-1', 10000);
    expect(job).not.toBeNull();
    expect(job?.id).toBe(res.job.id);
    expect(job?.status).toBe('processing');
    
    // Redis should have the lock set
    const lock = await redis.get(lockKey(job!.id));
    expect(lock).toBe('worker-1');

    // Second claim should return nothing (job is locked)
    const job2 = await queue.claim('test-claim', 'worker-2', 10000);
    expect(job2).toBeNull();
  });

  it('moves to DLQ after max attempts', async () => {
    const res = await queue.enqueue({
      queue_name: 'test-dlq',
      payload: { fail: true },
      max_attempts: 1
    });

    const job = await queue.claim('test-dlq', 'worker-1', 10000);
    expect(job).not.toBeNull();

    // Nack the job — it should go straight to DLQ because max_attempts is 1
    const outcome = await queue.nack(job!.id, 'Simulated failure');
    expect(outcome).toBe('dead-lettered');

    // Check Postgres
    const deadJob = await queue.getJob(job!.id);
    expect(deadJob?.status).toBe('dead');

    const dlq = await queue.listDeadLetters(10, 0);
    expect(dlq.total).toBeGreaterThanOrEqual(1);
    const entry = dlq.items.find(i => i.original_job_id === job!.id);
    expect(entry).toBeDefined();
    expect(entry?.failure_reason).toBe('Simulated failure');
  });
});
