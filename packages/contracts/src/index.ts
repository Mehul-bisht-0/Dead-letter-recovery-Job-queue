import { Type, type Static } from '@sinclair/typebox';
import { QueueError, type Job, type DeadLetter } from '@reliable-queue/core';
export const IdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });
export const Pagination = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000000 })),
});
export const JobQuery = Type.Intersect([
  Pagination,
  Type.Object({
    queue_name: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
    status: Type.Optional(
      Type.Union(
        ['pending', 'processing', 'completed', 'failed', 'dead'].map((s) => Type.Literal(s)),
      ),
    ),
  }),
]);
export const EnqueueSchema = Type.Object({
  queue_name: Type.String({ minLength: 1, maxLength: 255 }),
  payload: Type.Record(Type.String(), Type.Unknown()),
  priority: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
  delay_ms: Type.Optional(Type.Integer({ minimum: 0, maximum: 2592000000 })),
  max_attempts: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  idempotency_key: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
});
const nullable = (schema: ReturnType<typeof Type.String>) => Type.Union([schema, Type.Null()]);
export const JobSchema = Type.Object({
  id: Type.String(),
  queue_name: Type.String(),
  payload: Type.Record(Type.String(), Type.Unknown()),
  status: Type.String(),
  priority: Type.Integer(),
  attempts: Type.Integer(),
  max_attempts: Type.Integer(),
  created_at: Type.String(),
  updated_at: Type.String(),
  available_at: Type.String(),
  locked_by: nullable(Type.String()),
  locked_until: nullable(Type.String()),
  idempotency_key: nullable(Type.String()),
  result: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  error: nullable(Type.String()),
});
export const DeadLetterSchema = Type.Object({
  id: Type.String(),
  original_job_id: Type.String(),
  queue_name: Type.String(),
  payload: Type.Record(Type.String(), Type.Unknown()),
  failure_reason: nullable(Type.String()),
  failure_history: Type.Array(
    Type.Object({
      attempt: Type.Integer(),
      error: Type.Union([Type.String(), Type.Null()]),
      failed_at: Type.Union([Type.String(), Type.Null()]),
    }),
  ),
  moved_at: Type.String(),
});
export const ErrorSchema = Type.Object({
  error: Type.String(),
  code: Type.String(),
  request_id: Type.String(),
});
export function httpFailure(
  error: Error & { validation?: unknown; statusCode?: number },
  requestId: string,
) {
  const status =
    error instanceof QueueError
      ? {
          VALIDATION: 400,
          NOT_FOUND: 404,
          CONFLICT: 409,
          LEASE_LOST: 409,
          UNAUTHORIZED: 401,
          FORBIDDEN: 403,
        }[error.code]
      : error.validation
        ? 400
        : error.statusCode && error.statusCode < 500
          ? error.statusCode
          : 503;
  const message =
    error instanceof QueueError
      ? error.message
      : error.validation
        ? 'Invalid request'
        : status === 429
          ? 'Rate limit exceeded'
          : status >= 500
            ? 'Service temporarily unavailable'
            : error.message;
  return {
    status,
    body: {
      error: message,
      code:
        error instanceof QueueError
          ? error.code
          : status === 400
            ? 'VALIDATION'
            : status === 429
              ? 'RATE_LIMIT'
              : 'UNAVAILABLE',
      request_id: requestId,
    },
  };
}
export const JobEnvelope = Type.Object({ job: JobSchema });
export const EnqueueEnvelope = Type.Object({ job: JobSchema, created: Type.Boolean() });
export const JobListEnvelope = Type.Object({ jobs: Type.Array(JobSchema), total: Type.Integer() });
export const DLQEnvelope = Type.Object({
  items: Type.Array(DeadLetterSchema),
  total: Type.Integer(),
});
export type EnqueueBody = Static<typeof EnqueueSchema>;
export function serializeJob(job: Job): Static<typeof JobSchema> {
  return {
    id: job.id,
    queue_name: job.queue_name,
    payload: job.payload,
    status: job.status,
    priority: job.priority,
    attempts: job.attempts,
    max_attempts: job.max_attempts,
    created_at: job.created_at.toISOString(),
    updated_at: job.updated_at.toISOString(),
    available_at: job.available_at.toISOString(),
    locked_by: job.locked_by,
    locked_until: job.locked_until?.toISOString() ?? null,
    idempotency_key: job.idempotency_key,
    result: job.result,
    error: job.error,
  };
}
export function serializeDeadLetter(item: DeadLetter): Static<typeof DeadLetterSchema> {
  return {
    id: item.id,
    original_job_id: item.original_job_id,
    queue_name: item.queue_name,
    payload: item.payload,
    failure_reason: item.failure_reason,
    failure_history: item.failure_history,
    moved_at: item.moved_at.toISOString(),
  };
}
