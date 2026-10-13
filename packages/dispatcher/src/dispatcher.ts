import {
  computeBackoff,
  type MaintenanceRepository,
  type DispatchIndex,
  type Logger,
} from '@reliable-queue/core';
import { repeat, type Config } from '@reliable-queue/infrastructure';
export class Dispatcher {
  private readonly controller = new AbortController();
  private loop: Promise<void> | null = null;
  private cursor: string | null = null;
  private nextReconciliation = 0;
  constructor(
    private readonly repository: MaintenanceRepository,
    private readonly index: DispatchIndex,
    private readonly config: Config,
    private readonly logger: Logger,
  ) {}
  get ready() {
    return !this.controller.signal.aborted;
  }
  start() {
    if (this.loop) throw new Error('Dispatcher already started');
    this.loop = repeat(
      this.config.dispatcherIntervalMs,
      () => this.tick(),
      this.controller.signal,
      this.logger,
    );
  }
  async tick() {
    await this.repository.recoverExpired(this.config.batchSize);
    const entries = await this.repository.reserveOutbox(this.config.batchSize, 30000);
    for (const entry of entries) {
      if (this.controller.signal.aborted) break;
      try {
        await this.index.publish({
          id: entry.job_id,
          queue_name: entry.queue_name,
          priority: entry.priority,
          available_at: entry.available_at,
          scheduling_generation: entry.generation,
        });
        await this.repository.finishOutbox(entry);
      } catch (error) {
        await this.repository.retryOutbox(
          entry,
          computeBackoff(entry.publish_attempts - 1),
          String(error),
        );
        this.logger.warn({ err: error, outboxId: entry.id }, 'Dispatch publication deferred');
      }
    }
    if (Date.now() >= this.nextReconciliation) {
      const jobs = await this.repository.pendingPage(this.cursor, this.config.batchSize);
      for (const job of jobs) {
        if (this.controller.signal.aborted) break;
        await this.index.publish(job);
      }
      this.cursor = jobs.length === this.config.batchSize ? jobs[jobs.length - 1].id : null;
      // Continue pages immediately; delay only after a complete pass.
      this.nextReconciliation = this.cursor ? 0 : Date.now() + this.config.reconciliationIntervalMs;
    }
  }
  async stop() {
    this.controller.abort();
    await this.loop;
  }
}
