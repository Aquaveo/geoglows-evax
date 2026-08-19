import type { TimeSeries } from '../types';

const HOUR_MS = 3600 * 1000;

/**
 * Peak timing error in hours: Δt_peak = t_peak_forecast − t_peak_observed.
 * Restricted to the overlapping time window. Returns null if there is no overlap
 * or either series has no finite values within it.
 *
 * Negative → forecast peak arrives early; positive → late.
 * Mirrors the notebook's `compute_peak_timing_error`.
 */
export function computePeakTimingError(
  forecast: TimeSeries,
  observed: TimeSeries,
): number | null {
  if (forecast.time.length === 0 || observed.time.length === 0) return null;

  const fStart = forecast.time[0].getTime();
  const fEnd = forecast.time[forecast.time.length - 1].getTime();
  const oStart = observed.time[0].getTime();
  const oEnd = observed.time[observed.time.length - 1].getTime();
  const start = Math.max(fStart, oStart);
  const end = Math.min(fEnd, oEnd);
  if (start >= end) return null;

  const tPeakFcst = argmaxInWindow(forecast, start, end);
  const tPeakObs = argmaxInWindow(observed, start, end);
  if (tPeakFcst == null || tPeakObs == null) return null;

  return (tPeakFcst - tPeakObs) / HOUR_MS;
}

function argmaxInWindow(s: TimeSeries, start: number, end: number): number | null {
  let bestT: number | null = null;
  let bestV = -Infinity;
  for (let i = 0; i < s.time.length; i++) {
    const ms = s.time[i].getTime();
    if (ms < start || ms > end) continue;
    const v = s.values[i];
    if (!Number.isFinite(v)) continue;
    if (v > bestV) {
      bestV = v;
      bestT = ms;
    }
  }
  return bestT;
}
