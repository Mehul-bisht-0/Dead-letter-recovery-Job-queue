// ---------------------------------------------------------------------------
// Worker — the main job processing loop
// ---------------------------------------------------------------------------

import { QueueService, Config, Job, JobHandler } from '@reliable-queue/core';
import { Semaphore } from './semaphore';
import { isDraining } from './shutdown';

/**
 * Registry of job handlers keyed by queue name.
 * The worker looks up the handler for each claimed job's queue_name.
 */
const handlers = new Map<string, JobHandler>();

/** Register a handler function for a specific queue */
export function registerHandler(queueName: string, handler: JobHandler): void {
  handlers.set(queueName, handler);
  console.log(`[worker] Registered handler for queue "${queueName}"`);
}

/**
 * Start the worker polling loop. Claims jobs from Redis, executes the
 * registered handler, and acks/nacks based on the result.
 */
export async function startWorkerLoop(
  queueService: QueueService,
  config: Config,
  semaphore: Semaphore,
): Promise<void> {
  const { queueName, workerId, visibilityTimeoutMs, pollIntervalMs, backoffBaseMs, backoffCapMs } = config;

  console.log(`[worker] Starting poll loop for queue "${queueName}" (concurrency=${semaphore['max']})`);

  while (!isDraining()) {
    try {
      // Wait for a concurrency slot before claiming
      await semaphore.acquire();

      if (isDraining()) {
        semaphore.release();
        break;
      }

      // Try to claim a job
      const job = await queueService.claim(queueName, workerId, visibilityTimeoutMs);

      if (!job) {
        semaphore.release();
        // No jobs available — wait before next poll
        await sleep(pollIntervalMs);
        continue;
      }

      // Process the job asynchronously (don't await — allow concurrency)
      processJob(job, queueService, semaphore, backoffBaseMs, backoffCapMs).catch((err) => {
        console.error(`[worker] Unexpected error processing job ${job.id}:`, err);
        semaphore.release();
      });

    } catch (err: any) {
      console.error('[worker] Poll loop error:', err.message);
      await sleep(pollIntervalMs * 5); // Back off on errors
    }
  }

  console.log('[worker] Poll loop stopped (draining)');
}

/**
 * Process a single job: look up handler, execute, ack or nack.
 */
async function processJob(
  job: Job,
  queueService: QueueService,
  semaphore: Semaphore,
  backoffBaseMs: number,
  backoffCapMs: number,
): Promise<void> {
  const handler = handlers.get(job.queue_name) ?? defaultHandler;

  try {
    console.log(`[worker] Processing job ${job.id} (queue=${job.queue_name}, attempt=${job.attempts})`);
    const result = await handler(job);
    await queueService.ack(job.id, result ?? undefined);
    console.log(`[worker] ✓ Completed job ${job.id}`);
  } catch (err: any) {
    const errorMessage = err.message ?? String(err);
    console.error(`[worker] ✗ Failed job ${job.id}: ${errorMessage}`);

    const outcome = await queueService.nack(job.id, errorMessage, backoffBaseMs, backoffCapMs);
    console.log(`[worker] Job ${job.id} → ${outcome}`);
  } finally {
    semaphore.release();
  }
}

/**
 * Default handler — simulates work with a random delay.
 * Replace by calling registerHandler() for your queue.
 */
const defaultHandler: JobHandler = async (job: Job) => {
  // Simulate work (200-800ms)
  const workMs = 200 + Math.random() * 600;
  await sleep(workMs);

  // Check if this job is designed to fail (payload.fail === true)
  if (job.payload.fail) {
    throw new Error(`Simulated failure for job ${job.id}: ${job.payload.failReason ?? 'unknown'}`);
  }

  return { processed: true, duration_ms: Math.round(workMs) };
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
