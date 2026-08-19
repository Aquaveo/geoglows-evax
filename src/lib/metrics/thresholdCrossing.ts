import type { TimeSeries } from '../types';

const HOUR_MS = 3600 * 1000;

export interface CrossingResult {
  /** Δt in hours, or null when either series did not cross the threshold within the overlap. */
  deltaT: number | null;
  crossedObs: boolean;
  crossedFcst: boolean;
}

/**
 * First ascending crossing within [start, end]: the first timestep where the
 * series transitions from below the threshold to at-or-above it. Mirrors the
 * notebook's `first_ascending_crossing` (above & ~above.shift(1, fill=False)).
 * A series that begins already at-or-above the threshold counts as crossing at
 * its first finite sample.
 */
export function firstAscendingCrossing(
  s: TimeSeries,
  threshold: number,
  start: number,
  end: number,
): number | null {
  let prevAbove = false;
  let seenAny = false;
  for (let i = 0; i < s.time.length; i++) {
    const ms = s.time[i].getTime();
    if (ms < start || ms > end) continue;
    const v = s.values[i];
    if (!Number.isFinite(v)) continue;
    const above = v >= threshold;
    if (above && (!seenAny || !prevAbove)) return ms;
    prevAbove = above;
    seenAny = true;
  }
  return null;
}

/**
 * Δt_RP = t_crossing_forecast − t_crossing_observed in hours.
 * `obsThreshold` is the obs-side return-period flow; `simThreshold` is the
 * simulated-side flow for the same return period (dual-threshold approach).
 */
export function computeThresholdCrossing(
  forecast: TimeSeries,
  observed: TimeSeries,
  obsThreshold: number,
  simThreshold: number,
): CrossingResult {
  if (
    forecast.time.length === 0 ||
    observed.time.length === 0 ||
    !Number.isFinite(obsThreshold) ||
    !Number.isFinite(simThreshold)
  ) {
    return { deltaT: null, crossedObs: false, crossedFcst: false };
  }
  const fStart = forecast.time[0].getTime();
  const fEnd = forecast.time[forecast.time.length - 1].getTime();
  const oStart = observed.time[0].getTime();
  const oEnd = observed.time[observed.time.length - 1].getTime();
  const start = Math.max(fStart, oStart);
  const end = Math.min(fEnd, oEnd);
  if (start >= end) {
    return { deltaT: null, crossedObs: false, crossedFcst: false };
  }
  const tFcst = firstAscendingCrossing(forecast, simThreshold, start, end);
  const tObs = firstAscendingCrossing(observed, obsThreshold, start, end);
  const crossedObs = tObs != null;
  const crossedFcst = tFcst != null;
  if (tFcst == null || tObs == null) {
    return { deltaT: null, crossedObs, crossedFcst };
  }
  return { deltaT: (tFcst - tObs) / HOUR_MS, crossedObs, crossedFcst };
}
