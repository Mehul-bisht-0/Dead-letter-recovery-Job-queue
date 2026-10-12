import { FastifyInstance } from 'fastify';
import { QueueService } from '@reliable-queue/core';
export declare function registerJobRoutes(app: FastifyInstance, queue: QueueService): void;
