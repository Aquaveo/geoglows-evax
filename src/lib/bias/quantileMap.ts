/**
 * Port of `geoglows.bias._flow_and_probability_mapper` and the scipy linear
 * interpolation it returns, from geoglows 2.2.0.
 *
 * This is a deliberate line-by-line port, not a reimplementation. Every quirk
 * below is reproduced on purpose and is pinned by fixtures generated from the
 * real Python package (tests/fixtures/bias). If a simplification here looks
 * tempting, the fixtures exist because it is not.
 */

/** Everything the reference computes on the way to its interpolator. */
export interface MonthlyCdf {
  /** `monthly_data.size` — the divisor for counts, NOT `counts.sum()`. */
  n: number;
  /** `math.floor(min)`. Computed by the reference but never used in `bins`. */
  minVal: number;
  /** `math.ceil(max)`, with `+= 0.1` applied when it equals `minVal`. */
  maxVal: number;
  /** True when the max == min branch fired (Python warns here). */
  degenerateRange: boolean;
  numberOfClasses: number;
  stepWidth: number;
  bins: number[];
  /** Normalised histogram, length `bins.length - 1`. */
  counts: number[];
  /** `bins.slice(1)` — index-aligned with `counts` and `cdf`. */
  binEdges: number[];
  cdf: number[];
}

export class BiasCorrectionError extends Error {}

/**
 * `np.arange(start, stop, step)`.
 *
 * Length is `ceil((stop - start) / step)` and each element is computed as
 * `start + i * step`. Accumulating (`prev + step`) instead would drift and
 * change the bin edges, which changes every downstream value.
 */
export function arange(start: number, stop: number, step: number): number[] {
  const len = Math.ceil((stop - start) / step);
  if (!Number.isFinite(len) || len <= 0) return [];
  const out = new Array<number>(len);
  for (let i = 0; i < len; i++) out[i] = start + i * step;
  return out;
}

/**
 * `np.histogram(data, bins=edges)` counts.
 *
 * Bins are right-open except the last, which is closed at both ends. Values
 * outside the bin range are simply not counted — and the caller divides by the
 * sample size rather than by the total count, so the CDF need not reach 1.
 */
export function histogramCounts(values: readonly number[], bins: readonly number[]): number[] {
  const nb = bins.length - 1;
  const counts = new Array<number>(nb).fill(0);
  if (nb <= 0) return counts;
  const lo = bins[0];
  const hi = bins[nb];
  for (const v of values) {
    if (!Number.isFinite(v) || v < lo || v > hi) continue;
    let idx: number;
    if (v === hi) {
      idx = nb - 1; // closed last bin
    } else {
      // Largest j with bins[j] <= v, via binary search.
      let a = 0;
      let b = nb;
      while (a < b) {
        const mid = (a + b) >> 1;
        if (bins[mid] <= v) a = mid + 1;
        else b = mid;
      }
      idx = a - 1;
    }
    if (idx >= 0 && idx < nb) counts[idx] += 1;
  }
  return counts;
}

/**
 * Build the reference's histogram CDF for one calendar month's values.
 *
 * Mirrors `_flow_and_probability_mapper` up to (but not including) the
 * interpolator. Throws where the reference would raise — an empty sample makes
 * `np.max` fail in Python.
 */
export function buildMonthlyCdf(values: readonly number[]): MonthlyCdf {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) {
    throw new BiasCorrectionError('no finite values in the month; the reference raises here');
  }

  let maxVal = Math.ceil(Math.max(...finite));
  const minVal = Math.floor(Math.min(...finite));
  const degenerateRange = maxVal === minVal;
  if (degenerateRange) maxVal += 0.1;

  const n = finite.length;
  const numberOfClasses = Math.ceil(1 + 3.322 * Math.log10(n));
  const stepWidth = (maxVal - minVal) / numberOfClasses;

  // `minVal` deliberately does NOT appear here: the reference's bins always
  // start at -stepWidth regardless of where the data starts. Its two
  // `bins[0] >= 0` branches are unreachable (bins[0] is always -stepWidth < 0)
  // and would crash on `np.concatenate` of a scalar, so they are omitted.
  const bins = arange(-stepWidth, maxVal + 2 * stepWidth, stepWidth);

  const rawCounts = histogramCounts(finite, bins);
  const binEdges = bins.slice(1);

  // Divide element-wise FIRST, then accumulate sequentially — this is what
  // np.cumsum does. Computing `runningCount / n` instead changes the final
  // value by an ULP, and that single bit decides whether the inverse mapping
  // later returns a finite ceiling or +Infinity. Do not "simplify" this.
  const counts = rawCounts.map((c) => c / n);
  const cdf = new Array<number>(counts.length);
  let acc = 0;
  for (let i = 0; i < counts.length; i++) {
    acc += counts[i];
    cdf[i] = acc;
  }

  return {
    n,
    minVal,
    maxVal,
    degenerateRange,
    numberOfClasses,
    stepWidth,
    bins,
    counts,
    binEdges,
    cdf,
  };
}

/**
 * `scipy.interpolate.interp1d(x, y, fill_value='extrapolate')` at one point.
 *
 * `fill_value='extrapolate'` disables scipy's `np.interp` fast path, so this
 * must use scipy's slope form — and in two steps, exactly as scipy writes it:
 *
 *     slope = (y_hi - y_lo) / (x_hi - x_lo)     // may be +/-Infinity
 *     out   = slope * (v - x_lo) + y_lo         // Infinity * 0 -> NaN
 *
 * The algebraically equivalent single expression produces NaN and Infinity in
 * *different* places, and differs in the last bit elsewhere. Where x has
 * duplicate values (the CDF's flat head and tail) that division by zero is the
 * whole source of the reference's NaN and Infinity results.
 *
 * scipy argsorts x when `assume_sorted=False`, but that is a no-op here: the
 * CDF is non-decreasing by construction and binEdges strictly increasing.
 */
export function interpolateExtrapolate(
  x: readonly number[],
  y: readonly number[],
  v: number,
): number {
  const len = x.length;
  if (len === 0) throw new BiasCorrectionError('empty interpolation domain');
  if (len === 1) return y[0];
  if (Number.isNaN(v)) return NaN;

  // np.searchsorted(x, v, side='left'), then .clip(1, len - 1)
  let a = 0;
  let b = len;
  while (a < b) {
    const mid = (a + b) >> 1;
    if (x[mid] < v) a = mid + 1;
    else b = mid;
  }
  const hi = Math.min(Math.max(a, 1), len - 1);
  const lo = hi - 1;

  const slope = (y[hi] - y[lo]) / (x[hi] - x[lo]);
  return slope * (v - x[lo]) + y[lo];
}

/** Flow -> exceedance probability, using the CDF as the y-axis. */
export function flowToProbability(c: MonthlyCdf, flow: number): number {
  return interpolateExtrapolate(c.binEdges, c.cdf, flow);
}

/** Probability -> flow, inverting the CDF by using it as the x-axis. */
export function probabilityToFlow(c: MonthlyCdf, p: number): number {
  return interpolateExtrapolate(c.cdf, c.binEdges, p);
}
