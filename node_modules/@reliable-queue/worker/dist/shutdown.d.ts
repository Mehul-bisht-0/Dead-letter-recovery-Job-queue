export type ShutdownCallback = () => Promise<void>;
/** Returns true if the worker is draining (no new jobs should be claimed) */
export declare function isDraining(): boolean;
/** Register a cleanup callback to run during shutdown (LIFO order) */
export declare function onShutdown(callback: ShutdownCallback): void;
/** Install SIGTERM/SIGINT handlers. Call once at worker startup. */
export declare function installShutdownHandlers(): void;
