import { describe, it, expect } from 'vitest';
import { computeBackoffBase } from '../backoff';

describe('Exponential Backoff', () => {
  it('computes exponential growth', () => {
    // attempt 0 = base * 2^0 = 1000
    expect(computeBackoffBase(0, 1000, 60000)).toBe(1000);
    // attempt 1 = base * 2^1 = 2000
    expect(computeBackoffBase(1, 1000, 60000)).toBe(2000);
    // attempt 2 = base * 2^2 = 4000
    expect(computeBackoffBase(2, 1000, 60000)).toBe(4000);
  });

  it('respects the cap', () => {
    expect(computeBackoffBase(10, 1000, 5000)).toBe(5000);
  });
});
