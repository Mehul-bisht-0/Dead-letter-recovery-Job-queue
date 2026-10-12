import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { QueueService } from '@reliable-queue/core';
export declare function registerMetricsRoutes(app: FastifyInstance, queue: QueueService, pool: Pool): void;
