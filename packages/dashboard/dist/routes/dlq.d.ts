import { FastifyInstance } from 'fastify';
import { QueueService } from '@reliable-queue/core';
export declare function registerDLQRoutes(app: FastifyInstance, queue: QueueService): void;
