import { createServer } from 'node:http';
import type { Runtime } from './runtime';
import { QueueError } from '@reliable-queue/core';
export async function startMonitor(runtime: Runtime, ready: () => boolean) {
  const server = createServer((request, response) => {
    void (async () => {
      if (request.url === '/health/live') {
        response.end(JSON.stringify({ status: 'ok' }));
        return;
      }
      if (request.url === '/health/ready') {
        await runtime.pool.query('SELECT 1');
        await runtime.dispatch.ping();
        response.statusCode = ready() ? 200 : 503;
        response.end(JSON.stringify({ status: ready() ? 'ok' : 'draining' }));
        return;
      }
      const principal = await runtime.auth.authenticate(request.headers.authorization);
      if (principal.role !== 'administrator') {
        response.statusCode = 403;
        response.end();
        return;
      }
      if (request.url !== '/metrics') {
        response.statusCode = 404;
        response.end();
        return;
      }
      runtime.telemetry.snapshot(await runtime.jobs.metrics());
      response.setHeader('Content-Type', runtime.telemetry.registry.contentType);
      response.end(await runtime.telemetry.registry.metrics());
    })().catch((error) => {
      runtime.logger.warn({ err: error }, 'Monitor request failed');
      response.statusCode =
        error instanceof QueueError ? (error.code === 'UNAUTHORIZED' ? 401 : 403) : 503;
      response.end(JSON.stringify({ status: 'unavailable' }));
    });
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(runtime.config.port, runtime.config.host, resolve);
  });
  return () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
}
