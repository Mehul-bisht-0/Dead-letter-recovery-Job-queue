// ---------------------------------------------------------------------------
// Worker entry point — wires everything together and starts processing
// ---------------------------------------------------------------------------

import {
  loadConfig,
  getPool,
  getRedis,
  migrate,
  QueueService,
  closePool,
  closeRedis,
} from '@reliable-queue/core';

import { Semaphore } from './semaphore';
import { HeartbeatService } from './heartbeat';
import { ReaperService } from './reaper';
import { installShutdownHandlers, onShutdown, isDraining } from './shutdown';
import { startWorkerLoop } from './worker';

async function main() {
  const config = loadConfig();

  console.log(`[worker] Starting worker ${config.workerId}`);
  console.log(`[worker] Queue: ${config.queueName}, Concurrency: ${config.workerConcurrency}`);

  // --- Infrastructure setup ---
  await migrate(config);

  const pool = getPool(config);
  const redis = getRedis(config);
  const queueService = new QueueService(pool, redis);
  const semaphore = new Semaphore(config.workerConcurrency);

  // --- Heartbeat: report liveness to Postgres --------------------------
  const heartbeat = new HeartbeatService(
    pool,
    config.workerId,
    config.heartbeatIntervalMs,
    () => semaphore.active,
  );
  heartbeat.start();

  // --- Reaper: recover stale jobs (leader-elected) ---------------------
  const reaper = new ReaperService(
    redis,
    queueService,
    config.workerId,
    config.reaperIntervalMs,
    config.reaperLockTtlMs,
  );
  reaper.start();

  // --- Graceful shutdown -----------------------------------------------
  installShutdownHandlers();

  onShutdown(async () => {
    console.log('[worker] Waiting for in-flight jobs to complete...');
    // Wait up to 30 seconds for in-flight jobs
    const deadline = Date.now() + 30_000;
    while (semaphore.active > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
    }
    if (semaphore.active > 0) {
      console.warn(`[worker] Force-exiting with ${semaphore.active} job(s) still in flight`);
    }
  });

  onShutdown(async () => {
    heartbeat.stop();
    reaper.stop();
  });

  onShutdown(async () => {
    await closeRedis();
    await closePool();
  });

  // --- Start processing -----------------------------------------------
  await startWorkerLoop(queueService, config, semaphore);
}

main().catch((err) => {
  console.error('[worker] Fatal error:', err);
  process.exit(1);
});
