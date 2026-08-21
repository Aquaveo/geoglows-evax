import type { ForecastResult } from '../data/rfs';
import type { LeadBucket, LeadBuckets, TimeSeries } from './types';

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MEMBER_COUNT = 51;

/**
 * Reorganize per-start-date forecasts into per-lead buckets, mirroring the
 * notebook's `reorganize_forecasts_by_daily_lead`.
 *
 *   lead 0  → t == t0 (forecast start-date timestamp)
 *   lead d  → ((d-1)·24h, d·24h]  for d >= 1
 */
export function reorganizeByLead(
  forecasts: Map<string, ForecastResult>,
  maxLead = 15,
): LeadBuckets {
  const buckets: LeadBuckets = {};
  for (let d = 0; d <= maxLead; d++) buckets[d] = { time: [], members: [] };

  for (const [dateStr, fr] of forecasts) {
    const t0 = parseStartDate(dateStr);
    if (!t0) continue;

    // Build per-timestep member rows. fr.discharge is [51 members][T].
    const T = fr.time.length;
    for (let i = 0; i < T; i++) {
      const ti = fr.time[i];
      const dt = ti.getTime() - t0.getTime();
      let lead: number;
      if (ti.getTime() === t0.getTime()) {
        lead = 0;
      } else {
        lead = Math.ceil(dt / DAY_MS);
      }
      if (lead < 0 || lead > maxLead) continue;

      const row = new Array<number>(MEMBER_COUNT);
      for (let m = 0; m < MEMBER_COUNT; m++) {
        row[m] = fr.discharge[m]?.[i] ?? Number.NaN;
      }
      buckets[lead].time.push(ti);
      buckets[lead].members.push(row);
    }
  }

  // Every consumer treats a bucket as a chronological series: the metrics take
  // time[0]/time[last] as the window bounds, and threshold crossing walks the
  // array in order looking for the *first* ascending crossing. Enforce that
  // invariant here rather than trusting the order forecasts arrived in.
  for (let d = 0; d <= maxLead; d++) buckets[d] = sortBucket(buckets[d]);
  return buckets;
}

function sortBucket(b: LeadBucket): LeadBucket {
  let ordered = true;
  for (let i = 1; i < b.time.length; i++) {
    if (b.time[i].getTime() < b.time[i - 1].getTime()) {
      ordered = false;
      break;
    }
  }
  if (ordered) return b;
  const idx = b.time.map((_, i) => i);
  idx.sort((a, c) => b.time[a].getTime() - b.time[c].getTime());
  return { time: idx.map((i) => b.time[i]), members: idx.map((i) => b.members[i]) };
}

function parseStartDate(yyyymmdd: string): Date | null {
  if (!/^\d{8}$/.test(yyyymmdd)) return null;
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
}

/** Inclusive list of YYYYMMDD strings from start..end (UTC). */
export function dailyDateRange(start: Date, end: Date): string[] {
  const out: string[] = [];
  const t0 = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const t1 = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  for (let ms = t0; ms <= t1; ms += DAY_MS) {
    const d = new Date(ms);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    out.push(`${yyyy}${mm}${dd}`);
  }
  return out;
}

/** Project a single ensemble member's column out of a lead bucket. */
export function memberSeries(bucket: LeadBucket, memberIndex: number): TimeSeries {
  return {
    time: bucket.time,
    values: bucket.members.map((row) => row[memberIndex]),
  };
}

/**
 * Per-timestep statistic across the 51 members of a lead bucket — returns a TimeSeries.
 * Mirrors the notebook's `resolve_forecast_series` for stat_*.
 */
export type StatKey = 'median' | 'mean' | 'p25' | 'p75' | 'min' | 'max';

export function statSeries(bucket: LeadBucket, stat: StatKey): TimeSeries {
  const values = bucket.members.map((row) => statOf(row, stat));
  return { time: bucket.time, values };
}

function statOf(row: number[], stat: StatKey): number {
  const valid = row.filter((x) => Number.isFinite(x));
  if (valid.length === 0) return Number.NaN;
  switch (stat) {
    case 'min':
      return Math.min(...valid);
    case 'max':
      return Math.max(...valid);
    case 'mean':
      return valid.reduce((a, b) => a + b, 0) / valid.length;
    case 'median':
      return percentile(valid, 0.5);
    case 'p25':
      return percentile(valid, 0.25);
    case 'p75':
      return percentile(valid, 0.75);
  }
}

function percentile(sortedOrUnsorted: number[], p: number): number {
  const s = [...sortedOrUnsorted].sort((a, b) => a - b);
  // numpy default `linear` interpolation (matches np.nanpercentile).
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}
