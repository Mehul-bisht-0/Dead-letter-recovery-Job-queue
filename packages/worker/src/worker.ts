import {
  QueueError,
  type QueueService,
  type JobHandler,
  type Claim,
  type Logger,
} from '@reliable-queue/core';
import { delay, repeat, type Config, type Telemetry } from '@reliable-queue/infrastructure';
import { Semaphore } from './semaphore';
export class Worker {
  private readonly polling = new AbortController();
  private readonly maintenance = new AbortController();
  private readonly executions = new Map<Promise<void>, AbortController>();
  private readonly semaphore: Semaphore;
  private loop: Promise<void> | null = null;
  private heartbeat: Promise<void> | null = null;
  private closing: Promise<void> | null = null;
  constructor(
    private readonly queue: QueueService,
    private readonly config: Config,
    private readonly handlers: ReadonlyMap<string, JobHandler>,
    private readonly logger: Logger,
    private readonly telemetry: Telemetry,
    private readonly beat: (active: number) => Promise<void>,
    private readonly terminate: () => void = () => process.exit(1),
  ) {
    this.semaphore = new Semaphore(config.workerConcurrency);
    if (!handlers.has(config.queueName))
      throw new Error(`No handler registered for ${config.queueName}`);
  }
  get ready() {
    return !this.polling.signal.aborted;
  }
  get active() {
    return this.semaphore.active;
  }
  start(): void {
    if (this.loop) throw new Error('Worker already started');
    this.heartbeat = repeat(
      this.config.heartbeatIntervalMs,
      () => this.beat(this.active),
      this.maintenance.signal,
      this.logger,
    );
    this.loop = this.poll();
  }
  private async poll() {
    while (!this.polling.signal.aborted) {
      const release = this.semaphore.tryAcquire();
      if (release) {
        try {
          const claim = await this.queue.claim(
            this.config.queueName,
            this.config.workerId,
            this.config.visibilityTimeoutMs,
          );
          if (!claim) release();
          else {
            const controller = new AbortController();
            if (this.polling.signal.aborted) {
              release();
              continue;
            } // Unexecuted claim recovers via expiry.
            const task = this.execute(claim, controller)
              .catch((error) =>
                this.logger.error({ err: error, jobId: claim.job.id }, 'Execution failed'),
              )
              .finally(() => {
                release();
                this.executions.delete(task);
              });
            this.executions.set(task, controller);
          }
        } catch (error) {
          release();
          this.logger.error({ err: error }, 'Claim failed');
        }
      }
      try {
        await delay(this.config.pollIntervalMs, undefined, { signal: this.polling.signal });
      } catch {
        break;
      }
    }
  }
  private async execute(claim: Claim, controller: AbortController): Promise<void> {
    const renewal = new AbortController();
    let lost = false;
    const renewals = repeat(
      this.config.leaseRenewalMs,
      async () => {
        try {
          if (!(await this.queue.renew(claim, this.config.visibilityTimeoutMs)))
            throw new QueueError('LEASE_LOST', 'Lease renewal rejected');
        } catch (error) {
          lost = true;
          this.telemetry.failures.inc();
          controller.abort(error);
          renewal.abort();
        }
      },
      renewal.signal,
      this.logger,
    );
    const deadline = setTimeout(
      () => controller.abort(new Error('Handler deadline exceeded')),
      this.config.jobDeadlineMs,
    );
    let kill: ReturnType<typeof setTimeout> | undefined;
    const aborted = () => {
      kill = setTimeout(() => {
        this.logger.error(
          { jobId: claim.job.id },
          'Handler ignored cancellation; terminating worker',
        );
        this.terminate();
      }, this.config.cancellationGraceMs);
    };
    controller.signal.addEventListener('abort', aborted, { once: true });
    const stopTimer = this.telemetry.duration.startTimer();
    const details = {
      jobId: claim.job.id,
      attemptId: claim.attemptId,
      executionCycle: claim.job.execution_cycle,
      workerId: this.config.workerId,
    };
    const contextLogger: Logger = {
      info: (fields, message) => this.logger.info({ ...fields, ...details }, message),
      warn: (fields, message) => this.logger.warn({ ...fields, ...details }, message),
      error: (fields, message) => this.logger.error({ ...fields, ...details }, message),
    };
    let result: Record<string, unknown> | void = undefined;
    let handlerError: unknown;
    let failed = false;
    contextLogger.info({ attempt: claim.job.attempts }, 'Job execution started');
    try {
      result = await this.handlers.get(claim.job.queue_name)!(claim.job, {
        signal: controller.signal,
        attemptId: claim.attemptId,
        executionCycle: claim.job.execution_cycle,
        logger: contextLogger,
      });
      if (controller.signal.aborted) {
        failed = true;
        handlerError = controller.signal.reason;
      }
    } catch (error) {
      failed = true;
      handlerError = error;
    } finally {
      clearTimeout(deadline);
      if (kill) clearTimeout(kill);
      controller.signal.removeEventListener('abort', aborted);
      stopTimer();
    }
    try {
      if (lost) {
        this.telemetry.outcomes.inc({ outcome: 'lease_lost' });
        return;
      }
      if (failed) {
        const outcome = await this.queue.nack(
          claim,
          handlerError instanceof Error ? handlerError.message : String(handlerError),
        );
        this.telemetry.outcomes.inc({ outcome });
        contextLogger.warn({ outcome }, 'Job execution failed');
      } else {
        // Storage errors escape this branch; successful handlers are never nacked.
        await this.queue.ack(claim, result ?? undefined);
        this.telemetry.outcomes.inc({ outcome: 'completed' });
        contextLogger.info({}, 'Job execution completed');
      }
    } finally {
      renewal.abort();
      await renewals;
    }
  }
  stop(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = this.drain();
    return this.closing;
  }
  private async drain() {
    this.polling.abort();
    await this.loop;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const completed = Promise.allSettled([...this.executions.keys()]);
    await Promise.race([
      completed,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, this.config.drainTimeoutMs);
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (this.executions.size) {
      for (const controller of this.executions.values())
        controller.abort(new Error('Worker draining'));
      await completed;
    }
    this.maintenance.abort();
    await this.heartbeat;
    await this.beat(0);
  }
}
