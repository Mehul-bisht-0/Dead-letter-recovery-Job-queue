import type { FastifyInstance } from 'fastify';
import type { QueueService } from '@reliable-queue/core';
import { requireAdministrator } from '@reliable-queue/infrastructure';
import { Type } from '@sinclair/typebox';
import {
  Pagination,
  IdParams,
  DLQEnvelope,
  JobSchema,
  serializeJob,
  serializeDeadLetter,
} from '@reliable-queue/contracts';
export function registerDLQRoutes(app: FastifyInstance, queue: QueueService) {
  app.get<{ Querystring: { limit?: number; offset?: number } }>(
    '/dlq',
    { schema: { querystring: Pagination, response: { 200: DLQEnvelope } } },
    async (request) => {
      requireAdministrator(request.principal!);
      const result = await queue.listDeadLetters(request.query.limit, request.query.offset);
      return { items: result.items.map(serializeDeadLetter), total: result.total };
    },
  );
  app.post<{ Params: { id: string } }>(
    '/dlq/:id/replay',
    {
      schema: {
        params: IdParams,
        response: { 200: Type.Object({ message: Type.String(), job: JobSchema }) },
      },
    },
    async (request) => {
      requireAdministrator(request.principal!);
      return {
        message: 'Job replayed successfully',
        job: serializeJob(await queue.replayFromDLQ(request.params.id, request.principal!.id)),
      };
    },
  );
}
