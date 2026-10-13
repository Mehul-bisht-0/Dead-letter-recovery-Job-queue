import { QueueService } from '@reliable-queue/core';
import { loadConfig, type Config } from './config';
import { createPool } from './database';
import { checkSchema } from './migrations';
import { PostgresJobs } from './jobs';
import { createRedis, RedisDispatch } from './redis';
import { AuthStore } from './auth';
import { createLogger, Telemetry } from './observability';
export async function createRuntime(
  service: string,
  overrides: Partial<Config> = {},
  requireRedis = false,
) {
  const config = loadConfig(overrides),
    logger = createLogger(service),
    pool = createPool(config),
    redis = createRedis(config);
  pool.on('error', (error) => logger.error({ err: error }, 'PostgreSQL pool error'));
  redis.on('error', (error) => logger.warn({ err: error }, 'Redis connection error'));
  try {
    await checkSchema(pool);
    if (requireRedis) await redis.connect();
    else
      void redis
        .connect()
        .catch((error) =>
          logger.warn({ err: error }, 'Redis unavailable; durable acceptance remains available'),
        );
  } catch (error) {
    redis.disconnect();
    await pool.end();
    throw error;
  }
  const jobs = new PostgresJobs(pool, { baseMs: config.backoffBaseMs, capMs: config.backoffCapMs });
  const dispatch = new RedisDispatch(redis),
    auth = new AuthStore(pool),
    telemetry = new Telemetry();
  const queue = new QueueService(jobs, jobs, dispatch, {
    baseMs: config.backoffBaseMs,
    capMs: config.backoffCapMs,
  });
  let closed = false;
  return {
    config,
    logger,
    pool,
    redis,
    jobs,
    dispatch,
    auth,
    telemetry,
    queue,
    async close() {
      if (closed) return;
      closed = true;
      redis.disconnect();
      await pool.end();
      telemetry.registry.clear();
    },
  };
}
export type Runtime = Awaited<ReturnType<typeof createRuntime>>;
