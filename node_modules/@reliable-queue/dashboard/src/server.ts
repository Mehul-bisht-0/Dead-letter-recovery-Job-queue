// ---------------------------------------------------------------------------
// Dashboard server — serves metrics API, SSE, and static frontend
// ---------------------------------------------------------------------------

import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { loadConfig, getPool, getRedis, migrate, QueueService, closePool, closeRedis } from '@reliable-queue/core';
import { registerMetricsRoutes } from './routes/metrics';
import { registerDLQRoutes } from './routes/dlq';

async function main() {
  const config = loadConfig({ port: parseInt(process.env.PORT || '3001', 10) });

  await migrate(config);

  const pool = getPool(config);
  const redis = getRedis(config);
  const queueService = new QueueService(pool, redis);

  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

  // Serve static HTML frontend
  await app.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'public'),
    prefix: '/',
  });

  // Register API routes
  registerMetricsRoutes(app, queueService, pool);
  registerDLQRoutes(app, queueService);

  // Start listening
  await app.listen({ host: config.host, port: config.port });
  console.log(`[dashboard] Server listening on ${config.host}:${config.port}`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[dashboard] Shutting down...');
    await app.close();
    await closeRedis();
    await closePool();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[dashboard] Fatal error:', err);
  process.exit(1);
});
