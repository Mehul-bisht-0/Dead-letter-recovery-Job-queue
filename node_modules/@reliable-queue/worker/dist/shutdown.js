"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDraining = isDraining;
exports.onShutdown = onShutdown;
exports.installShutdownHandlers = installShutdownHandlers;
const callbacks = [];
let draining = false;
/** Returns true if the worker is draining (no new jobs should be claimed) */
function isDraining() {
    return draining;
}
/** Register a cleanup callback to run during shutdown (LIFO order) */
function onShutdown(callback) {
    callbacks.push(callback);
}
/** Install SIGTERM/SIGINT handlers. Call once at worker startup. */
function installShutdownHandlers() {
    const shutdown = async (signal) => {
        if (draining)
            return; // already shutting down
        draining = true;
        console.log(`\n[shutdown] Received ${signal} — draining in-flight jobs...`);
        // Run callbacks in reverse registration order (LIFO)
        for (let i = callbacks.length - 1; i >= 0; i--) {
            try {
                await callbacks[i]();
            }
            catch (err) {
                console.error(`[shutdown] Cleanup callback ${i} failed:`, err.message);
            }
        }
        console.log('[shutdown] Graceful shutdown complete');
        process.exit(0);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}
//# sourceMappingURL=shutdown.js.map