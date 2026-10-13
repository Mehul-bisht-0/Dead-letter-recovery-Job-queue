import type { DispatchIndex, LifecycleRepository, QueryRepository } from './ports';
import type { Claim, EnqueueOptions, JobFilters } from './types';
import { QueueError } from './errors';
import { computeBackoff } from './backoff';
export function validateEnqueue(options: EnqueueOptions): void {
  const {
    queue_name,
    payload,
    priority = 5,
    max_attempts = 3,
    delay_ms = 0,
    idempotency_key,
  } = options;
  if (
    typeof queue_name !== 'string' ||
    !queue_name.trim() ||
    queue_name.length > 255 ||
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    !Number.isInteger(priority) ||
    priority < 1 ||
    priority > 10 ||
    !Number.isInteger(max_attempts) ||
    max_attempts < 1 ||
    max_attempts > 100 ||
    !Number.isInteger(delay_ms) ||
    delay_ms < 0 ||
    delay_ms > 2_592_000_000 ||
    (idempotency_key !== undefined && (!idempotency_key || idempotency_key.length > 255))
  ) {
    throw new QueueError('VALIDATION', 'Invalid enqueue options');
  }
}
export class QueueService {
  constructor(
    private readonly lifecycle: LifecycleRepository,
    private readonly queries: QueryRepository,
    private readonly dispatch: DispatchIndex,
    private readonly retryPolicy = { baseMs: 1_000, capMs: 60_000 },
    private readonly random: () => number = Math.random,
  ) {}
  enqueue(options: EnqueueOptions) {
    validateEnqueue(options);
    return this.lifecycle.enqueue(options);
  }
  async claim(queue: string, worker: string, visibilityMs: number): Promise<Claim | null> {
    for (let i = 0; i < 20; i++) {
      const candidate = await this.dispatch.take(queue);
      if (!candidate) return null;
      const claim = await this.lifecycle.claim(candidate, worker, visibilityMs);
      if (claim) return claim;
    }
    return null;
  }
  renew(claim: Claim, visibilityMs: number) {
    return this.lifecycle.renew(claim, visibilityMs);
  }
  ack(claim: Claim, result?: Record<string, unknown>) {
    return this.lifecycle.complete(claim, result);
  }
  nack(claim: Claim, error: string) {
    return this.lifecycle.fail(
      claim,
      error,
      computeBackoff(
        claim.job.attempts - 1,
        this.retryPolicy.baseMs,
        this.retryPolicy.capMs,
        this.random,
      ),
    );
  }
  getJob(id: string) {
    return this.queries.getJob(id);
  }
  listJobs(filters: JobFilters) {
    return this.queries.listJobs(filters);
  }
  listDeadLetters(limit = 50, offset = 0) {
    return this.queries.listDeadLetters(limit, offset);
  }
  replayFromDLQ(id: string, actor: string) {
    return this.lifecycle.replay(id, actor);
  }
  metrics() {
    return this.queries.metrics();
  }
}
