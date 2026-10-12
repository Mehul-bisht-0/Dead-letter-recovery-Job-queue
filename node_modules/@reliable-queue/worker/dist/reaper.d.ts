import Redis from 'ioredis';
import { QueueService } from '@reliable-queue/core';
export declare class ReaperService {
    private redis;
    private queueService;
    private workerId;
    private intervalMs;
    private lockTtlMs;
    private timer;
    private renewTimer;
    private isLeader;
    constructor(redis: Redis, queueService: QueueService, workerId: string, intervalMs: number, lockTtlMs: number);
    start(): void;
    stop(): void;
    private tryAcquireLeadership;
    /**
     * Renew the leader lock at ttl/3 intervals — well before it expires.
     * If renewal fails (e.g., another process grabbed the lock), step down.
     */
    private startRenewal;
    private reap;
    private releaseLock;
}
