/**
 * Compute the backoff delay (in ms) for a given attempt number.
 *
 * @param attempt  - The current attempt number (0-based: first retry = 0)
 * @param baseMs   - Base delay in milliseconds (default 1 000)
 * @param capMs    - Maximum delay cap in milliseconds (default 60 000)
 * @returns delay in milliseconds including jitter
 */
export declare function computeBackoff(attempt: number, baseMs?: number, capMs?: number): number;
/**
 * Deterministic version (no jitter) useful for unit testing.
 * In production, always use computeBackoff which includes jitter.
 */
export declare function computeBackoffBase(attempt: number, baseMs?: number, capMs?: number): number;
