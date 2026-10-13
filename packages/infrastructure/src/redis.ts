import Redis from 'ioredis';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './config';
import type { DispatchIndex, StoredJob, Candidate } from '@reliable-queue/core';
export function createRedis(config: Config): Redis {
  return new Redis(config.redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: config.redisTimeoutMs,
    connectTimeout: config.redisTimeoutMs,
    retryStrategy: (attempt) => Math.min(200 * attempt, 3000),
  });
}
export function priorityKeys(queue: string): string[] {
  const tag = createHash('sha256').update(queue).digest('hex');
  return Array.from({ length: 10 }, (_, i) => `rq:v2:{${tag}}:priority:${10 - i}`);
}
const claimScript = readFileSync(join(__dirname, 'lua', 'take.lua'), 'utf8');
export class RedisDispatch implements DispatchIndex {
  constructor(readonly redis: Redis) {}
  async publish(
    job: Pick<
      StoredJob,
      'id' | 'queue_name' | 'priority' | 'available_at' | 'scheduling_generation'
    >,
  ) {
    await this.redis.zadd(
      priorityKeys(job.queue_name)[10 - job.priority],
      new Date(job.available_at).getTime(),
      `${job.id}:${job.scheduling_generation}`,
    );
  }
  async take(queue: string): Promise<Candidate | null> {
    const member = await this.redis.eval(claimScript, 10, ...priorityKeys(queue));
    if (typeof member !== 'string') return null;
    const [jobId, generation] = member.split(':');
    return { jobId, generation: Number(generation), queueName: queue };
  }
  async ping() {
    await this.redis.ping();
  }
}
