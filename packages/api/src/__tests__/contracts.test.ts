import { describe, it, expect, vi } from 'vitest';
import { QueueError } from '@reliable-queue/core';
import { Telemetry } from '@reliable-queue/infrastructure';
import { mocks, job } from '../../../../tests/helpers';
import { createApp } from '../app';
import fixture from '../../../../tests/fixtures/enqueue.json';
async function setup(role: 'producer' | 'administrator' = 'administrator') {
  const state = mocks(),
    telemetry = new Telemetry();
  const app = await createApp({
    queue: state.queue,
    auth: {
      authenticate: vi.fn(async (header) => {
        if (!header) throw new QueueError('UNAUTHORIZED', 'Valid bearer API key required');
        return { id: 'test', role, queues: ['default'] };
      }),
    },
    ready: async () => {},
    telemetry,
  });
  return { ...state, app, telemetry };
}
describe('HTTP compatibility and protection', () => {
  it('keeps enqueue envelopes and never exposes internal fields', async () => {
    const { app, repository, telemetry } = await setup();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/jobs',
        headers: { authorization: 'Bearer test' },
        payload: { queue_name: 'default', payload: {} },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().created).toBe(true);
      expect(Object.keys(response.json().job).sort()).toEqual(Object.keys(fixture.job).sort());
      vi.mocked(repository.enqueue).mockResolvedValue({ job: job(), created: false });
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/jobs',
            headers: { authorization: 'Bearer test' },
            payload: { queue_name: 'default', payload: {} },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({ url: '/openapi.json', headers: { authorization: 'Bearer test' } })
        ).json().paths['/jobs'],
      ).toBeDefined();
    } finally {
      await app.close();
      telemetry.registry.clear();
    }
  });
  it('validates identifiers, payloads, delays and page sizes', async () => {
    const { app, telemetry } = await setup();
    try {
      for (const url of [
        '/jobs/not-a-uuid',
        '/jobs?limit=101',
        '/jobs?status=wrong',
        '/dlq?offset=-1',
      ]) {
        expect(
          (await app.inject({ url, headers: { authorization: 'Bearer test' } })).statusCode,
        ).toBe(400);
      }
      for (const body of [
        { priority: 11 },
        { max_attempts: 0 },
        { delay_ms: -1 },
        { payload: [] },
      ]) {
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/jobs',
              headers: { authorization: 'Bearer test' },
              payload: { queue_name: 'default', payload: {}, ...body },
            })
          ).statusCode,
        ).toBe(400);
      }
    } finally {
      await app.close();
      telemetry.registry.clear();
    }
  });
  it('requires credentials and restricts producers to their queues', async () => {
    const { app, repository, telemetry } = await setup('producer');
    try {
      expect((await app.inject('/jobs')).statusCode).toBe(401);
      expect((await app.inject('/health')).statusCode).toBe(200);
      expect(
        (await app.inject({ url: '/dlq', headers: { authorization: 'Bearer test' } })).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/jobs',
            headers: { authorization: 'Bearer test' },
            payload: { queue_name: 'private', payload: {} },
          })
        ).statusCode,
      ).toBe(403);
      await app.inject({ url: '/jobs', headers: { authorization: 'Bearer test' } });
      expect(repository.listJobs).toHaveBeenCalledWith(
        expect.objectContaining({ queues: ['default'] }),
      );
    } finally {
      await app.close();
      telemetry.registry.clear();
    }
  });
  it('returns typed replay errors', async () => {
    const { app, repository, telemetry } = await setup();
    try {
      vi.mocked(repository.replay).mockRejectedValue(
        new QueueError('NOT_FOUND', 'Dead letter entry not found'),
      );
      const response = await app.inject({
        method: 'POST',
        url: `/dlq/${job().id}/replay`,
        headers: { authorization: 'Bearer test' },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        error: 'Dead letter entry not found',
        code: 'NOT_FOUND',
      });
    } finally {
      await app.close();
      telemetry.registry.clear();
    }
  });
});
