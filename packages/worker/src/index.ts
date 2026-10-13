import { resolve } from 'node:path';
import type { JobHandler } from '@reliable-queue/core';
import { createRuntime, installSignals, startMonitor, delay } from '@reliable-queue/infrastructure';
import { Worker } from './worker';
export { Worker } from './worker';
export { Semaphore } from './semaphore';
async function main() {
  const runtime = await createRuntime('worker', { port: Number(process.env.PORT ?? 3002) }, true);
  try {
    const handlers = new Map<string, JobHandler>();
    if (runtime.config.demoMode)
      handlers.set(runtime.config.queueName, async (job, context) => {
        await delay(200, undefined, { signal: context.signal });
        if (job.payload.fail)
          throw new Error(String(job.payload.failReason ?? 'Simulated failure'));
        return { processed: true, duration_ms: 200 };
      });
    if (runtime.config.handlerModule) {
      const module = (await import(resolve(runtime.config.handlerModule))) as {
        handlers: Record<string, JobHandler>;
      };
      for (const [queue, handler] of Object.entries(module.handlers)) {
        if (typeof handler !== 'function') throw new Error(`Invalid handler: ${queue}`);
        handlers.set(queue, handler);
      }
    }
    const worker = new Worker(
      runtime.queue,
      runtime.config,
      handlers,
      runtime.logger,
      runtime.telemetry,
      (active) => runtime.jobs.heartbeat(runtime.config.workerId, active),
    );
    const closeMonitor = await startMonitor(runtime, () => worker.ready);
    installSignals(async () => {
      try {
        await worker.stop();
      } finally {
        try {
          await closeMonitor();
        } finally {
          await runtime.close();
        }
      }
    }, runtime.logger);
    worker.start();
  } catch (error) {
    await runtime.close();
    throw error;
  }
}
if (require.main === module)
  void main().catch((error) => {
    process.stderr.write(String(error) + '\n');
    process.exitCode = 1;
  });
