export function computeBackoffBase(attempt: number, baseMs = 1_000, capMs = 60_000): number {
  if (!Number.isInteger(attempt) || attempt < 0 || baseMs <= 0 || capMs < baseMs) {
    throw new RangeError('Invalid retry policy');
  }
  return Math.min(baseMs * 2 ** Math.min(attempt, 53), capMs);
}
export function computeBackoff(
  attempt: number,
  baseMs = 1_000,
  capMs = 60_000,
  random: () => number = Math.random,
): number {
  const base = computeBackoffBase(attempt, baseMs, capMs);
  return Math.floor(Math.min(capMs, base + random() * base * 0.25));
}
