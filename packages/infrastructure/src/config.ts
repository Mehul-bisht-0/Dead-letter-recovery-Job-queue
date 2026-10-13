import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

export interface Config {
  environment: string;
  databaseUrl: string;
  redisUrl: string;
  host: string;
  port: number;
  queueName: string;
  workerId: string;
  workerConcurrency: number;
  visibilityTimeoutMs: number;
  leaseRenewalMs: number;
  heartbeatIntervalMs: number;
  pollIntervalMs: number;
  jobDeadlineMs: number;
  cancellationGraceMs: number;
  drainTimeoutMs: number;
  backoffBaseMs: number;
  backoffCapMs: number;
  dispatcherIntervalMs: number;
  reconciliationIntervalMs: number;
  batchSize: number;
  databaseTimeoutMs: number;
  redisTimeoutMs: number;
  corsOrigins: string[];
  trustProxy: boolean;
  adminUser: string;
  adminPasswordHash: string;
  demoMode: boolean;
  handlerModule?: string;
  apiUrl: string;
  apiKey: string;
}
function environment(): NodeJS.ProcessEnv {
  const file = resolve(__dirname, '../../..', '.env');
  return existsSync(file)
    ? { ...parseEnv(readFileSync(file, 'utf8')), ...process.env }
    : process.env;
}
export function loadConfig(overrides: Partial<Config> = {}, env = environment()): Config {
  const number = (key: string, fallback: number) => {
    if (env[key] === undefined) return fallback;
    if (
      !/^\d+$/.test(env[key]!) ||
      !Number.isSafeInteger(Number(env[key])) ||
      Number(env[key]) < 1
    ) {
      throw new Error(`${key} must be a positive integer`);
    }
    return Number(env[key]);
  };
  const boolean = (key: string) => {
    if (env[key] !== undefined && !['true', 'false'].includes(env[key]!))
      throw new Error(`${key} must be true or false`);
    return env[key] === 'true';
  };
  const config: Config = {
    environment: env.NODE_ENV ?? 'development',
    databaseUrl:
      env.DATABASE_URL ?? 'postgresql://rq_user:rq_password@localhost:5432/reliable_queue',
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6380',
    host: env.HOST ?? '127.0.0.1',
    port: number('PORT', 3000),
    queueName: env.QUEUE_NAME ?? 'default',
    workerId: env.WORKER_ID ?? `worker-${randomUUID()}`,
    workerConcurrency: number('WORKER_CONCURRENCY', 5),
    visibilityTimeoutMs: number('VISIBILITY_TIMEOUT_MS', 30000),
    leaseRenewalMs: number('LEASE_RENEWAL_MS', 10000),
    heartbeatIntervalMs: number('HEARTBEAT_INTERVAL_MS', 10000),
    pollIntervalMs: number('POLL_INTERVAL_MS', 100),
    jobDeadlineMs: number('JOB_DEADLINE_MS', 300000),
    cancellationGraceMs: number('CANCELLATION_GRACE_MS', 5000),
    drainTimeoutMs: number('DRAIN_TIMEOUT_MS', 30000),
    backoffBaseMs: number('BACKOFF_BASE_MS', 1000),
    backoffCapMs: number('BACKOFF_CAP_MS', 60000),
    dispatcherIntervalMs: number('DISPATCHER_INTERVAL_MS', 500),
    reconciliationIntervalMs: number('RECONCILIATION_INTERVAL_MS', 15000),
    batchSize: number('BATCH_SIZE', 100),
    databaseTimeoutMs: number('DATABASE_TIMEOUT_MS', 5000),
    redisTimeoutMs: number('REDIS_TIMEOUT_MS', 2000),
    corsOrigins: (env.CORS_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    trustProxy: boolean('TRUST_PROXY'),
    adminUser: env.ADMIN_USER ?? 'admin',
    adminPasswordHash: env.ADMIN_PASSWORD_HASH ?? '',
    demoMode: boolean('DEMO_MODE'),
    handlerModule: env.HANDLER_MODULE,
    apiUrl: env.API_URL ?? 'http://localhost:3000',
    apiKey: env.API_KEY ?? '',
    ...overrides,
  };
  if (
    config.port > 65535 ||
    config.workerConcurrency > 1000 ||
    config.batchSize > 1000 ||
    config.leaseRenewalMs * 2 >= config.visibilityTimeoutMs ||
    config.backoffCapMs < config.backoffBaseMs
  ) {
    throw new Error('Invalid port, concurrency, batch size, lease or retry policy');
  }
  if (!['development', 'test', 'production'].includes(config.environment))
    throw new Error('NODE_ENV must be development, test or production');
  if (
    !config.queueName.trim() ||
    config.queueName.length > 255 ||
    !config.workerId.trim() ||
    config.workerId.length > 255
  )
    throw new Error('Valid queue name and worker identifier required');
  if (config.environment === 'production' && config.demoMode)
    throw new Error('Production workers cannot enable DEMO_MODE');
  for (const origin of config.corsOrigins) {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin)
      throw new Error('CORS_ORIGINS must contain explicit HTTP origins');
  }
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 1))
      throw new Error(`${key} must be a positive integer`);
  }
  if (
    config.adminPasswordHash &&
    !/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(config.adminPasswordHash)
  )
    throw new Error('ADMIN_PASSWORD_HASH must be a valid scrypt hash');
  for (const url of [config.databaseUrl, config.redisUrl, config.apiUrl]) new URL(url);
  if (!/^postgres(ql)?:/.test(config.databaseUrl) || !/^rediss?:/.test(config.redisUrl))
    throw new Error('Invalid storage URL protocol');
  if (
    config.environment === 'production' &&
    (!env.DATABASE_URL ||
      !env.REDIS_URL ||
      !config.adminPasswordHash ||
      new URL(config.databaseUrl).password === 'rq_password')
  ) {
    throw new Error('Production requires explicit storage credentials and ADMIN_PASSWORD_HASH');
  }
  Object.freeze(config.corsOrigins);
  return Object.freeze(config);
}
