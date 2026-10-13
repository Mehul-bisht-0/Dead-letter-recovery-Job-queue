import { setTimeout as delay } from 'node:timers/promises';
import type { Logger } from '@reliable-queue/core';
export { delay };
export async function repeat(
  intervalMs: number,
  action: () => Promise<void>,
  signal: AbortSignal,
  logger: Logger,
): Promise<void> {
  while (!signal.aborted) {
    try {
      await action();
    } catch (error) {
      logger.error({ err: error }, 'Background operation failed');
    }
    try {
      await delay(intervalMs, undefined, { signal });
    } catch {
      break;
    }
  }
}
export function installSignals(stop: () => Promise<void>, logger: Logger): () => void {
  let stopping = false;
  const handler = () => {
    if (stopping) return;
    stopping = true;
    void stop().catch((error) => {
      logger.error({ err: error }, 'Shutdown failed');
      process.exitCode = 1;
    });
  };
  process.on('SIGTERM', handler);
  process.on('SIGINT', handler);
  return () => {
    process.off('SIGTERM', handler);
    process.off('SIGINT', handler);
  };
}
