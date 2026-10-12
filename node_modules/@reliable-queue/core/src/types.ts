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
  priority?: number;       // 1 (lowest) – 10 (highest), default 5
  delay_ms?: number;       // schedule the job N ms into the future
  max_attempts?: number;   // default 3
  idempotency_key?: string;
}

/** Result of an enqueue operation — includes whether a new job was created */
export interface EnqueueResult {
  job: Job;
  created: boolean;        // false when deduped via idempotency key
}

/** Handler function executed by the worker for each job */
export type JobHandler = (job: Job) => Promise<Record<string, unknown> | void>;
