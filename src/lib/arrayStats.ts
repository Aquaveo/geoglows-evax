/**
 * Min/max over an array without spreading it into Math.min/Math.max.
 *
 * `Math.max(...xs)` passes every element as a separate argument, so it throws
 * RangeError: Maximum call stack size exceeded once the array is large — the
 * limit is around 100k elements in V8 and varies with stack depth, which makes
 * it a bug that only appears on big inputs. An ensemble of 46 runs x 51 members
 * x 120 timesteps is 281,520 values, so this is reachable with ordinary data.
 *
 * Non-finite values are skipped; an array with no finite values returns the
 * supplied fallback.
 */
export function maxOf(xs: ArrayLike<number>, fallback = Number.NEGATIVE_INFINITY): number {
  let m = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < xs.length; i++) {
    const v = xs[i];
    if (Number.isFinite(v) && v > m) m = v;
  }
  return m === Number.NEGATIVE_INFINITY ? fallback : m;
}

export function minOf(xs: ArrayLike<number>, fallback = Number.POSITIVE_INFINITY): number {
  let m = Number.POSITIVE_INFINITY;
  for (let i = 0; i < xs.length; i++) {
    const v = xs[i];
    if (Number.isFinite(v) && v < m) m = v;
  }
  return m === Number.POSITIVE_INFINITY ? fallback : m;
}
