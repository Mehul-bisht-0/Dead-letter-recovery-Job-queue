// ---------------------------------------------------------------------------
// Worker heartbeat — periodically writes to worker_heartbeats table
// ---------------------------------------------------------------------------
//
// The dashboard uses this table to determine which workers are alive.
// If last_seen_at is older than ~30 seconds, the dashboard marks the
// worker as "dead" (it may have crashed or been scaled down).
// ---------------------------------------------------------------------------

import { Pool } from 'pg';

export class HeartbeatService {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private pool: Pool,
    private workerId: string,
    private intervalMs: number,
    private getJobsInFlight: () => number,
  ) {}

  start(): void {
    // Send an initial heartbeat immediately
    this.beat();

    this.timer = setInterval(() => {
      this.beat();
    }, this.intervalMs);

    // Don't let the heartbeat timer keep the process alive during shutdown
    if (this.timer.unref) {
      this.timer.unref();
    }

    console.log(`[heartbeat] Started (every ${this.intervalMs}ms)`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[heartbeat] Stopped');
    }
  }

  private async beat(): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO worker_heartbeats (worker_id, last_seen_at, jobs_in_flight)
         VALUES ($1, NOW(), $2)
         ON CONFLICT (worker_id)
         DO UPDATE SET last_seen_at = NOW(), jobs_in_flight = $2`,
        [this.workerId, this.getJobsInFlight()],
      );
    } catch (err: any) {
      // Non-fatal — if a single heartbeat fails, the next one will retry
      console.error('[heartbeat] Failed to write:', err.message);
    }
  }
}
