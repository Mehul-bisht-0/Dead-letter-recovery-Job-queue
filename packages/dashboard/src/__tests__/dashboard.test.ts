import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { Telemetry, hashPassword } from '@reliable-queue/infrastructure';
import { mocks, job, logger } from '../../../../tests/helpers';
import { createDashboard } from '../app';
import { MetricsSampler } from '../metrics';
describe('Dashboard security and sampling', () => {
  it('ends live SSE responses and releases timers when the server closes', async () => {
    const state = mocks(),
      telemetry = new Telemetry();
    const app = await createDashboard({
      queue: state.queue,
      auth: {
        session: async () => true,
        createSession: async () => ({ token: 'session', csrf: 'csrf' }),
        deleteSession: async () => {},
      },
      config: { environment: 'test', adminUser: 'admin', adminPasswordHash: '', trustProxy: false },
      ready: async () => {},
      telemetry,
    });
    await app.ready();
    const stream = app
      .inject({ url: '/api/metrics/stream', headers: { cookie: 'rq_session=session' } })
      .then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await app.close();
    const response = await stream;
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(': connected');
    telemetry.registry.clear();
  });
  it('requires login, issues protected cookies and enforces CSRF', async () => {
    const state = mocks(),
      telemetry = new Telemetry();
    let valid = false;
    const auth = {
      session: vi.fn(
        async (token, csrf) =>
          valid && token === 'session' && (csrf === undefined || csrf === 'csrf'),
      ),
      createSession: vi.fn(async () => {
        valid = true;
        return { token: 'session', csrf: 'csrf' };
      }),
      deleteSession: vi.fn(async () => {
        valid = false;
      }),
    };
    const app = await createDashboard({
      queue: state.queue,
      auth,
      config: {
        environment: 'production',
        adminUser: 'admin',
        adminPasswordHash: hashPassword('correct horse battery staple'),
        trustProxy: false,
      },
      ready: async () => {},
      telemetry,
    });
    try {
      expect((await app.inject('/api/dlq')).statusCode).toBe(401);
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'admin', password: 'correct horse battery staple' },
      });
      expect(login.statusCode).toBe(200);
      expect(login.cookies.find((c) => c.name === 'rq_session')).toMatchObject({
        httpOnly: true,
        secure: true,
        sameSite: 'Strict',
      });
      const cookie = 'rq_session=session';
      const id = job().id;
      expect(
        (await app.inject({ method: 'POST', url: `/api/dlq/${id}/replay`, headers: { cookie } }))
          .statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/dlq/${id}/replay`,
            headers: { cookie, 'x-csrf-token': 'csrf' },
          })
        ).json().success,
      ).toBe(true);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/auth/logout',
            headers: { cookie, 'x-csrf-token': 'csrf' },
          })
        ).statusCode,
      ).toBe(200);
      expect((await app.inject({ url: '/api/auth/session', headers: { cookie } })).statusCode).toBe(
        401,
      );
    } finally {
      await app.close();
      telemetry.registry.clear();
    }
  });
  it('never bypasses session checks through alternate API URL encodings', async () => {
    const state = mocks(),
      telemetry = new Telemetry();
    const app = await createDashboard({
      queue: state.queue,
      auth: {
        session: async () => false,
        createSession: async () => ({ token: '', csrf: '' }),
        deleteSession: async () => {},
      },
      config: { environment: 'test', adminUser: 'admin', adminPasswordHash: '', trustProxy: false },
      ready: async () => {},
      telemetry,
    });
    try {
      for (const url of ['/api/dlq', '/%61pi/dlq', '/api%2fdlq', '/api/../api/dlq']) {
        const response = await app.inject(url);
        expect([400, 401, 404]).toContain(response.statusCode);
      }
    } finally {
      await app.close();
      telemetry.registry.clear();
    }
  });
  it('shares one sampler across subscribers and waits for an active sample on shutdown', async () => {
    const state = mocks();
    let finish!: (value: Awaited<ReturnType<typeof state.queue.metrics>>) => void;
    const snapshot = await state.queue.metrics();
    const gather = vi.fn(
      () =>
        new Promise<typeof snapshot>((resolve) => {
          finish = resolve;
        }),
    );
    const sampler = new MetricsSampler(gather, logger);
    const first = vi.fn(),
      second = vi.fn();
    sampler.subscribe(first);
    sampler.subscribe(second);
    sampler.start();
    expect(gather).toHaveBeenCalledTimes(1);
    let stopped = false;
    const stop = sampler.stop().then(() => {
      stopped = true;
    });
    expect(stopped).toBe(false);
    finish(snapshot);
    await stop;
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
  it('renders hostile worker and DLQ text without creating executable elements', async () => {
    const html = readFileSync(join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');
    const script = readFileSync(join(__dirname, '..', '..', 'public', 'dashboard.js'), 'utf8');
    const dom = new JSDOM(html, { url: 'https://localhost', runScripts: 'outside-only' });
    const malicious = '<img src=x onerror="window.compromised=true">';
    Object.defineProperty(dom.window, 'fetch', {
      value: async (path: string) => ({
        ok: true,
        status: 200,
        json: async () =>
          path === '/api/dlq'
            ? {
                items: [
                  {
                    id: job().id,
                    original_job_id: job().id,
                    queue_name: malicious,
                    failure_reason: malicious,
                    moved_at: new Date().toISOString(),
                  },
                ],
              }
            : { authenticated: true },
      }),
    });
    const sources: EventSourceMock[] = [];
    class EventSourceMock {
      constructor() {
        sources.push(this);
      }
      onopen?: () => void;
      onerror?: () => void;
      onmessage?: (event: { data: string }) => void;
      close() {}
    }
    Object.defineProperty(dom.window, 'EventSource', { value: EventSourceMock });
    dom.window.eval(script);
    await vi.waitFor(() =>
      expect(dom.window.document.querySelector('#dlqTable tbody')!.textContent).toContain(
        malicious,
      ),
    );
    sources[0].onmessage!({
      data: JSON.stringify({
        queueDepth: 0,
        jobsPerSecond: '0',
        retryRate: '0%',
        dlqSize: 1,
        workers: [
          { id: malicious, status: 'alive', jobsInFlight: 0, lastSeen: new Date().toISOString() },
        ],
      }),
    });
    expect(dom.window.document.querySelectorAll('img')).toHaveLength(0);
    dom.window.close();
  });
});
