import { client } from './client';
async function main() {
  const api = client(),
    count = Number(process.env.LOADTEST_JOBS ?? 100),
    timeoutMs = Number(process.env.LOADTEST_TIMEOUT_MS ?? 120000);
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 10000 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1000
  )
    throw new Error('Invalid benchmark limits');
  const start = performance.now();
  const ids: string[] = [],
    latencies: number[] = [];
  let index = 0,
    maxDispatchLagSeconds = 0;
  await api.send('/diagnostics'); // Benchmarks require an administrator key.
  await Promise.all(
    Array.from({ length: Math.min(10, count) }, async () => {
      while (index < count) {
        const n = index++;
        const before = performance.now();
        const result = await api.enqueue({
          queue_name: api.queue,
          payload: { benchmark: n },
          max_attempts: 3,
        });
        ids.push(result.job.id);
        latencies.push(performance.now() - before);
      }
    }),
  );
  const enqueueMs = performance.now() - start,
    deadline = Date.now() + timeoutMs;
  let completed = 0,
    dead = 0,
    retries = 0,
    dispatchLag = 0;
  const remaining = new Set(ids);
  while (remaining.size && Date.now() < deadline) {
    maxDispatchLagSeconds = Math.max(
      maxDispatchLagSeconds,
      (await api.send('/diagnostics')).dispatchLagSeconds,
    );
    const page = [...remaining].slice(0, 100);
    const results = await Promise.all(
      page.map(async (id) => ({ id, ...(await api.send(`/jobs/${id}`)) })),
    );
    for (const { id, job } of results) {
      if (['completed', 'dead', 'failed'].includes(job.status)) {
        remaining.delete(id);
        if (job.status === 'completed') completed++;
        else dead++;
        retries += Math.max(0, job.attempts - 1);
        dispatchLag = Math.max(
          dispatchLag,
          new Date(job.updated_at).getTime() - new Date(job.available_at).getTime(),
        );
      }
    }
    if (remaining.size) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  latencies.sort((a, b) => a - b);
  const duration = (performance.now() - start) / 1000;
  process.stdout.write(
    JSON.stringify(
      {
        submitted: ids.length,
        completed,
        dead,
        unreconciled: remaining.size,
        retries,
        enqueueP50Ms: latencies[Math.floor(latencies.length * 0.5)],
        enqueueP95Ms:
          latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))],
        enqueueThroughput: ids.length / (enqueueMs / 1000),
        completionThroughput: completed / duration,
        maxDispatchLagSeconds,
        maxAvailabilityToTerminalMs: dispatchLag,
        durationSeconds: duration,
      },
      null,
      2,
    ) + '\n',
  );
  if (remaining.size || dead) process.exitCode = 1;
}
void main().catch((error) => {
  process.stderr.write(String(error) + '\n');
  process.exitCode = 1;
});
