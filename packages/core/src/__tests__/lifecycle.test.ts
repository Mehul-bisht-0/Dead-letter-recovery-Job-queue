import { describe, it, expect } from 'vitest';
import { validateEnqueue, computeBackoff, failureDisposition } from '../index';
describe('Domain invariants', () => {
  it('caps jitter at the configured maximum', () => {
    expect(computeBackoff(10, 1000, 5000, () => 0.999)).toBe(5000);
    expect(computeBackoff(0, 1000, 5000, () => 0)).toBe(1000);
  });
  it('rejects malformed enqueue options independently of HTTP', () => {
    for (const options of [
      { priority: 0 },
      { priority: 11 },
      { delay_ms: -1 },
      { max_attempts: 0 },
      { payload: [] },
    ]) {
      expect(() =>
        validateEnqueue({ queue_name: 'default', payload: {}, ...options } as Parameters<
          typeof validateEnqueue
        >[0]),
      ).toThrow();
    }
  });
  it('consumes the attempt budget exactly', () => {
    expect(failureDisposition(2, 3)).toBe('retry');
    expect(failureDisposition(3, 3)).toBe('dead');
  });
});
