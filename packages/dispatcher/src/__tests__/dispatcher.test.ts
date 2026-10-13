import { describe, it, expect, vi } from 'vitest';
import { loadConfig } from '@reliable-queue/infrastructure';
import type { MaintenanceRepository, OutboxEntry } from '@reliable-queue/core';
import { mocks, job, logger } from '../../../../tests/helpers';
import { Dispatcher } from '../dispatcher';
describe('Recoverable dispatcher', () => {
  it('retries failed publications and still reconciles missing hints', async () => {
    const state = mocks(),
      record = job();
    const entry: OutboxEntry = {
      id: 'outbox',
      reservation_token: 'reservation',
      job_id: record.id,
      queue_name: record.queue_name,
      generation: 1,
      priority: 5,
      available_at: record.available_at,
      publish_attempts: 1,
    };
    const repository: MaintenanceRepository = {
      recoverExpired: vi.fn(async () => 0),
      reserveOutbox: vi.fn(async () => [entry]),
      finishOutbox: vi.fn(async () => {}),
      retryOutbox: vi.fn(async () => {}),
      pendingPage: vi.fn(async () => [record]),
      heartbeat: vi.fn(async () => {}),
    };
    vi.mocked(state.dispatch.publish).mockRejectedValueOnce(new Error('offline'));
    const dispatcher = new Dispatcher(repository, state.dispatch, loadConfig({}, {}), logger);
    await dispatcher.tick();
    expect(repository.retryOutbox).toHaveBeenCalledWith(
      entry,
      expect.any(Number),
      expect.stringContaining('offline'),
    );
    expect(repository.finishOutbox).not.toHaveBeenCalled();
    expect(state.dispatch.publish).toHaveBeenCalledTimes(2);
  });
});
