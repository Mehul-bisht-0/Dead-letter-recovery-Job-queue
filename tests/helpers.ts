import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import {
  QueueService,
  type StoredJob,
  type LifecycleRepository,
  type QueryRepository,
  type DispatchIndex,
  type Logger,
} from '@reliable-queue/core';
export function job(overrides: Partial<StoredJob> = {}): StoredJob {
  return {
    id: randomUUID(),
    queue_name: 'default',
    payload: { hello: 'world' },
    status: 'pending',
    priority: 5,
    attempts: 0,
    max_attempts: 3,
    created_at: new Date(),
    updated_at: new Date(),
    available_at: new Date(),
    locked_by: null,
    locked_until: null,
    idempotency_key: null,
    result: null,
    error: null,
    scheduling_generation: 1,
    execution_cycle: 1,
    lease_token: null,
    history_complete: true,
    ...overrides,
  };
}
export const logger: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
export function mocks(record = job()) {
  const repository: LifecycleRepository & QueryRepository = {
    enqueue: vi.fn(async () => ({ job: record, created: true })),
    claim: vi.fn(async () => null),
    renew: vi.fn(async () => true),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => 'retried' as const),
    replay: vi.fn(async () => record),
    getJob: vi.fn(async () => record),
    listJobs: vi.fn(async () => ({ jobs: [record], total: 1 })),
    listDeadLetters: vi.fn(async () => ({ items: [], total: 0 })),
    metrics: vi.fn(async () => ({
      timestamp: new Date().toISOString(),
      queueDepth: 0,
      jobsPerSecond: '0.00',
      dlqSize: 0,
      retryRate: '0.0%',
      retries: 0,
      ready: 0,
      delayed: 0,
      processing: 0,
      dead: 0,
      dispatchLagSeconds: 0,
      queues: [],
      workers: [],
    })),
  };
  const dispatch: DispatchIndex = {
    publish: vi.fn(async () => {}),
    take: vi.fn(async () => null),
    ping: vi.fn(async () => {}),
  };
  return { repository, dispatch, queue: new QueueService(repository, repository, dispatch) };
}
