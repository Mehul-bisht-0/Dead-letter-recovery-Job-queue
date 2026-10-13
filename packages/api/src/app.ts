import Fastify, { type FastifyInstance, type FastifyError, type FastifyBaseLogger } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import { QueueError, type QueueService } from '@reliable-queue/core';
import { httpFailure, ErrorSchema } from '@reliable-queue/contracts';
import {
  createLogger,
  type AuthStore,
  type Principal,
  type Telemetry,
} from '@reliable-queue/infrastructure';
import { registerJobRoutes } from './routes/jobs';
import { registerDLQRoutes } from './routes/dlq';
declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal | null;
  }
}
export interface ApiDependencies {
  queue: QueueService;
  auth: Pick<AuthStore, 'authenticate'>;
  ready: () => Promise<void>;
  telemetry: Telemetry;
  corsOrigins?: string[];
  trustProxy?: boolean;
}
export function installErrors(app: FastifyInstance) {
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const failure = httpFailure(error, request.id);
    if (failure.status >= 500) request.log.error({ err: error }, 'Request failed');
    return reply.code(failure.status).send(failure.body);
  });
}
export async function createApp(deps: ApiDependencies) {
  const app = Fastify({
    loggerInstance: createLogger('api') as FastifyBaseLogger,
    bodyLimit: 1024 * 1024,
    trustProxy: deps.trustProxy ?? false,
    requestTimeout: 10000,
  });
  app.decorateRequest('principal', null);
  installErrors(app);
  await app.register(cors, { origin: deps.corsOrigins ?? [] });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute', cache: 10000 });
  app.addHook('onRoute', (route) => {
    if (route.url.startsWith('/health')) return;
    const responses = route.schema?.response;
    route.schema = {
      ...route.schema,
      response: {
        ...(responses && typeof responses === 'object' ? responses : {}),
        400: ErrorSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        409: ErrorSchema,
        429: ErrorSchema,
        503: ErrorSchema,
      },
    };
  });
  await app.register(swagger, {
    openapi: {
      info: { title: 'Reliable Queue', version: '2.0.0' },
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
      security: [{ bearerAuth: [] }],
    },
  });
  app.addHook('onRequest', async (request) => {
    const path = request.routeOptions.url ?? request.url.split('?')[0];
    if (!['/health', '/health/live', '/health/ready'].includes(path))
      request.principal = await deps.auth.authenticate(request.headers.authorization);
  });
  app.addHook('onResponse', async (_request, reply) => {
    deps.telemetry.httpDuration.observe(reply.elapsedTime / 1000);
  });
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));
  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_request, reply) => {
    try {
      await deps.ready();
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
  registerJobRoutes(app, deps.queue);
  registerDLQRoutes(app, deps.queue);
  app.get('/openapi.json', async () => app.swagger());
  app.get('/metrics', async (request, reply) => {
    if (request.principal?.role !== 'administrator')
      throw new QueueError('FORBIDDEN', 'Administrator access required');
    deps.telemetry.snapshot(await deps.queue.metrics());
    return reply
      .type(deps.telemetry.registry.contentType)
      .send(await deps.telemetry.registry.metrics());
  });
  app.get('/diagnostics', async (request) => {
    if (request.principal?.role !== 'administrator')
      throw new QueueError('FORBIDDEN', 'Administrator access required');
    return deps.queue.metrics();
  });
  return app;
}
