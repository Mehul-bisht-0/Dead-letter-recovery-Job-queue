import { QueueService, Config, JobHandler } from '@reliable-queue/core';
import { Semaphore } from './semaphore';
/** Register a handler function for a specific queue */
export declare function registerHandler(queueName: string, handler: JobHandler): void;
/**
 * Start the worker polling loop. Claims jobs from Redis, executes the
 * registered handler, and acks/nacks based on the result.
 */
export declare function startWorkerLoop(queueService: QueueService, config: Config, semaphore: Semaphore): Promise<void>;
