import { describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { QueueService } from '@reliable-queue/core';
import { PostgresJobs } from '../jobs';
import { RedisDispatch, createRedis, priorityKeys } from '../redis';
import { loadConfig } from '../config';
import { migrate, checkSchema } from '../migrations';
import { databaseScenarios } from './scenarios';
describe.runIf(process.env.RUN_INTEGRATION_TESTS === '1')(
  'Network PostgreSQL and Redis integration',
  () => {
    const schema = 'rq_test_' + randomUUID().replaceAll('-', '');
    const config = loadConfig();
    const admin = new Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 5000 });
    const pool = new Pool({
      connectionString: config.databaseUrl,
      options: `-c search_path=${schema},public`,
      connectionTimeoutMillis: 5000,
    });
    const redis = createRedis(config),
      index = new RedisDispatch(redis),
      jobs = new PostgresJobs(pool),
      queue = new QueueService(jobs, jobs, index);
    beforeAll(async () => {
      await admin.query(`CREATE SCHEMA ${schema}`);
      await migrate(pool);
      await redis.connect();
    });
    beforeEach(async () => {
      await pool.query(
        'TRUNCATE jobs,dead_letters,job_attempts,dispatch_outbox,audit_log,api_keys,admin_sessions CASCADE',
      );
    });
    afterAll(async () => {
      redis.disconnect();
      await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    });
    databaseScenarios(() => ({ pool, jobs, index, queue }));
    it('uses Lua to pick ready priority globally and republishes lost Redis hints', async () => {
      const name = randomUUID();
      const low = await queue.enqueue({ queue_name: name, payload: {}, priority: 1 });
      const high = await queue.enqueue({ queue_name: name, payload: {}, priority: 10 });
      const future = await queue.enqueue({
        queue_name: name,
        payload: {},
        priority: 10,
        delay_ms: 100000,
      });
      for (const job of await jobs.pendingPage(null, 100)) await index.publish(job);
      expect((await queue.claim(name, 'worker', 30000))?.job.id).toBe(high.job.id);
      await redis.del(...priorityKeys(name)); // Lose only this test's scheduling hints.
      for (const job of await jobs.pendingPage(null, 100)) await index.publish(job);
      expect((await queue.claim(name, 'worker', 30000))?.job.id).toBe(low.job.id);
      expect(await queue.claim(name, 'worker', 30000)).toBeNull();
      expect((await jobs.getJob(future.job.id))?.status).toBe('pending');
      await redis.del(...priorityKeys(name));
    });
    it('rebuilds a missing hint after Redis removal and before a database claim', async () => {
      const name = randomUUID(),
        result = await queue.enqueue({ queue_name: name, payload: {} });
      for (const job of await jobs.pendingPage(null, 100)) await index.publish(job);
      expect(await index.take(name)).not.toBeNull();
      expect(await index.take(name)).toBeNull();
      for (const job of await jobs.pendingPage(null, 100)) await index.publish(job);
      expect((await queue.claim(name, 'worker', 30000))?.job.id).toBe(result.job.id);
    });
    it('preserves populated V1 data through migration', async () => {
      const legacySchema = 'legacy_' + randomUUID().replaceAll('-', '');
      await admin.query(`CREATE SCHEMA ${legacySchema}`);
      const legacy = new Pool({
        connectionString: config.databaseUrl,
        options: `-c search_path=${legacySchema},public`,
      });
      try {
        await legacy.query(
          readFileSync(join(__dirname, '..', 'migrations', '001_baseline.sql'), 'utf8'),
        );
        const original = (
          await legacy.query(
            "INSERT INTO jobs(queue_name,payload,status,attempts,result) VALUES('legacy','{\"saved\":true}','completed',1,'{\"ok\":true}') RETURNING *",
          )
        ).rows[0];
        await migrate(legacy);
        await checkSchema(legacy);
        const imported = (await legacy.query('SELECT * FROM jobs WHERE id=$1', [original.id]))
          .rows[0];
        expect(imported.id).toBe(original.id);
        expect(imported.payload).toEqual(original.payload);
        expect(imported.result).toEqual(original.result);
        expect(imported.created_at).toEqual(original.created_at);
        expect(imported.history_complete).toBe(false);
        expect((await legacy.query('SELECT * FROM job_attempts')).rows[0]).toMatchObject({
          outcome: 'legacy_unknown',
          history_complete: false,
        });
      } finally {
        await legacy.end();
        await admin.query(`DROP SCHEMA ${legacySchema} CASCADE`);
      }
    });
  },
);
