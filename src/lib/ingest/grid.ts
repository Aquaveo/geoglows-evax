import type { LeadBucket, TimeSeries } from '../types';
import { describeStep, type Cadence } from './cadence';

/**
 * How values inside a bin are combined.
 *
 * 'mean' preserves volume and is right for error and distribution metrics
 * (CRPS, KGE, β).
 *
 * 'median' is the default for threshold classification, and the reason is about
 * COMPARABILITY rather than about distortion. Only the finer side gets
 * summarised; the coarser side is already at the grid. A value reported at a
 * coarser resolution — a daily gauge reading, a daily retrospective value —
 * generally already represents something typical of its period rather than an
 * instantaneous peak. Taking the median of the finer side therefore produces the
 * same KIND of quantity on both sides of the comparison, which neither the mean
 * nor the max reliably does.
 *
 * It is also the least distorting of the three in the ordinary case: not dragged
 * by one extreme step like the mean, not representing a whole period by its most
 * extreme instant like the max. But that is a secondary argument — the primary
 * one is that the two sides should measure the same thing.
 *
 * 'max' preserves exceedance — a bin *mean* can sit below a return-period
 * threshold the actual flow crossed, which erases the event. Measured: a 280
 * m3/s peak 1.2 hours wide inside a 3-hour bin survives the max intact and is
 * reported as 204 by the median, 190 by the mean, turning a real exceedance into
 * none. But it cuts the other way too, and harder at the thresholds that matter:
 * on a bin with realistic within-day shape the max crosses a 10-year-ish level
 * 7.2x as often as the mean, and on hourly readings it inflated the exceedance
 * rate to 5.0% against a true 2.9%.
 *
 * So no default is safe in general — which is why the choice is offered, and why
 * aggregationImpact reports whether it changes the answer for the data actually
 * loaded rather than leaving the reader to guess.
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
    let anyFinite = false;
    for (let m = 0; m < memberCount; m++) {
      if (e.n[m] === 0) {
        row[m] = Number.NaN;
        continue;
      }
      anyFinite = true;
      row[m] =
        how === 'max'
          ? e.max[m]
          : how === 'median'
            ? medianOf(e.vals![m])
            : e.sum[m] / e.n[m];
    }
    // A bin where NO member has a value carries nothing, and emitting it does
    // active harm. Bins are allocated from the timestamp before any value is
    // seen, so such rows used to survive and be counted: countPairs counts
    // bucket timestamps against observation timestamps without inspecting the
    // values, so a bucket whose first 20 of 30 days were empty reported 30
    // pairs behind a number computed from 10. That denominator is also the gate
    // — `pairs < MIN_PAIRS_CORRELATION` decides whether a lead is scored at all
    // — so an inflated count can push a lead with four real pairs past a
    // threshold of ten.
    //
    // It moved the window bounds too. Several metrics take their overlap from
    // time[0] and time[last]; leading empty bins put time[0] twenty days before
    // any real data.
    //
    // Safe for the per-member alignment gridRun depends on: that bug was members
    // having DIFFERENT lengths, and this drops the same row for every member, so
    // positions keep their meaning. A gap in SOME members is still a gap held in
    // place, which is the distinction the docblock above is drawing.
    if (!anyFinite) continue;
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
