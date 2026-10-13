import type { FastifyInstance } from 'fastify';
import { QueueError, type QueueService, type JobStatus } from '@reliable-queue/core';
import { allowQueue } from '@reliable-queue/infrastructure';
import {
  EnqueueSchema,
  IdParams,
  JobQuery,
  JobEnvelope,
  EnqueueEnvelope,
  JobListEnvelope,
  serializeJob,
  type EnqueueBody,
} from '@reliable-queue/contracts';
export function registerJobRoutes(app: FastifyInstance, queue: QueueService) {
  app.post<{ Body: EnqueueBody }>(
    '/jobs',
    { schema: { body: EnqueueSchema, response: { 200: EnqueueEnvelope, 201: EnqueueEnvelope } } },
    async (request, reply) => {
      allowQueue(request.principal!, request.body.queue_name);
      const result = await queue.enqueue(request.body);
      return reply
        .code(result.created ? 201 : 200)
        .send({ job: serializeJob(result.job), created: result.created });
    },
  );
  app.get<{ Params: { id: string } }>(
    '/jobs/:id',
    { schema: { params: IdParams, response: { 200: JobEnvelope } } },
    async (request) => {
      const job = await queue.getJob(request.params.id);
      if (!job) throw new QueueError('NOT_FOUND', 'Job not found');
      allowQueue(request.principal!, job.queue_name);
      return { job: serializeJob(job) };
    },
  );
  app.get<{
    Querystring: { queue_name?: string; status?: JobStatus; limit?: number; offset?: number };
  }>(
    '/jobs',
    { schema: { querystring: JobQuery, response: { 200: JobListEnvelope } } },
    async (request) => {
      const p = request.principal!;
      if (request.query.queue_name) allowQueue(p, request.query.queue_name);
      const result = await queue.listJobs({
        ...request.query,
        queues: p.role === 'producer' ? p.queues : undefined,
      });
      return { jobs: result.jobs.map(serializeJob), total: result.total };
    },
  );
}
