import { Pool } from 'pg';
export declare class HeartbeatService {
    private pool;
    private workerId;
    private intervalMs;
    private getJobsInFlight;
    private timer;
    constructor(pool: Pool, workerId: string, intervalMs: number, getJobsInFlight: () => number);
    start(): void;
    stop(): void;
    private beat;
}
