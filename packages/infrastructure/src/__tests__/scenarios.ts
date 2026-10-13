import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { QueueService, type DispatchIndex } from '@reliable-queue/core';
import { PostgresJobs } from '../jobs';
import { AuthStore } from '../auth';
interface State {
  pool: Pool;
  jobs: PostgresJobs;
  index: DispatchIndex;
  queue: QueueService;
}
export function databaseScenarios(get: () => State) {
  const publish = async () => {
    const state = get();
    for (const job of await state.jobs.pendingPage(null, 100)) await state.index.publish(job);
  };
  it('deduplicates concurrent requests and preserves the original payload', async () => {
    const { queue, pool } = get();
    const queue_name = randomUUID();
    const idempotency_key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, n) =>
        queue.enqueue({ queue_name, payload: { n }, idempotency_key }),
      ),
    );
    expect(new Set(results.map((r) => r.job.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    const existing = await queue.enqueue({
      queue_name,
      payload: { changed: true },
      idempotency_key,
    });
    expect(existing.job.payload).toEqual(results[0].job.payload);
    await pool.query(
      "UPDATE jobs SET created_at=clock_timestamp()-INTERVAL '25 hours' WHERE id=$1",
      [existing.job.id],
    );
    expect((await queue.enqueue({ queue_name, payload: {}, idempotency_key })).created).toBe(true);
  });
  it('claims once under concurrency and refuses delayed or wrong-generation candidates', async () => {
    const { queue, jobs, pool } = get();
    const queue_name = randomUUID();
    const { job } = await queue.enqueue({ queue_name, payload: {} });
    expect(
      await jobs.claim({ jobId: job.id, generation: 99, queueName: queue_name }, 'invalid', 30000),
    ).toBeNull();
    const delayed = await queue.enqueue({ queue_name, payload: {}, delay_ms: 10000 });
    expect(
      await jobs.claim(
        { jobId: delayed.job.id, generation: 1, queueName: queue_name },
        'early',
        30000,
      ),
    ).toBeNull();
    const claims = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        jobs.claim({ jobId: job.id, generation: 1, queueName: queue_name }, `worker-${i}`, 30000),
      ),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(
      (await pool.query('SELECT * FROM job_attempts WHERE job_id=$1', [job.id])).rows,
    ).toHaveLength(1);
  });
  it('recovers expired leases once and rejects stale completion, failure and renewal', async () => {
    const { queue, jobs, pool } = get();
    const queue_name = randomUUID();
    const { job } = await queue.enqueue({ queue_name, payload: {} });
    const old = (await jobs.claim(
      { jobId: job.id, generation: 1, queueName: queue_name },
      'old',
      30000,
    ))!;
    await pool.query(
      "UPDATE jobs SET locked_until=clock_timestamp()-INTERVAL '1 second' WHERE id=$1",
      [job.id],
    );
    expect(await jobs.renew(old, 30000)).toBe(false);
    const recovered = await Promise.all([jobs.recoverExpired(100), jobs.recoverExpired(100)]);
    expect(recovered.reduce((a, b) => a + b, 0)).toBe(1);
    await pool.query('UPDATE jobs SET available_at=clock_timestamp() WHERE id=$1', [job.id]);
    await publish();
    const next = (await queue.claim(queue_name, 'new', 30000))!;
    expect(next).not.toBeNull();
    expect(next.token).not.toBe(old.token);
    await expect(jobs.complete(old, { old: true })).rejects.toMatchObject({ code: 'LEASE_LOST' });
    await expect(jobs.fail(old, 'late failure', 0)).rejects.toMatchObject({ code: 'LEASE_LOST' });
    await jobs.complete(next, { done: true });
    expect((await jobs.getJob(job.id))?.result).toEqual({ done: true });
  });
  it('counts every failure, dead-letters once, and replays only once without losing history', async () => {
    const { queue, jobs, pool } = get();
    const queue_name = randomUUID();
    const { job } = await queue.enqueue({ queue_name, payload: {}, max_attempts: 2 });
    const first = (await jobs.claim(
      { jobId: job.id, generation: 1, queueName: queue_name },
      'worker',
      30000,
    ))!;
    expect(await jobs.fail(first, 'first failure', 0)).toBe('retried');
    await publish();
    const second = (await queue.claim(queue_name, 'worker', 30000))!;
    expect(second.job.attempts).toBe(2);
    expect(await jobs.fail(second, 'second failure', 0)).toBe('dead-lettered');
    await expect(jobs.fail(second, 'duplicate failure', 0)).rejects.toMatchObject({
      code: 'LEASE_LOST',
    });
    const entry = (await jobs.listDeadLetters()).items.find((d) => d.original_job_id === job.id)!;
    expect(entry.failure_history).toHaveLength(2);
    const replays = await Promise.allSettled([
      jobs.replay(entry.id, 'admin'),
      jobs.replay(entry.id, 'admin'),
    ]);
    expect(replays.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const replayed = await jobs.getJob(job.id);
    expect(replayed).toMatchObject({
      attempts: 0,
      execution_cycle: 2,
      status: 'pending',
      result: null,
      error: null,
    });
    expect(
      (await pool.query('SELECT * FROM job_attempts WHERE job_id=$1', [job.id])).rows,
    ).toHaveLength(2);
    expect(
      (await pool.query('SELECT active FROM dead_letters WHERE id=$1', [entry.id])).rows[0].active,
    ).toBe(false);
    await publish();
    const third = (await queue.claim(queue_name, 'worker', 30000))!;
    await jobs.complete(third);
    await expect(jobs.complete(third)).rejects.toMatchObject({ code: 'LEASE_LOST' });
  });
  it('rolls back job and audit writes when outbox insertion fails', async () => {
    const { queue, pool } = get();
    const queue_name = randomUUID();
    await pool.query(
      "CREATE FUNCTION reject_test_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected outbox failure'; END $$",
    );
    await pool.query(
      'CREATE TRIGGER test_outbox BEFORE INSERT ON dispatch_outbox FOR EACH ROW EXECUTE FUNCTION reject_test_outbox()',
    );
    try {
      await expect(queue.enqueue({ queue_name, payload: {} })).rejects.toThrow(
        'injected outbox failure',
      );
      expect(
        (await pool.query('SELECT * FROM jobs WHERE queue_name=$1', [queue_name])).rows,
      ).toHaveLength(0);
    } finally {
      await pool.query('DROP TRIGGER test_outbox ON dispatch_outbox');
      await pool.query('DROP FUNCTION reject_test_outbox()');
    }
  });
  it('retries outbox failures and reclaims abandoned publication reservations', async () => {
    const { queue, jobs, pool } = get();
    await queue.enqueue({ queue_name: randomUUID(), payload: {} });
    const entries = await jobs.reserveOutbox(100, 30000);
    const entry = entries[0];
    expect(entry).toBeDefined();
    await jobs.retryOutbox(entry, 0, 'Redis offline');
    const retry = (await jobs.reserveOutbox(100, 30000)).find((e) => e.id === entry.id)!;
    expect(retry.reservation_token).not.toBe(entry.reservation_token);
    await jobs.finishOutbox(entry);
    expect(
      (await pool.query('SELECT published_at FROM dispatch_outbox WHERE id=$1', [entry.id])).rows[0]
        .published_at,
    ).toBeNull();
    await pool.query(
      "UPDATE dispatch_outbox SET reserved_until=clock_timestamp()-INTERVAL '1 second' WHERE id=$1",
      [entry.id],
    );
    const reclaimed = (await jobs.reserveOutbox(100, 30000)).find((e) => e.id === entry.id)!;
    expect(reclaimed).toBeDefined();
    await jobs.finishOutbox(reclaimed);
    expect(
      (await pool.query('SELECT published_at FROM dispatch_outbox WHERE id=$1', [entry.id])).rows[0]
        .published_at,
    ).not.toBeNull();
  });
  it('provisions, rotates, revokes keys and expires administrator sessions', async () => {
    const { pool } = get();
    const auth = new AuthStore(pool);
    const key = await auth.provision('producer', 'producer', ['default']);
    expect((await auth.authenticate(`Bearer ${key.token}`)).queues).toEqual(['default']);
    const replacement = await auth.provision('producer2', 'producer', ['default'], key.id);
    await expect(auth.authenticate(`Bearer ${key.token}`)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    await auth.revoke(replacement.id);
    await expect(auth.authenticate(`Bearer ${replacement.token}`)).rejects.toThrow();
    const session = await auth.createSession();
    expect(await auth.session(session.token, session.csrf)).toBe(true);
    expect(await auth.session(session.token, 'a'.repeat(64))).toBe(false);
    await pool.query("UPDATE admin_sessions SET expires_at=clock_timestamp()-INTERVAL '1 second'");
    expect(await auth.session(session.token)).toBe(false);
  });
}
