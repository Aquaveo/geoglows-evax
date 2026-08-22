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

  const fStart = forecast.time[0].getTime();
  const fEnd = forecast.time[forecast.time.length - 1].getTime();
  const oStart = observed.time[0].getTime();
  const oEnd = observed.time[observed.time.length - 1].getTime();
  const start = Math.max(fStart, oStart);
  const end = Math.min(fEnd, oEnd);
  if (start > end) return { time: [], forecast: [], observed: [] };

  // Build map of observed values by exact UTC ms.
  const obsMap = new Map<number, number>();
  for (let i = 0; i < observed.time.length; i++) {
    const ms = observed.time[i].getTime();
    if (ms < start || ms > end) continue;
    obsMap.set(ms, observed.values[i]);
  }

  const time: Date[] = [];
  const f: number[] = [];
  const o: number[] = [];
  for (let i = 0; i < forecast.time.length; i++) {
    const ms = forecast.time[i].getTime();
    if (ms < start || ms > end) continue;
    const ov = obsMap.get(ms);
    if (ov === undefined) continue;
    if (!Number.isFinite(forecast.values[i]) || !Number.isFinite(ov)) continue;
    time.push(forecast.time[i]);
    f.push(forecast.values[i]);
    o.push(ov);
  }
  return { time, forecast: f, observed: o };
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
  let n = 0;
  for (const t of time) if (keys.has(t.getTime())) n++;
  return n;
}
