// ---------------------------------------------------------------------------
// Metrics API & SSE (Server-Sent Events) for real-time dashboard updates
// ---------------------------------------------------------------------------

import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { QueueService } from '@reliable-queue/core';

export function registerMetricsRoutes(app: FastifyInstance, queue: QueueService, pool: Pool) {
  
  async function gatherMetrics() {
    // 1. Queue depth from Redis (fast)
    const queueDepth = await queue.getQueueDepth('default'); // Expand to all known queues later

    // 2. Postgres stats (run concurrently)
    const [statsResult, workersResult] = await Promise.all([
      pool.query(`
        SELECT 
          COUNT(*) FILTER (WHERE status = 'completed' AND updated_at > NOW() - INTERVAL '1 minute') AS completed_last_minute,
          COUNT(*) FILTER (WHERE status = 'dead') AS dlq_size,
          COUNT(*) FILTER (WHERE attempts > 0) AS total_retries,
          COUNT(*) AS total_jobs
        FROM jobs
      `),
      pool.query(`
        SELECT worker_id, last_seen_at, jobs_in_flight,
               (NOW() - last_seen_at > INTERVAL '30 seconds') as is_dead
        FROM worker_heartbeats
        ORDER BY last_seen_at DESC
      `)
    ]);

    const stats = statsResult.rows[0];
    
    return {
      timestamp: new Date().toISOString(),
      queueDepth,
      jobsPerSecond: (parseInt(stats.completed_last_minute, 10) / 60).toFixed(2),
      dlqSize: parseInt(stats.dlq_size, 10),
      retryRate: parseInt(stats.total_jobs, 10) > 0 
        ? ((parseInt(stats.total_retries, 10) / parseInt(stats.total_jobs, 10)) * 100).toFixed(1) + '%'
        : '0%',
      workers: workersResult.rows.map(w => ({
        id: w.worker_id,
        jobsInFlight: w.jobs_in_flight,
        status: w.is_dead ? 'dead' : 'alive',
        lastSeen: w.last_seen_at
      }))
    };
  }

  // REST endpoint
  app.get('/api/metrics', async (request, reply) => {
    return gatherMetrics();
  });

  // SSE endpoint for live updates
  app.get('/api/metrics/stream', async (request, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');

    // Send initial data
    const initialMetrics = await gatherMetrics();
    reply.raw.write(`data: ${JSON.stringify(initialMetrics)}\n\n`);

    // Poll every 2 seconds
    const interval = setInterval(async () => {
      try {
        const metrics = await gatherMetrics();
        reply.raw.write(`data: ${JSON.stringify(metrics)}\n\n`);
      } catch (err) {
        console.error('[dashboard] Error gathering metrics for SSE:', err);
      }
    }, 2000);

    request.raw.on('close', () => {
      clearInterval(interval);
    });
  });
}
