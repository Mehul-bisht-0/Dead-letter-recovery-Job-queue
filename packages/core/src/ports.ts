import type {
  Candidate,
  Claim,
  EnqueueOptions,
  EnqueueResult,
  Job,
  JobFilters,
  DeadLetter,
  OutboxEntry,
  MetricsSnapshot,
  StoredJob,
} from './types';
export interface LifecycleRepository {
  enqueue(options: EnqueueOptions): Promise<EnqueueResult>;
  claim(candidate: Candidate, workerId: string, visibilityMs: number): Promise<Claim | null>;
  renew(claim: Claim, visibilityMs: number): Promise<boolean>;
  complete(claim: Claim, result?: Record<string, unknown>): Promise<void>;
  fail(claim: Claim, error: string, delayMs: number): Promise<'retried' | 'dead-lettered'>;
  replay(id: string, actor: string): Promise<Job>;
}
export interface QueryRepository {
  getJob(id: string): Promise<Job | null>;
  listJobs(filters: JobFilters): Promise<{ jobs: Job[]; total: number }>;
  listDeadLetters(limit: number, offset: number): Promise<{ items: DeadLetter[]; total: number }>;
  metrics(): Promise<MetricsSnapshot>;
}
export interface DispatchIndex {
  publish(
    job: Pick<
      StoredJob,
      'id' | 'queue_name' | 'priority' | 'available_at' | 'scheduling_generation'
    >,
  ): Promise<void>;
  take(queue: string): Promise<Candidate | null>;
  ping(): Promise<void>;
}
export interface MaintenanceRepository {
  reserveOutbox(limit: number, leaseMs: number): Promise<OutboxEntry[]>;
  finishOutbox(entry: OutboxEntry): Promise<void>;
  retryOutbox(entry: OutboxEntry, delayMs: number, error: string): Promise<void>;
  recoverExpired(limit: number): Promise<number>;
  pendingPage(afterId: string | null, limit: number): Promise<StoredJob[]>;
  heartbeat(workerId: string, active: number): Promise<void>;
}
