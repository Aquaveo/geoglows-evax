import type { TimeSeries } from './types';

/**
 * Window intersect idiom from the notebook:
 *   start = max(forecast.min, observed.min)
 *   end   = min(forecast.max, observed.max)
 *   common = intersection of timestamps in that window.
 *
 * Returns aligned forecast and observed values at the common timestamps.
 */
export function alignTimes(forecast: TimeSeries, observed: TimeSeries): {
  time: Date[];
  forecast: number[];
  observed: number[];
} {
  if (forecast.time.length === 0 || observed.time.length === 0) {
    return { time: [], forecast: [], observed: [] };
  }

  // Window from the actual extremes, NOT from time[0] and time[last].
  //
  // Those assume ascending order. A newest-first CSV — which gauge services
  // hand out and parseCsv does not sort — gave fStart > fEnd, so start > end and
  // every metric silently returned zero pairs: NaN everywhere, no error, no
  // explanation. The scan is O(n) either way, so nothing is lost by being
  // order-independent.
  const bounds = (ts: readonly Date[]) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const d of ts) {
      const ms = d.getTime();
      if (!Number.isFinite(ms)) continue;
      if (ms < lo) lo = ms;
      if (ms > hi) hi = ms;
    }
    return { lo, hi };
  };
  const fb = bounds(forecast.time);
  const ob = bounds(observed.time);
  if (fb.lo > fb.hi || ob.lo > ob.hi) return { time: [], forecast: [], observed: [] };
  const start = Math.max(fb.lo, ob.lo);
  const end = Math.min(fb.hi, ob.hi);
  if (start > end) return { time: [], forecast: [], observed: [] };

  // Build map of observed values by exact UTC ms. A duplicate timestamp keeps
  // the LAST value, which is what a Map does anyway; stated so the forecast side
  // below can be made to agree rather than differ by accident.
  const obsMap = new Map<number, number>();
  for (let i = 0; i < observed.time.length; i++) {
    const ms = observed.time[i].getTime();
    if (ms < start || ms > end) continue;
    obsMap.set(ms, observed.values[i]);
  }

  // Forecast side deduplicated the same way. Pushing every row meant a repeated
  // timestamp was paired against the same observation twice and counted twice in
  // every paired metric — double-weighting one instant. Sorted at the end so the
  // result is chronological whatever the inputs were, since callers read
  // time[0]/time[last] as the window.
  const picked = new Map<number, number>();
  for (let i = 0; i < forecast.time.length; i++) {
    const ms = forecast.time[i].getTime();
    if (ms < start || ms > end) continue;
    const ov = obsMap.get(ms);
    if (ov === undefined) continue;
    if (!Number.isFinite(forecast.values[i]) || !Number.isFinite(ov)) continue;
    picked.set(ms, forecast.values[i]);
  }

  const keys = [...picked.keys()].sort((a, b) => a - b);
  return {
    time: keys.map((ms) => new Date(ms)),
    forecast: keys.map((ms) => picked.get(ms)!),
    observed: keys.map((ms) => obsMap.get(ms)!),
  };
}

/**
 * Timestamps present in both series, ignoring member-level gaps.
 *
 * The achievable overlap for a bucket or run — an upper bound on any single
 * member's pair count, and the right denominator to report, since individual
 * members can each be missing different timesteps.
 */
export function countAlignedPairs(time: readonly Date[], observed: TimeSeries): number {
  if (time.length === 0 || observed.time.length === 0) return 0;
  const keys = new Set<number>();
  for (let i = 0; i < observed.time.length; i++) {
    if (Number.isFinite(observed.values[i])) keys.add(observed.time[i].getTime());
  }
  // Deduplicated, matching alignTimes: a repeated timestamp is one aligned
  // instant, not two, and this count is the denominator the gates use.
  const seen = new Set<number>();
  for (const t of time) {
    const ms = t.getTime();
    if (keys.has(ms)) seen.add(ms);
  }
  return seen.size;
}
