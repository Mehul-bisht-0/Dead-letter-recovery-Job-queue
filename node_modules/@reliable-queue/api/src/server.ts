// ---------------------------------------------------------------------------
// Fastify API server — entry point for the HTTP API service
// ---------------------------------------------------------------------------

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { loadConfig, getPool, getRedis, migrate, QueueService, closePool, closeRedis } from '@reliable-queue/core';
import { registerJobRoutes } from './routes/jobs';
import { registerDLQRoutes } from './routes/dlq';

async function main() {
  const config = loadConfig();

  // Run schema migration before starting the server
  await migrate(config);

  const pool = getPool(config);
  const redis = getRedis(config);
  const queueService = new QueueService(pool, redis);

  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

  // Health check
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // Register route modules
  registerJobRoutes(app, queueService);
  registerDLQRoutes(app, queueService);

  // Start listening
  await app.listen({ host: config.host, port: config.port });
  console.log(`[api] Server listening on ${config.host}:${config.port}`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[api] Shutting down...');
    await app.close();
    await closeRedis();
    await closePool();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[api] Fatal error:', err);
  process.exit(1);
});
