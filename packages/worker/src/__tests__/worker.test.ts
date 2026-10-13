import { describe, it, expect, vi } from 'vitest';
import { loadConfig, Telemetry, delay } from '@reliable-queue/infrastructure';
import { mocks, job, logger } from '../../../../tests/helpers';
import { Worker } from '../worker';
import { Semaphore } from '../semaphore';
describe('Worker lifecycle', () => {
  it('terminates an uncooperative handler after cancellation grace', async () => {
    const state = mocks(),
      telemetry = new Telemetry(),
      record = job({ status: 'processing', attempts: 1 });
    vi.mocked(state.dispatch.take).mockResolvedValueOnce({
      jobId: record.id,
      generation: 1,
      queueName: record.queue_name,
    });
    vi.mocked(state.repository.claim).mockResolvedValueOnce({
      job: record,
      token: 'token',
      attemptId: 'attempt',
    });
    let finish!: () => void;
    const terminate = vi.fn();
    const handler = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    const worker = new Worker(
      state.queue,
      loadConfig({ pollIntervalMs: 1, jobDeadlineMs: 20, cancellationGraceMs: 10 }, {}),
      new Map([['default', handler]]),
      logger,
      telemetry,
      async () => {},
      terminate,
    );
    worker.start();
    await vi.waitFor(() => expect(terminate).toHaveBeenCalledTimes(1));
    finish();
    await worker.stop();
    expect(state.repository.complete).not.toHaveBeenCalled();
    telemetry.registry.clear();
  });
  it('releases each permit at most once', () => {
    const semaphore = new Semaphore(1),
      release = semaphore.tryAcquire()!;
    expect(semaphore.tryAcquire()).toBeNull();
    release();
    release();
    expect(semaphore.active).toBe(0);
  });
  it('releases permits when claiming fails', async () => {
    const state = mocks(),
      telemetry = new Telemetry();
    vi.mocked(state.dispatch.take).mockRejectedValue(new Error('Redis offline'));
    const worker = new Worker(
      state.queue,
      loadConfig({ pollIntervalMs: 1 }, {}),
      new Map([['default', async () => {}]]),
      logger,
      telemetry,
      async () => {},
    );
    worker.start();
    await delay(20);
    await worker.stop();
    expect(worker.active).toBe(0);
    telemetry.registry.clear();
  });
  it('drains before closing dependencies and never nacks acknowledgement failures', async () => {
    const state = mocks(),
      telemetry = new Telemetry();
    const record = job({ status: 'processing', attempts: 1, locked_by: 'worker' });
    vi.mocked(state.dispatch.take).mockResolvedValueOnce({
      jobId: record.id,
      generation: 1,
      queueName: record.queue_name,
    });
    vi.mocked(state.repository.claim).mockResolvedValueOnce({
      job: record,
      token: 'token',
      attemptId: 'attempt',
    });
    vi.mocked(state.repository.complete).mockRejectedValue(new Error('Postgres offline'));
    let finish!: () => void;
    const handler = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const worker = new Worker(
      state.queue,
      loadConfig({ pollIntervalMs: 1 }, {}),
      new Map([['default', handler]]),
      logger,
      telemetry,
      async () => {},
    );
    worker.start();
    await vi.waitFor(() => expect(handler).toHaveBeenCalled());
    let drained = false;
    const stopping = worker.stop().then(() => {
      drained = true;
    });
    await delay(10);
    expect(drained).toBe(false);
    finish();
    await stopping;
    expect(state.repository.fail).not.toHaveBeenCalled();
    expect(worker.active).toBe(0);
    telemetry.registry.clear();
  });
  it('cancels execution after lease loss and suppresses acknowledgements', async () => {
    const state = mocks(),
      telemetry = new Telemetry();
    const record = job({ status: 'processing', attempts: 1 });
    vi.mocked(state.dispatch.take).mockResolvedValueOnce({
      jobId: record.id,
      generation: 1,
      queueName: record.queue_name,
    });
    vi.mocked(state.repository.claim).mockResolvedValueOnce({
      job: record,
      token: 'token',
      attemptId: 'attempt',
    });
    vi.mocked(state.repository.renew).mockResolvedValue(false);
    const handler = vi.fn(async (_job, context) => {
      await delay(10000, undefined, { signal: context.signal });
    });
    const worker = new Worker(
      state.queue,
      loadConfig({ pollIntervalMs: 1 }, {}),
      new Map([['default', handler]]),
      logger,
      telemetry,
      async () => {},
    );
    worker.start();
    await vi.waitFor(() => expect(handler).toHaveBeenCalled());
    await worker.stop();
    expect(state.repository.complete).not.toHaveBeenCalled();
    expect(state.repository.fail).not.toHaveBeenCalled();
    telemetry.registry.clear();
  });
});
