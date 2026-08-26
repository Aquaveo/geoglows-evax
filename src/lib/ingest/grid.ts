import type { LeadBucket, TimeSeries } from '../types';
import { describeStep, type Cadence } from './cadence';

/**
 * How values inside a bin are combined.
 *
 * 'mean' preserves volume and is right for error and distribution metrics
 * (CRPS, KGE, β).
 *
 * 'median' is the default for threshold classification. It is the typical flow
 * in the bin, so it is the least distorting summary when the bin has to stand in
 * for the whole period: unlike the mean it is not dragged by one extreme step,
 * and unlike the max it does not represent a day by its most extreme instant.
 *
 * 'max' preserves exceedance — a daily *mean* can sit below a return-period
 * threshold the day's actual flow crossed, which erases the event. But it cuts
 * the other way too, and harder at the thresholds that matter: on a bucket with
 * realistic within-day shape, the max crosses a 10-year-ish level 7.2x as often
 * as the mean. Which is right depends on what the threshold was fitted to, and
 * that is a property of the uploaded record, not of this function — hence the
 * choice being offered rather than assumed.
 *
 * Note this is aggregation over TIME within a bin, applied to each ensemble
 * member independently. It never combines members: a 51-member ensemble stays 51
 * trajectories through every one of these paths.
 */
export type Aggregation = 'mean' | 'median' | 'max';

/**
 * Median of the finite values, or NaN. Sorts a copy; callers pass scratch arrays.
 *
 * Kept here rather than imported so the aggregation paths have no dependency
 * beyond this module — they run over every member of every bucket and are the
 * hottest loops in the app.
 */
function medianOf(xs: number[]): number {
  if (xs.length === 0) return Number.NaN;
  xs.sort((a, b) => a - b);
  const mid = xs.length / 2;
  return xs.length % 2 === 1 ? xs[Math.floor(mid)] : (xs[mid - 1] + xs[mid]) / 2;
}

export interface ComparisonGrid {
  /** Bin width in ms. */
  stepMs: number;
  /** Human label, e.g. "daily". */
  label: string;
  /** Which input forced this resolution. */
  limitedBy: 'observations' | 'forecasts' | 'equal';
  /** Whether either side actually has to be aggregated to reach the grid. */
  observationsAggregated: boolean;
  forecastsAggregated: boolean;
}

/**
 * Comparison happens at the COARSER of the two cadences, never the finer.
 *
 * Upsampling the coarser series would manufacture data: interpolating a daily
 * record to hourly invents 23 points per real measurement, and every metric then
 * counts them as independent samples. Aggregating the finer series down loses
 * detail, which is honest, and keeps the pair count equal to the number of real
 * observations.
 */
export function chooseGrid(obs: Cadence, fcst: Cadence): ComparisonGrid {
  const stepMs = Math.max(obs.stepMs, fcst.stepMs);
  const limitedBy =
    obs.stepMs === fcst.stepMs
      ? 'equal'
      : obs.stepMs > fcst.stepMs
        ? 'observations'
        : 'forecasts';
  return {
    stepMs,
    label: describeStep(stepMs),
    limitedBy,
    observationsAggregated: obs.stepMs < stepMs,
    forecastsAggregated: fcst.stepMs < stepMs,
  };
}

/**
 * Floor a timestamp onto the grid. The Unix epoch is midnight UTC, so
 * epoch-relative flooring lands daily bins on UTC midnight and 3-hourly bins on
 * 00/03/06… UTC — the same instants the forecasts are published at.
 */
export function binStart(ms: number, stepMs: number): number {
  return Math.floor(ms / stepMs) * stepMs;
}

/**
 * Aggregate a series onto the grid. Bins with no finite value are dropped
 * rather than filled, so a gap stays a gap.
 *
 * Aggregating also snaps timestamps onto exact bin boundaries, which is what
 * lets the metrics keep using exact-timestamp matching: an observation reported
 * at :05 past the hour used to match nothing at all.
 */
export function aggregateSeries(
  s: TimeSeries,
  stepMs: number,
  how: Aggregation,
): TimeSeries {
  // Values are only retained for the median, which needs them all. The mean and
  // max paths stay streaming, because this runs over whole multi-decade records.
  const keep = how === 'median';
  const bins = new Map<number, { sum: number; n: number; max: number; vals: number[] }>();
  for (let i = 0; i < s.time.length; i++) {
    const v = s.values[i];
    if (!Number.isFinite(v)) continue;
    const b = binStart(s.time[i].getTime(), stepMs);
    const cur = bins.get(b);
    if (cur) {
      cur.sum += v;
      cur.n += 1;
      if (v > cur.max) cur.max = v;
      if (keep) cur.vals.push(v);
    } else {
      bins.set(b, { sum: v, n: 1, max: v, vals: keep ? [v] : [] });
    }
  }
  const keys = [...bins.keys()].sort((a, b) => a - b);
  return {
    time: keys.map((k) => new Date(k)),
    values: keys.map((k) => {
      const e = bins.get(k)!;
      if (how === 'max') return e.max;
      if (how === 'median') return medianOf(e.vals);
      return e.sum / e.n;
    }),
  };
}

/**
 * Aggregate every member of a lead bucket onto the grid, preserving the
 * [row][member] layout. Members are aggregated independently, so an ensemble
 * stays an ensemble.
 */
export function aggregateBucket(
  b: LeadBucket,
  stepMs: number,
  how: Aggregation,
): LeadBucket {
  if (b.time.length === 0) return b;
  const memberCount = b.members[0]?.length ?? 0;

  // Per-member value lists only when the median needs them; the mean and max
  // paths stay streaming.
  const keep = how === 'median';
  const bins = new Map<
    number,
    { sum: number[]; n: number[]; max: number[]; vals: number[][] | null }
  >();
  for (let i = 0; i < b.time.length; i++) {
    const key = binStart(b.time[i].getTime(), stepMs);
    let e = bins.get(key);
    if (!e) {
      e = {
        sum: new Array<number>(memberCount).fill(0),
        n: new Array<number>(memberCount).fill(0),
        max: new Array<number>(memberCount).fill(Number.NEGATIVE_INFINITY),
        vals: keep ? Array.from({ length: memberCount }, () => [] as number[]) : null,
      };
      bins.set(key, e);
    }
    const row = b.members[i];
    for (let m = 0; m < memberCount; m++) {
      const v = row[m];
      if (!Number.isFinite(v)) continue;
      e.sum[m] += v;
      e.n[m] += 1;
      if (v > e.max[m]) e.max[m] = v;
      // Each member keeps its OWN list: this is aggregation over time within the
      // bin, per member, never across members.
      if (e.vals) e.vals[m].push(v);
    }
  }

  const keys = [...bins.keys()].sort((x, y) => x - y);
  const time: Date[] = [];
  const members: number[][] = [];
  for (const k of keys) {
    const e = bins.get(k)!;
    const row = new Array<number>(memberCount);
    for (let m = 0; m < memberCount; m++) {
      row[m] =
        e.n[m] === 0
          ? Number.NaN
          : how === 'max'
            ? e.max[m]
            : how === 'median'
              ? medianOf(e.vals![m])
              : e.sum[m] / e.n[m];
    }
    time.push(new Date(k));
    members.push(row);
  }
  return { time, members };
}

/** Cadence of a lead bucket's pooled timestamps, for grid selection. */
export function bucketCadence(b: LeadBucket): Cadence | null {
  if (b.time.length < 2) return null;
  const times = b.time.map((d) => d.getTime()).sort((a, b2) => a - b2);
  const diffs: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1];
    if (d > 0) diffs.push(d);
  }
  if (diffs.length === 0) return null;
  const sorted = [...diffs].sort((a, b2) => a - b2);
  const stepMs = sorted[Math.floor(sorted.length / 2)];
  let regular = 0;
  for (const d of diffs) if (Math.abs(d - stepMs) <= stepMs * 0.1) regular++;
  return {
    stepMs,
    label: describeStep(stepMs),
    nSamples: b.time.length,
    irregular: regular / diffs.length < 0.8,
    regularShare: regular / diffs.length,
  };
}
