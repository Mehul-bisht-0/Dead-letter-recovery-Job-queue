import { client } from './client';
async function main() {
  const api = client();
  const results = [];
  for (let i = 0; i < 100; i++) {
    results.push(
      await api.enqueue({
        queue_name: api.queue,
        payload: i < 80 ? { type: 'example' } : { fail: true, failReason: 'Seed failure' },
        priority: (i % 10) + 1,
        max_attempts: i < 95 ? 3 : 1,
      }),
    );
  }
  for (let i = 0; i < 2; i++)
    results.push(
      await api.enqueue({
        queue_name: api.queue,
        payload: { type: 'dedup_test' },
        idempotency_key: 'seed-idempotency-key',
      }),
    );
  process.stdout.write(
    JSON.stringify({
      submitted: results.length,
      created: results.filter((r) => r.created).length,
    }) + '\n',
  );
}
void main().catch((error) => {
  process.stderr.write(String(error) + '\n');
  process.exitCode = 1;
});
