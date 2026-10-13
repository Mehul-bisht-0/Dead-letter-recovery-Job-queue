import Fastify, { type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import staticFiles from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import { join } from 'node:path';
import { Type } from '@sinclair/typebox';
import { QueueError, type QueueService } from '@reliable-queue/core';
import {
  createLogger,
  verifyPassword,
  type AuthStore,
  type Config,
  type Telemetry,
} from '@reliable-queue/infrastructure';
import {
  httpFailure,
  IdParams,
  Pagination,
  DLQEnvelope,
  JobSchema,
  serializeJob,
  serializeDeadLetter,
} from '@reliable-queue/contracts';
import { MetricsSampler } from './metrics';
export interface DashboardDependencies {
  queue: QueueService;
  auth: Pick<AuthStore, 'session' | 'createSession' | 'deleteSession'>;
  config: Pick<Config, 'environment' | 'adminUser' | 'adminPasswordHash' | 'trustProxy'>;
  ready: () => Promise<void>;
  telemetry: Telemetry;
}
export async function createDashboard(deps: DashboardDependencies) {
  const logger = createLogger('dashboard');
  const app = Fastify({
    loggerInstance: logger,
    bodyLimit: 1024 * 1024,
    trustProxy: deps.config.trustProxy,
    requestTimeout: 10000,
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute', cache: 10000 });
  await app.register(staticFiles, { root: join(__dirname, '..', 'public') });
  const sampler = new MetricsSampler(async () => {
    const metrics = await deps.queue.metrics();
    deps.telemetry.snapshot(metrics);
    return metrics;
  }, logger);
  const streams = new Set<() => void>();
  app.addHook('onReady', async () => sampler.start());
  app.addHook('preClose', async () => {
    for (const close of streams) close();
    await sampler.stop();
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; frame-ancestors 'none'",
    );
    const route = request.routeOptions.url ?? request.url.split('?')[0];
    if ((route.startsWith('/api/') || route === '/metrics') && route !== '/api/auth/login') {
      const token = request.cookies.rq_session;
      if (!(await deps.auth.session(token)))
        throw new QueueError('UNAUTHORIZED', 'Administrator login required');
      if (!['GET', 'HEAD'].includes(request.method)) {
        const csrf = request.headers['x-csrf-token'];
        if (typeof csrf !== 'string' || !(await deps.auth.session(token, csrf)))
          throw new QueueError('FORBIDDEN', 'Invalid CSRF token');
      }
    }
  });
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const failure = httpFailure(error, request.id);
    if (failure.status >= 500) request.log.error({ err: error }, 'Dashboard request failed');
    return reply.code(failure.status).send({ success: false, ...failure.body });
  });
  app.post<{ Body: { username: string; password: string } }>(
    '/api/auth/login',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        body: Type.Object({
          username: Type.String({ maxLength: 255 }),
          password: Type.String({ maxLength: 1024 }),
        }),
      },
    },
    async (request, reply) => {
      // Always verify the password, even when the account name is incorrect.
      const valid = verifyPassword(request.body.password, deps.config.adminPasswordHash);
      if (!valid || request.body.username !== deps.config.adminUser)
        throw new QueueError('UNAUTHORIZED', 'Invalid credentials');
      await deps.auth.deleteSession(request.cookies.rq_session);
      const session = await deps.auth.createSession();
      const options = {
        path: '/',
        secure: deps.config.environment === 'production',
        sameSite: 'strict' as const,
        maxAge: 8 * 60 * 60,
      };
      reply.setCookie('rq_session', session.token, { ...options, httpOnly: true });
      reply.setCookie('rq_csrf', session.csrf, { ...options, httpOnly: false });
      return { authenticated: true };
    },
  );
  app.get('/api/auth/session', async () => ({ authenticated: true }));
  app.post('/api/auth/logout', async (request, reply) => {
    await deps.auth.deleteSession(request.cookies.rq_session);
    reply.clearCookie('rq_session', { path: '/' });
    reply.clearCookie('rq_csrf', { path: '/' });
    return { success: true };
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
  app.get('/api/metrics', async () => sampler.latest ?? deps.queue.metrics());
  app.get('/api/metrics/stream', async (request, reply) => {
    if (streams.size >= 100) return reply.code(503).send({ error: 'Too many live connections' });
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    reply.raw.write(': connected\n\n');
    let closed = false,
      remove = () => {};
    let sessionCheck: ReturnType<typeof setInterval> | undefined;
    const close = () => {
      if (closed) return;
      closed = true;
      remove();
      if (sessionCheck) clearInterval(sessionCheck);
      streams.delete(close);
      reply.raw.end();
    };
    streams.add(close);
    reply.raw.on('close', close);
    remove = sampler.subscribe((snapshot) => {
      try {
        if (!closed && !reply.raw.write(`data: ${JSON.stringify(snapshot)}\n\n`)) close();
      } catch {
        close();
      }
    });
    if (closed) remove();
    else
      sessionCheck = setInterval(() => {
        void deps.auth
          .session(request.cookies.rq_session)
          .then((valid) => {
            if (!valid) close();
          })
          .catch(() => close());
      }, 30000);
  });
  app.get<{ Querystring: { limit?: number; offset?: number } }>(
    '/api/dlq',
    { schema: { querystring: Pagination, response: { 200: DLQEnvelope } } },
    async (request) => {
      const result = await deps.queue.listDeadLetters(
        request.query.limit ?? 20,
        request.query.offset ?? 0,
      );
      return { items: result.items.map(serializeDeadLetter), total: result.total };
    },
  );
  app.post<{ Params: { id: string } }>(
    '/api/dlq/:id/replay',
    {
      schema: {
        params: IdParams,
        response: { 200: Type.Object({ success: Type.Boolean(), job: JobSchema }) },
      },
    },
    async (request) => ({
      success: true,
      job: serializeJob(
        await deps.queue.replayFromDLQ(request.params.id, `dashboard:${deps.config.adminUser}`),
      ),
    }),
  );
  app.get('/metrics', async (_request, reply) => {
    deps.telemetry.snapshot(await deps.queue.metrics());
    return reply
      .type(deps.telemetry.registry.contentType)
      .send(await deps.telemetry.registry.metrics());
  });
  return app;
}
