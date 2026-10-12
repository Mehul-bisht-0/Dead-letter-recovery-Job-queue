// ---------------------------------------------------------------------------
// Graceful shutdown handler
// ---------------------------------------------------------------------------
//
// On SIGTERM (sent by Docker, k8s, etc.):
//   1. Stop claiming new jobs (set draining flag)
//   2. Wait for all in-flight jobs to finish
//   3. Stop the heartbeat and reaper
//   4. Close database and Redis connections
//   5. Exit cleanly
//
// On SIGINT (Ctrl+C in development):
//   Same sequence, but also logs a user-friendly message.
// ---------------------------------------------------------------------------

export type ShutdownCallback = () => Promise<void>;

const callbacks: ShutdownCallback[] = [];
let draining = false;

/** Returns true if the worker is draining (no new jobs should be claimed) */
export function isDraining(): boolean {
  return draining;
}

/** Register a cleanup callback to run during shutdown (LIFO order) */
export function onShutdown(callback: ShutdownCallback): void {
  callbacks.push(callback);
}

/** Install SIGTERM/SIGINT handlers. Call once at worker startup. */
export function installShutdownHandlers(): void {
  const shutdown = async (signal: string) => {
    if (draining) return; // already shutting down
    draining = true;
    console.log(`\n[shutdown] Received ${signal} — draining in-flight jobs...`);

    // Run callbacks in reverse registration order (LIFO)
    for (let i = callbacks.length - 1; i >= 0; i--) {
      try {
        await callbacks[i]();
      } catch (err: any) {
        console.error(`[shutdown] Cleanup callback ${i} failed:`, err.message);
      }
    }

    console.log('[shutdown] Graceful shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
