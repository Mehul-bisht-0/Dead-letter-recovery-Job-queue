import { Pool } from 'pg';
import Redis from 'ioredis';
import { Job, DeadLetter, EnqueueOptions, EnqueueResult } from './types';
export declare class QueueService {
    private pool;
    private redis;
    constructor(pool: Pool, redis: Redis);
    enqueue(options: EnqueueOptions): Promise<EnqueueResult>;
    claim(queueName: string, workerId: string, visibilityTimeoutMs: number): Promise<Job | null>;
    ack(jobId: string, resultData?: Record<string, unknown>): Promise<void>;
    nack(jobId: string, errorMessage: string, backoffBaseMs?: number, backoffCapMs?: number): Promise<'retried' | 'dead-lettered'>;
    private moveToDLQ;
    replayFromDLQ(dlqId: string): Promise<Job>;
    requeueStaleJobs(): Promise<number>;
    getJob(jobId: string): Promise<Job | null>;
    listJobs(filters: {
        queue_name?: string;
        status?: string;
        limit?: number;
        offset?: number;
    }): Promise<{
        jobs: Job[];
        total: number;
    }>;
    listDeadLetters(limit?: number, offset?: number): Promise<{
        items: DeadLetter[];
        total: number;
    }>;
    /** Get the depth (number of entries) in a Redis queue sorted set */
    getQueueDepth(queueName: string): Promise<number>;
}
