import type { TimeSeries } from '../types';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export interface Cadence {
  /** Median spacing between consecutive samples, in ms. */
  stepMs: number;
  /** Human label, e.g. "hourly", "3-hourly", "daily". */
  label: string;
  /** Samples the estimate is based on. */
  nSamples: number;
  /**
   * True when spacing varies enough that a single step does not describe the
   * series — gappy gauge records, mixed reporting intervals, or a forecast whose
   * cadence coarsens with lead time.
   */
  irregular: boolean;
  /** Share of gaps within 10% of the median, for reporting. */
  regularShare: number;
}

/**
 * Infer a series' native sampling interval.
 *
 * This exists because the app must not upsample: knowing that observations
 * arrive daily is what stops a daily record being interpolated into 24× as many
 * fake hourly points. The median is used rather than the mean so that a few
 * large gaps do not inflate the estimate.
 */
export function detectCadence(s: TimeSeries): Cadence | null {
  if (s.time.length < 2) return null;

  const times = s.time.map((d) => d.getTime()).sort((a, b) => a - b);
  const diffs: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1];
    if (d > 0) diffs.push(d); // skip exact duplicates
  }
  if (diffs.length === 0) return null;

  const sorted = [...diffs].sort((a, b) => a - b);
  const stepMs = sorted[Math.floor(sorted.length / 2)];

  let regular = 0;
  for (const d of diffs) if (Math.abs(d - stepMs) <= stepMs * 0.1) regular++;
  const regularShare = regular / diffs.length;

  return {
    stepMs,
    label: describeStep(stepMs),
    nSamples: s.time.length,
    irregular: regularShare < 0.8,
    regularShare,
  };
}

/** "hourly", "3-hourly", "daily", "15-minute", … */
export function describeStep(stepMs: number): string {
  if (stepMs % DAY_MS === 0) {
    const n = stepMs / DAY_MS;
    return n === 1 ? 'daily' : `${n}-daily`;
  }
  if (stepMs % HOUR_MS === 0) {
    const n = stepMs / HOUR_MS;
    return n === 1 ? 'hourly' : `${n}-hourly`;
  }
  if (stepMs % MINUTE_MS === 0) {
    const n = stepMs / MINUTE_MS;
    return `${n}-minute`;
  }
  return `${Math.round(stepMs / 1000)}-second`;
}
