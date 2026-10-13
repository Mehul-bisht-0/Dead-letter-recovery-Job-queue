import { createPool, transaction } from './database';
import { loadConfig } from './config';
import { checkSchema, migrate } from './migrations';
import { AuthStore, hashPassword, type Principal } from './auth';
import { preflight } from './preflight';
import { createRedis, RedisDispatch } from './redis';
import { PostgresJobs } from './jobs';
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'hash-password') {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    process.stdout.write(hashPassword(input.replace(/\r?\n$/, '')) + '\n');
    return;
  }
  const config = loadConfig(),
    pool = createPool(config);
  try {
    if (command === 'preflight') {
      process.stdout.write(JSON.stringify(await preflight(pool)) + '\n');
      return;
    }
    if (command === 'migrate') {
      await migrate(pool);
      process.stdout.write('Migrations applied\n');
      return;
    }
    await checkSchema(pool);
    const auth = new AuthStore(pool);
    if (command === 'reconcile') {
      const redis = createRedis(config);
      redis.on('error', () => {});
      try {
        await redis.connect();
        const index = new RedisDispatch(redis),
          jobs = new PostgresJobs(pool);
        let after: string | null = null,
          total = 0;
        do {
          const page = await jobs.pendingPage(after, config.batchSize);
          for (const job of page) await index.publish(job);
          total += page.length;
          after = page.length === config.batchSize ? page[page.length - 1].id : null;
        } while (after);
        process.stdout.write(JSON.stringify({ republished: total }) + '\n');
      } finally {
        redis.disconnect();
      }
      return;
    }
    if (command === 'provision-key' || command === 'rotate-key') {
      const [name, role, queues = '', revokeId] = args;
      if (command === 'rotate-key' && !revokeId)
        throw new Error('rotate-key requires old key UUID as fourth argument');
      process.stdout.write(
        JSON.stringify(
          await auth.provision(
            name,
            role as Principal['role'],
            queues.split(',').filter(Boolean),
            command === 'rotate-key' ? revokeId : undefined,
          ),
        ) + '\n',
      );
    } else if (command === 'revoke-key') {
      await auth.revoke(args[0]);
      process.stdout.write('Key revoked\n');
    } else if (command === 'retention') {
      const days = Number(args[0]);
      if (!Number.isInteger(days) || days < 2)
        throw new Error('Explicit retention age of at least 2 days required');
      await transaction(pool, async (client) => {
        await client.query('DELETE FROM admin_sessions WHERE expires_at<clock_timestamp()');
        await client.query(
          `CREATE TEMP TABLE expired_jobs ON COMMIT DROP AS SELECT id FROM jobs
          WHERE status IN ('completed','failed') AND updated_at<clock_timestamp()-$1*INTERVAL '1 day'`,
          [days],
        );
        for (const table of ['dispatch_outbox', 'job_attempts'])
          await client.query(`DELETE FROM ${table} WHERE job_id IN (SELECT id FROM expired_jobs)`);
        await client.query(
          'DELETE FROM dead_letters WHERE NOT active AND original_job_id IN (SELECT id FROM expired_jobs)',
        );
        const result = await client.query(
          'DELETE FROM jobs WHERE id IN (SELECT id FROM expired_jobs)',
        );
        await client.query(
          "INSERT INTO audit_log(action,entity_type,details) VALUES('retention','maintenance',$1)",
          [JSON.stringify({ days, jobsRemoved: result.rowCount })],
        );
      });
      process.stdout.write('Explicit retention completed; audit records retained\n');
    } else
      throw new Error(
        'Usage: migrate | hash-password (stdin) | provision-key NAME ROLE QUEUES | rotate-key NAME ROLE QUEUES OLD_ID | revoke-key ID | retention DAYS',
      );
  } finally {
    await pool.end();
  }
}
if (require.main === module)
  void main().catch((error) => {
    process.stderr.write(String(error) + '\n');
    process.exitCode = 1;
  });
