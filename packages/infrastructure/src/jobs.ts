import type { Pool, PoolClient } from 'pg';
import {
  QueueError,
  failureDisposition,
  computeBackoff,
  type LifecycleRepository,
  type QueryRepository,
  type MaintenanceRepository,
  type EnqueueOptions,
  type EnqueueResult,
  type Candidate,
  type Claim,
  type StoredJob,
  type JobFilters,
  type DeadLetter,
  type OutboxEntry,
  type MetricsSnapshot,
} from '@reliable-queue/core';
import { transaction } from './database';

export async function audit(
  client: PoolClient,
  action: string,
  entityId: string,
  details: Record<string, unknown> = {},
) {
  await client.query(
    "INSERT INTO audit_log(action,entity_type,entity_id,details) VALUES($1,'job',$2,$3)",
    [action, entityId, JSON.stringify(details)],
  );
}
async function schedule(client: PoolClient, job: StoredJob) {
  await client.query(
    `INSERT INTO dispatch_outbox(job_id,queue_name,generation,priority,available_at)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(job_id,generation) DO NOTHING`,
    [job.id, job.queue_name, job.scheduling_generation, job.priority, job.available_at],
  );
}

export class PostgresJobs implements LifecycleRepository, QueryRepository, MaintenanceRepository {
  constructor(
    readonly pool: Pool,
    private readonly retryPolicy = { baseMs: 1000, capMs: 60000 },
  ) {}

  enqueue(options: EnqueueOptions): Promise<EnqueueResult> {
    return transaction(this.pool, async (client) => {
      if (options.idempotency_key) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          JSON.stringify([options.queue_name, options.idempotency_key]),
        ]);
        const existing = await client.query<StoredJob>(
          `SELECT * FROM jobs WHERE queue_name=$1
          AND idempotency_key=$2 AND created_at>clock_timestamp()-INTERVAL '24 hours'
          ORDER BY created_at DESC LIMIT 1`,
          [options.queue_name, options.idempotency_key],
        );
        if (existing.rows[0]) return { job: existing.rows[0], created: false };
      }
      const result = await client.query<StoredJob>(
        `INSERT INTO jobs(queue_name,payload,priority,max_attempts,available_at,idempotency_key)
        VALUES($1,$2,$3,$4,clock_timestamp()+$5*INTERVAL '1 millisecond',$6) RETURNING *`,
        [
          options.queue_name,
          JSON.stringify(options.payload),
          options.priority ?? 5,
          options.max_attempts ?? 3,
          options.delay_ms ?? 0,
          options.idempotency_key ?? null,
        ],
      );
      const job = result.rows[0];
      await schedule(client, job);
      await audit(client, 'enqueued', job.id, { generation: job.scheduling_generation });
      return { job, created: true };
    });
  }

  claim(candidate: Candidate, workerId: string, visibilityMs: number): Promise<Claim | null> {
    return transaction(this.pool, async (client) => {
      const result = await client.query<StoredJob>(
        `UPDATE jobs SET status='processing',locked_by=$1,
        locked_until=clock_timestamp()+$2*INTERVAL '1 millisecond',lease_token=gen_random_uuid(),
        attempts=attempts+1,updated_at=clock_timestamp()
        WHERE id=$3 AND scheduling_generation=$4 AND status='pending'
        AND available_at<=clock_timestamp() AND attempts<max_attempts AND queue_name=$5 RETURNING *`,
        [workerId, visibilityMs, candidate.jobId, candidate.generation, candidate.queueName],
      );
      if (!result.rows[0]) return null;
      const job = result.rows[0];
      const attempt = await client.query<{ id: string }>(
        `INSERT INTO job_attempts(job_id,execution_cycle,attempt,lease_token,worker_id)
        VALUES($1,$2,$3,$4,$5) RETURNING id`,
        [job.id, job.execution_cycle, job.attempts, job.lease_token, workerId],
      );
      await audit(client, 'claimed', job.id, {
        worker: workerId,
        attempt: job.attempts,
        cycle: job.execution_cycle,
      });
      return { job, token: job.lease_token!, attemptId: attempt.rows[0].id };
    });
  }

  async renew(claim: Claim, visibilityMs: number): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE jobs SET locked_until=clock_timestamp()+$1*INTERVAL '1 millisecond'
      WHERE id=$2 AND status='processing' AND lease_token=$3 AND locked_by=$4 AND locked_until>clock_timestamp()`,
      [visibilityMs, claim.job.id, claim.token, claim.job.locked_by],
    );
    return result.rowCount === 1;
  }

  async complete(claim: Claim, value?: Record<string, unknown>): Promise<void> {
    await transaction(this.pool, async (client) => {
      const result = await client.query(
        `UPDATE jobs SET status='completed',result=$1,error=NULL,
        locked_by=NULL,locked_until=NULL,lease_token=NULL,updated_at=clock_timestamp()
        WHERE id=$2 AND status='processing' AND lease_token=$3 AND locked_until>clock_timestamp()`,
        [value === undefined ? null : JSON.stringify(value), claim.job.id, claim.token],
      );
      if (result.rowCount !== 1)
        throw new QueueError('LEASE_LOST', 'Execution lease is no longer owned');
      await client.query(
        "UPDATE job_attempts SET outcome='completed',finished_at=clock_timestamp() WHERE id=$1 AND lease_token=$2",
        [claim.attemptId, claim.token],
      );
      await audit(client, 'completed', claim.job.id, { attemptId: claim.attemptId });
    });
  }

  fail(claim: Claim, error: string, delayMs: number): Promise<'retried' | 'dead-lettered'> {
    return transaction(this.pool, async (client) => {
      const result = await client.query<StoredJob>(`SELECT * FROM jobs WHERE id=$1 FOR UPDATE`, [
        claim.job.id,
      ]);
      const job = result.rows[0];
      if (!job || job.status !== 'processing' || job.lease_token !== claim.token)
        throw new QueueError('LEASE_LOST', 'Execution lease is no longer owned');
      return this.settleFailure(client, job, error, delayMs, 'failed', claim.token);
    });
  }

  private async settleFailure(
    client: PoolClient,
    job: StoredJob,
    error: string,
    delayMs: number,
    outcome: 'failed' | 'lease_expired',
    token?: string,
  ): Promise<'retried' | 'dead-lettered'> {
    const disposition = failureDisposition(job.attempts, job.max_attempts);
    const result = await client.query<StoredJob>(
      `UPDATE jobs SET status=$1::text,error=$2,result=NULL,
      available_at=CASE WHEN $1::text='pending' THEN clock_timestamp()+$3*INTERVAL '1 millisecond' ELSE available_at END,
      scheduling_generation=scheduling_generation+1,locked_by=NULL,locked_until=NULL,lease_token=NULL,updated_at=clock_timestamp()
      WHERE id=$4 ${token ? "AND status='processing' AND lease_token=$5 AND locked_until>clock_timestamp()" : ''} RETURNING *`,
      [
        disposition === 'retry' ? 'pending' : 'dead',
        error.slice(0, 8192),
        delayMs,
        job.id,
        ...(token ? [token] : []),
      ],
    );
    if (!result.rows[0]) throw new QueueError('LEASE_LOST', 'Execution lease expired');
    await client.query(
      `UPDATE job_attempts SET outcome=$1,error=$2,finished_at=clock_timestamp()
      WHERE job_id=$3 AND execution_cycle=$4 AND attempt=$5 AND outcome IS NULL`,
      [outcome, error.slice(0, 8192), job.id, job.execution_cycle, job.attempts],
    );
    if (disposition === 'retry') {
      await schedule(client, result.rows[0]);
      await audit(client, 'retried', job.id, {
        reason: error.slice(0, 8192),
        attempt: job.attempts,
        outcome,
      });
      return 'retried';
    }
    await client.query(
      `INSERT INTO dead_letters(original_job_id,queue_name,payload,failure_reason,failure_history,execution_cycle)
      VALUES($1,$2,$3,$4,COALESCE((SELECT jsonb_agg(jsonb_build_object('attempt',attempt,'error',error,
        'failed_at',finished_at) ORDER BY attempt) FROM job_attempts WHERE job_id=$1 AND execution_cycle=$5 AND outcome IN ('failed','lease_expired','legacy_unknown')),'[]'),$5)
      ON CONFLICT(original_job_id,execution_cycle) WHERE active DO NOTHING`,
      [
        job.id,
        job.queue_name,
        JSON.stringify(job.payload),
        error.slice(0, 8192),
        job.execution_cycle,
      ],
    );
    await audit(client, 'moved_to_dlq', job.id, {
      reason: error.slice(0, 8192),
      attempts: job.attempts,
    });
    return 'dead-lettered';
  }

  replay(id: string, actor: string) {
    return transaction(this.pool, async (client) => {
      const entry = await client.query<DeadLetter & { active: boolean; execution_cycle: number }>(
        'SELECT * FROM dead_letters WHERE id=$1 FOR UPDATE',
        [id],
      );
      const dead = entry.rows[0];
      if (!dead || !dead.active) throw new QueueError('NOT_FOUND', 'Dead letter entry not found');
      const result = await client.query<StoredJob>(
        `UPDATE jobs SET status='pending',attempts=0,
        execution_cycle=execution_cycle+1,scheduling_generation=scheduling_generation+1,result=NULL,error=NULL,
        locked_by=NULL,locked_until=NULL,lease_token=NULL,available_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE id=$1 AND status='dead' AND execution_cycle=$2 RETURNING *`,
        [dead.original_job_id, dead.execution_cycle],
      );
      if (!result.rows[0]) throw new QueueError('CONFLICT', 'Job is no longer eligible for replay');
      await client.query(
        'UPDATE dead_letters SET active=FALSE,replayed_at=clock_timestamp() WHERE id=$1',
        [id],
      );
      await schedule(client, result.rows[0]);
      await audit(client, 'dlq_replay', dead.original_job_id, {
        deadLetterId: id,
        actor,
        cycle: result.rows[0].execution_cycle,
      });
      return result.rows[0];
    });
  }

  async getJob(id: string) {
    return (
      (await this.pool.query<StoredJob>('SELECT * FROM jobs WHERE id=$1', [id])).rows[0] ?? null
    );
  }
  async listJobs(filters: JobFilters) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      values.push(value);
      conditions.push(sql.replace('?', `$${values.length}`));
    };
    if (filters.queue_name) add('queue_name=?', filters.queue_name);
    if (filters.queues) add('queue_name=ANY(?::text[])', filters.queues);
    if (filters.status) add('status=?', filters.status);
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const count = await this.pool.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM jobs ${where}`,
      values,
    );
    const result = await this.pool.query<StoredJob>(
      `SELECT * FROM jobs ${where} ORDER BY created_at DESC,id DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, filters.limit ?? 50, filters.offset ?? 0],
    );
    return { jobs: result.rows, total: count.rows[0].total };
  }
  async listDeadLetters(limit = 50, offset = 0) {
    const [items, total] = await Promise.all([
      this.pool.query<DeadLetter>(
        'SELECT * FROM dead_letters WHERE active ORDER BY moved_at DESC,id DESC LIMIT $1 OFFSET $2',
        [limit, offset],
      ),
      this.pool.query<{ total: number }>(
        'SELECT count(*)::int AS total FROM dead_letters WHERE active',
      ),
    ]);
    return { items: items.rows, total: total.rows[0].total };
  }

  async reserveOutbox(limit: number, leaseMs: number): Promise<OutboxEntry[]> {
    return transaction(
      this.pool,
      async (client) =>
        (
          await client.query<OutboxEntry>(
            `WITH batch AS (
      SELECT id FROM dispatch_outbox WHERE published_at IS NULL AND retry_at<=clock_timestamp()
      AND (reserved_until IS NULL OR reserved_until<clock_timestamp()) ORDER BY created_at,id LIMIT $1 FOR UPDATE SKIP LOCKED
    ) UPDATE dispatch_outbox o SET reservation_token=gen_random_uuid(),reserved_until=clock_timestamp()+$2*INTERVAL '1 millisecond',
      publish_attempts=publish_attempts+1 FROM batch WHERE o.id=batch.id RETURNING o.*`,
            [limit, leaseMs],
          )
        ).rows,
    );
  }
  async finishOutbox(entry: OutboxEntry) {
    await this.pool.query(
      `UPDATE dispatch_outbox SET published_at=clock_timestamp(),reserved_until=NULL,reservation_token=NULL,last_error=NULL
      WHERE id=$1 AND reservation_token=$2 AND reserved_until>clock_timestamp()`,
      [entry.id, entry.reservation_token],
    );
  }
  async retryOutbox(entry: OutboxEntry, delayMs: number, error: string) {
    await this.pool.query(
      `UPDATE dispatch_outbox SET retry_at=clock_timestamp()+$1*INTERVAL '1 millisecond',
      last_error=$2,reservation_token=NULL,reserved_until=NULL WHERE id=$3 AND reservation_token=$4`,
      [delayMs, error.slice(0, 8192), entry.id, entry.reservation_token],
    );
  }
  async recoverExpired(limit: number): Promise<number> {
    return transaction(this.pool, async (client) => {
      const expired = await client.query<StoredJob>(
        `SELECT * FROM jobs WHERE
        (status='processing' AND locked_until<clock_timestamp()) OR (status='pending' AND attempts>=max_attempts)
        ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`,
        [limit],
      );
      for (const job of expired.rows) {
        await this.settleFailure(
          client,
          job,
          'Execution lease expired or attempt budget exhausted',
          computeBackoff(
            Math.max(0, job.attempts - 1),
            this.retryPolicy.baseMs,
            this.retryPolicy.capMs,
          ),
          'lease_expired',
        );
      }
      return expired.rows.length;
    });
  }
  async pendingPage(afterId: string | null, limit: number) {
    return (
      await this.pool.query<StoredJob>(
        `SELECT * FROM jobs WHERE status='pending'
      AND ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT $2`,
        [afterId, limit],
      )
    ).rows;
  }
  async heartbeat(workerId: string, active: number) {
    await this.pool.query(
      `INSERT INTO worker_heartbeats(worker_id,jobs_in_flight) VALUES($1,$2)
      ON CONFLICT(worker_id) DO UPDATE SET last_seen_at=clock_timestamp(),jobs_in_flight=$2`,
      [workerId, active],
    );
  }
  async metrics(): Promise<MetricsSnapshot> {
    const [queues, attempts, lag, workers] = await Promise.all([
      this.pool.query<{
        name: string;
        ready: number;
        delayed: number;
        processing: number;
        dead: number;
      }>(`SELECT queue_name AS name,
        count(*) FILTER(WHERE status='pending' AND available_at<=clock_timestamp())::int AS ready,
        count(*) FILTER(WHERE status='pending' AND available_at>clock_timestamp())::int AS delayed,
        count(*) FILTER(WHERE status='processing')::int AS processing,count(*) FILTER(WHERE status='dead')::int AS dead
        FROM jobs GROUP BY queue_name ORDER BY queue_name`),
      this.pool.query<{
        retries: number;
        total: number;
        completed: number;
      }>(`SELECT count(*) FILTER(WHERE attempt>1 AND history_complete)::int AS retries,
        count(*) FILTER(WHERE history_complete)::int AS total,
        count(*) FILTER(WHERE outcome='completed' AND finished_at>clock_timestamp()-INTERVAL '1 minute')::int AS completed FROM job_attempts`),
      this.pool.query<{ lag: number }>(
        `SELECT COALESCE(EXTRACT(EPOCH FROM clock_timestamp()-min(created_at)),0)::float AS lag FROM dispatch_outbox WHERE published_at IS NULL`,
      ),
      this.pool.query<{
        id: string;
        jobsInFlight: number;
        status: 'alive' | 'dead';
        lastSeen: Date;
      }>(`SELECT worker_id AS id,jobs_in_flight AS "jobsInFlight",
        CASE WHEN last_seen_at<clock_timestamp()-INTERVAL '30 seconds' THEN 'dead' ELSE 'alive' END AS status,
        last_seen_at AS "lastSeen" FROM worker_heartbeats ORDER BY worker_id`),
    ]);
    const sum = (field: 'ready' | 'delayed' | 'processing' | 'dead') =>
      queues.rows.reduce((n, q) => n + q[field], 0);
    const a = attempts.rows[0];
    return {
      timestamp: new Date().toISOString(),
      queueDepth: sum('ready') + sum('delayed'),
      jobsPerSecond: (a.completed / 60).toFixed(2),
      dlqSize: sum('dead'),
      retryRate: (a.total ? (a.retries / a.total) * 100 : 0).toFixed(1) + '%',
      retries: a.retries,
      ready: sum('ready'),
      delayed: sum('delayed'),
      processing: sum('processing'),
      dead: sum('dead'),
      dispatchLagSeconds: lag.rows[0].lag,
      queues: queues.rows,
      workers: workers.rows,
    };
  }
}
