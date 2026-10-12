// ---------------------------------------------------------------------------
// Basic load test (throughput benchmark)
// ---------------------------------------------------------------------------

import { loadConfig, getPool, getRedis, QueueService, closePool, closeRedis } from '@reliable-queue/core';

async function main() {
  const config = loadConfig();
  const pool = getPool(config);
  const redis = getRedis(config);
  const queue = new QueueService(pool, redis);

  const DURATION_SEC = 10;
  const BATCH_SIZE = 50;

  console.log(`[loadtest] Starting enqueue benchmark for ${DURATION_SEC}s...`);

  let count = 0;
  const start = Date.now();
  const end = start + (DURATION_SEC * 1000);

  // Run in a tight loop pushing batches
  while (Date.now() < end) {
    const batch = Array.from({ length: BATCH_SIZE }).map((_, i) => 
      queue.enqueue({
        queue_name: 'benchmark',
        payload: { idx: count + i },
      })
    );
    await Promise.all(batch);
    count += BATCH_SIZE;
  }

  const durationMs = Date.now() - start;
  const rate = (count / (durationMs / 1000)).toFixed(2);

  console.log(`[loadtest] Enqueued ${count} jobs in ${durationMs}ms`);
  console.log(`[loadtest] Rate: ${rate} jobs/sec`);

  await closeRedis();
  await closePool();
}

main().catch(err => {
  console.error('[loadtest] Error:', err);
  process.exit(1);
});
