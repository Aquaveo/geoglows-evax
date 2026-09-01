import { describe, expect, it } from 'vitest';
import { maxOf, minOf } from '../../src/lib/arrayStats';

describe('maxOf / minOf', () => {
  it('survives an array far larger than the spread limit', () => {
    // The bug this exists to prevent: an ensemble of 46 runs x 51 members x 120
    // timesteps is 281,520 values, and Math.max(...that) throws
    // "RangeError: Maximum call stack size exceeded" — which is exactly how the
    // Metrics tab crashed. Anything reduce-based handles it.
    const n = 281_520;
    const xs = new Array<number>(n);
    for (let i = 0; i < n; i++) xs[i] = i % 1000;
    expect(() => Math.max(...xs)).toThrow(RangeError);
    expect(maxOf(xs)).toBe(999);
    expect(minOf(xs)).toBe(0);
  });

  it('skips non-finite values rather than returning NaN', () => {
    expect(maxOf([1, NaN, 5, Infinity, 2])).toBe(5);
    expect(minOf([1, NaN, -Infinity, 5, 2])).toBe(1);
  });

  it('returns the fallback when nothing is finite', () => {
    expect(maxOf([NaN, Infinity], 0)).toBe(0);
    expect(minOf([], 42)).toBe(42);
    expect(maxOf([])).toBe(Number.NEGATIVE_INFINITY);
  });

  it('accepts typed arrays', () => {
    expect(maxOf(Float64Array.from([3, 9, 1]))).toBe(9);
    expect(minOf(Float64Array.from([3, 9, 1]))).toBe(1);
  });
});
