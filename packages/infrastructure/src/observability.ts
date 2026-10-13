import pino from 'pino';
import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';
import type { MetricsSnapshot } from '@reliable-queue/core';
export function createLogger(service: string) {
  return pino({
    level: process.env.NODE_ENV === 'test' ? 'silent' : (process.env.LOG_LEVEL ?? 'info'),
    base: { service },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'password',
        'token',
        'csrf',
        'databaseUrl',
        'redisUrl',
      ],
      censor: '[REDACTED]',
    },
  });
}
export class Telemetry {
  readonly registry = new Registry();
  readonly outcomes = new Counter({
    name: 'rq_job_outcomes_total',
    help: 'Observed worker outcomes',
    labelNames: ['outcome'],
    registers: [this.registry],
  });
  readonly failures = new Counter({
    name: 'rq_lease_renewal_failures_total',
    help: 'Lease renewal failures',
    registers: [this.registry],
  });
  readonly duration = new Histogram({
    name: 'rq_job_duration_seconds',
    help: 'Handler execution duration',
    registers: [this.registry],
    buckets: [0.1, 0.5, 1, 5, 30, 60, 300],
  });
  readonly httpDuration = new Histogram({
    name: 'rq_http_duration_seconds',
    help: 'HTTP response latency',
    registers: [this.registry],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
  });
  private readonly depth = new Gauge({
    name: 'rq_jobs',
    help: 'Authoritative current job counts',
    labelNames: ['status'],
    registers: [this.registry],
  });
  private readonly lag = new Gauge({
    name: 'rq_dispatch_lag_seconds',
    help: 'Age of oldest unpublished outbox entry',
    registers: [this.registry],
  });
  private readonly workers = new Gauge({
    name: 'rq_alive_workers',
    help: 'Workers with a recent heartbeat',
    registers: [this.registry],
  });
  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }
  snapshot(metrics: MetricsSnapshot) {
    for (const status of ['ready', 'delayed', 'processing', 'dead'] as const)
      this.depth.set({ status }, metrics[status]);
    this.lag.set(metrics.dispatchLagSeconds);
    this.workers.set(metrics.workers.filter((w) => w.status === 'alive').length);
  }
}
