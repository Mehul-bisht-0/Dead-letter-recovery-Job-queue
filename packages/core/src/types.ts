// ---------------------------------------------------------------------------
// Core type definitions for the reliable-queue system
// ---------------------------------------------------------------------------

/** Possible states a job moves through during its lifecycle */
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'dead';

/** A job record as stored in the PostgreSQL `jobs` table */
export interface Job {
  id: string;
  queue_name: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  priority: number;
  attempts: number;
  max_attempts: number;
  created_at: Date;
  updated_at: Date;
  available_at: Date;
  locked_by: string | null;
  locked_until: Date | null;
  idempotency_key: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
}

/** A dead letter entry — a job that exhausted all retry attempts */
export interface DeadLetter {
  id: string;
  original_job_id: string;
  queue_name: string;
  payload: Record<string, unknown>;
  failure_reason: string | null;
  failure_history: Array<{ attempt: number; error: string; failed_at: string }>;
  moved_at: Date;
}

/** Worker heartbeat row used by the dashboard to show live/dead workers */
export interface WorkerHeartbeat {
  worker_id: string;
  last_seen_at: Date;
  jobs_in_flight: number;
}

/** Audit log entry for tracking replays, state transitions, etc. */
export interface AuditEntry {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  created_at: Date;
}

/** Options accepted by the enqueue endpoint / QueueService.enqueue() */
export interface EnqueueOptions {
  queue_name: string;
  payload: Record<string, unknown>;
  priority?: number; // 1 (lowest) – 10 (highest), default 5
  delay_ms?: number; // schedule the job N ms into the future
  max_attempts?: number; // default 3
  idempotency_key?: string;
}

/** Result of an enqueue operation — includes whether a new job was created */
export interface EnqueueResult {
  job: Job;
  created: boolean; // false when deduped via idempotency key
}

/** Handler function executed by the worker for each job */
export interface Logger {
  info(details: Record<string, unknown>, message: string): void;
  warn(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}
export interface HandlerContext {
  signal: AbortSignal;
  attemptId: string;
  executionCycle: number;
  logger: Logger;
}
export type JobHandler = (
  job: Job,
  context: HandlerContext,
) => Promise<Record<string, unknown> | void>;
export interface StoredJob extends Job {
  scheduling_generation: number;
  execution_cycle: number;
  lease_token: string | null;
  history_complete: boolean;
}
export interface Candidate {
  jobId: string;
  generation: number;
  queueName: string;
}
export interface Claim {
  job: StoredJob;
  token: string;
  attemptId: string;
}
export interface JobFilters {
  queue_name?: string;
  queues?: string[];
  status?: JobStatus;
  limit?: number;
  offset?: number;
}
export interface OutboxEntry {
  id: string;
  reservation_token: string;
  job_id: string;
  queue_name: string;
  generation: number;
  priority: number;
  available_at: Date;
  publish_attempts: number;
}
export interface MetricsSnapshot {
  timestamp: string;
  queueDepth: number;
  jobsPerSecond: string;
  dlqSize: number;
  retryRate: string;
  retries: number;
  ready: number;
  delayed: number;
  processing: number;
  dead: number;
  dispatchLagSeconds: number;
  queues: Array<{ name: string; ready: number; delayed: number; processing: number; dead: number }>;
  workers: Array<{ id: string; jobsInFlight: number; status: 'alive' | 'dead'; lastSeen: Date }>;
}
