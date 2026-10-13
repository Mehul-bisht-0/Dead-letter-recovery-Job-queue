import { describe, beforeAll, afterAll, beforeEach, it, expect, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  QueueService,
  type DispatchIndex,
  type StoredJob,
  type Candidate,
} from '@reliable-queue/core';
import { migrate, checkSchema } from '../migrations';
import { PostgresJobs } from '../jobs';
import { databaseScenarios } from './scenarios';
import { createApp } from '@reliable-queue/api';
import { Worker } from '@reliable-queue/worker';
import { Dispatcher } from '@reliable-queue/dispatcher';
import { Telemetry } from '@reliable-queue/infrastructure';
import { AuthStore } from '../auth';
import { loadConfig } from '../config';
import { logger } from '../../../../tests/helpers';
// Real PostgreSQL engine in WASM. Serialize transactions because PGlite has one connection.
// The network integration suite below additionally verifies multi-connection contention and Redis Lua.
function embeddedPool(database: PGlite): Pool {
  let tail: Promise<void> = Promise.resolve();
  const lock = async () => {
    let release!: () => void;
    const previous = tail;
    tail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    return release;
  };
  const query = async (sql: string, params?: unknown[]) => {
    const result = params ? await database.query(sql, params) : (await database.exec(sql)).at(-1)!;
    return { rows: result.rows, rowCount: result.affectedRows };
  };
  return {
    async query(sql: string, params?: unknown[]) {
      const release = await lock();
      try {
        return await query(sql, params);
      } finally {
        release();
      }
    },
    async connect() {
      const release = await lock();
      return { query, release };
    },
  } as unknown as Pool;
}
class MemoryIndex implements DispatchIndex {
  readonly entries = new Map<
    string,
    Pick<StoredJob, 'id' | 'queue_name' | 'priority' | 'available_at' | 'scheduling_generation'>
  >();
  async publish(
    job: Pick<
      StoredJob,
      'id' | 'queue_name' | 'priority' | 'available_at' | 'scheduling_generation'
    >,
  ) {
    this.entries.set(`${job.id}:${job.scheduling_generation}`, job);
  }
  async take(queue: string): Promise<Candidate | null> {
    const ready = [...this.entries.entries()]
      .filter(([, j]) => j.queue_name === queue && new Date(j.available_at).getTime() <= Date.now())
      .sort((a, b) => b[1].priority - a[1].priority);
    if (!ready[0]) return null;
    const [key, job] = ready[0];
    this.entries.delete(key);
    return { jobId: job.id, generation: job.scheduling_generation, queueName: queue };
  }
  async ping() {}
}
describe('PostgreSQL persistence with embedded engine', () => {
  let database: PGlite, pool: Pool, jobs: PostgresJobs, index: MemoryIndex, queue: QueueService;
  beforeAll(async () => {
    database = new PGlite();
    pool = embeddedPool(database);
    await migrate(pool);
    jobs = new PostgresJobs(pool);
    index = new MemoryIndex();
    queue = new QueueService(jobs, jobs, index);
  });
  beforeEach(async () => {
    await pool.query(
      'TRUNCATE jobs,dead_letters,job_attempts,dispatch_outbox,audit_log,api_keys,admin_sessions CASCADE',
    );
    index.entries.clear();
  });
  afterAll(async () => {
    await database?.close();
  });
  databaseScenarios(() => ({ pool, jobs, index, queue }));
  it('completes an authenticated HTTP enqueue through outbox dispatch and worker execution', async () => {
    const telemetry = new Telemetry(),
      auth = new AuthStore(pool),
      key = await auth.provision('test', 'administrator', []);
    const config = loadConfig(
      { pollIntervalMs: 1, dispatcherIntervalMs: 1, reconciliationIntervalMs: 1 },
      {},
    );
    const dispatcher = new Dispatcher(jobs, index, config, logger);
    const worker = new Worker(
      queue,
      config,
      new Map([['default', async () => ({ processed: true })]]),
      logger,
      telemetry,
      (active) => jobs.heartbeat('e2e', active),
    );
    const app = await createApp({
      queue,
      auth,
      telemetry,
      ready: async () => {
        await pool.query('SELECT 1');
      },
    });
    try {
      dispatcher.start();
      worker.start();
      const response = await app.inject({
        method: 'POST',
        url: '/jobs',
        headers: { authorization: `Bearer ${key.token}` },
        payload: { queue_name: 'default', payload: { type: 'e2e' }, idempotency_key: 'e2e' },
      });
      expect(response.statusCode).toBe(201);
      const id = response.json().job.id;
      await vi.waitFor(async () => expect((await jobs.getJob(id))?.status).toBe('completed'), {
        timeout: 10000,
      });
      const result = await app.inject({
        url: `/jobs/${id}`,
        headers: { authorization: `Bearer ${key.token}` },
      });
      expect(result.json().job.result).toEqual({ processed: true });
      expect((await jobs.metrics()).workers[0].id).toBe('e2e');
    } finally {
      await worker.stop();
      await dispatcher.stop();
      await app.close();
      telemetry.registry.clear();
    }
  });
  it('validates migration checksums and does not run DDL on schema checks', async () => {
    await checkSchema(pool);
    await migrate(pool);
    await pool.query(
      "UPDATE schema_migrations SET checksum=repeat('0',64) WHERE name='002_reliability.sql'",
    );
    await expect(checkSchema(pool)).rejects.toThrow('incompatible');
    await expect(migrate(pool)).rejects.toThrow('checksum mismatch');
  });
  it('preserves populated legacy jobs, terminal results and incomplete history', async () => {
    const legacyDatabase = new PGlite();
    const legacyPool = embeddedPool(legacyDatabase);
    try {
      await legacyPool.query(
        readFileSync(join(__dirname, '..', 'migrations', '001_baseline.sql'), 'utf8'),
      );
      const original = (
        await legacyPool.query(
          "INSERT INTO jobs(queue_name,payload,status,attempts,result) VALUES('legacy','{\"saved\":true}','completed',1,'{\"ok\":true}') RETURNING *",
        )
      ).rows[0];
      await migrate(legacyPool);
      await checkSchema(legacyPool);
      const imported = (await legacyPool.query('SELECT * FROM jobs WHERE id=$1', [original.id]))
        .rows[0];
      expect(imported).toMatchObject({
        id: original.id,
        payload: original.payload,
        result: original.result,
        created_at: original.created_at,
        status: 'completed',
        history_complete: false,
      });
      expect((await legacyPool.query('SELECT * FROM job_attempts')).rows[0]).toMatchObject({
        outcome: 'legacy_unknown',
        history_complete: false,
      });
    } finally {
      await legacyDatabase.close();
    }
  });
});
