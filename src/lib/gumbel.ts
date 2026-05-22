import type { TimeSeries, RpThresholds } from './types';
import { RP_LEVELS } from './types';

/**
 * Gumbel Type I (method of moments) — notebook's `gumbel_1`:
 *   Q(rp) = -ln(-ln(1 - 1/rp)) * σ * 0.7797 + μ - 0.45·σ
 *
 * Coefficients are the moment estimators (Gumbel 1958). Do NOT replace with
 * scipy.stats.gumbel_r MLE; results must match the notebook bit-for-bit.
 */
export function gumbel1(stdev: number, mean: number, rp: number): number {
  return -Math.log(-Math.log(1 - 1 / rp)) * stdev * 0.7797 + mean - 0.45 * stdev;
}

/** Annual maxima of a series (groups by UTC year). */
export function annualMaxima(s: TimeSeries): number[] {
  const byYear = new Map<number, number>();
  for (let i = 0; i < s.time.length; i++) {
    const y = s.time[i].getUTCFullYear();
    const v = s.values[i];
    if (!Number.isFinite(v)) continue;
    const prev = byYear.get(y);
    if (prev === undefined || v > prev) byYear.set(y, v);
  }
  return [...byYear.values()];
}

/** Fit Gumbel-I from a series and return thresholds for the standard RP levels. */
export function returnPeriodsFromSeries(s: TimeSeries): RpThresholds {
  const maxima = annualMaxima(s);
  if (maxima.length < 2) {
    throw new Error('Need at least 2 years of historical data to fit Gumbel-I.');
  }
  const mean = maxima.reduce((a, b) => a + b, 0) / maxima.length;
  // Population stdev (numpy default, ddof=0) to match notebook's `np.std`.
  const variance = maxima.reduce((acc, x) => acc + (x - mean) ** 2, 0) / maxima.length;
  const stdev = Math.sqrt(variance);

  const out: RpThresholds = {};
  for (const rp of RP_LEVELS) out[rp] = gumbel1(stdev, mean, rp);
  return out;
}
