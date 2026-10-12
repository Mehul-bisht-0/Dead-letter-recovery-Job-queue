"use strict";
// ---------------------------------------------------------------------------
// Exponential backoff with jitter for retry scheduling
// ---------------------------------------------------------------------------
//
//   delay = min(base * 2^attempt, cap) + random_jitter
//
// The jitter is a random value in [0, delay * 0.25] which decorrelates
// retries across workers, preventing "thundering herd" collisions when
// many jobs fail at the same time and all come back simultaneously.
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeBackoff = computeBackoff;
exports.computeBackoffBase = computeBackoffBase;
/**
 * Compute the backoff delay (in ms) for a given attempt number.
 *
 * @param attempt  - The current attempt number (0-based: first retry = 0)
 * @param baseMs   - Base delay in milliseconds (default 1 000)
 * @param capMs    - Maximum delay cap in milliseconds (default 60 000)
 * @returns delay in milliseconds including jitter
 */
function computeBackoff(attempt, baseMs = 1_000, capMs = 60_000) {
    // Exponential part: base * 2^attempt, clamped to cap
    const exponential = Math.min(baseMs * Math.pow(2, attempt), capMs);
    // Add jitter: random value in [0, 25% of the exponential delay]
    const jitter = Math.random() * exponential * 0.25;
    return Math.floor(exponential + jitter);
}
/**
 * Deterministic version (no jitter) useful for unit testing.
 * In production, always use computeBackoff which includes jitter.
 */
function computeBackoffBase(attempt, baseMs = 1_000, capMs = 60_000) {
    return Math.min(baseMs * Math.pow(2, attempt), capMs);
}
//# sourceMappingURL=backoff.js.map