import type { TimeSeries } from '../types';

const HOUR_MS = 3600 * 1000;

/**
 * Ensure a series is at hourly resolution.
 *  - sub-hourly  → bucket-average to hour
 *  - hourly      → return as-is (sorted)
 *  - coarser     → linearly interpolate to hourly
 */
export function resampleHourly(s: TimeSeries): TimeSeries {
  if (s.time.length === 0) return s;

  // Sort by time.
  const idx = s.time.map((_, i) => i).sort((a, b) => s.time[a].getTime() - s.time[b].getTime());
  const t = idx.map((i) => s.time[i]);
  const v = idx.map((i) => s.values[i]);

  // Median step.
  const diffs: number[] = [];
  for (let i = 1; i < t.length; i++) diffs.push(t[i].getTime() - t[i - 1].getTime());
  diffs.sort((a, b) => a - b);
  const medianMs = diffs[Math.floor(diffs.length / 2)] ?? HOUR_MS;

  // Hourly already (within 1 minute tolerance).
  if (Math.abs(medianMs - HOUR_MS) < 60_000) {
    return { time: t, values: v };
  }

  if (medianMs < HOUR_MS) {
    return aggregateMeanHourly(t, v);
  }
  return interpolateLinearHourly(t, v);
}

function aggregateMeanHourly(t: Date[], v: number[]): TimeSeries {
  const buckets = new Map<number, { sum: number; n: number }>();
  for (let i = 0; i < t.length; i++) {
    const hourStart = Math.floor(t[i].getTime() / HOUR_MS) * HOUR_MS;
    const b = buckets.get(hourStart) ?? { sum: 0, n: 0 };
    b.sum += v[i];
    b.n += 1;
    buckets.set(hourStart, b);
  }
  const keys = [...buckets.keys()].sort((a, b) => a - b);
  return {
    time: keys.map((k) => new Date(k)),
    values: keys.map((k) => {
      const b = buckets.get(k)!;
      return b.sum / b.n;
    }),
  };
}

function interpolateLinearHourly(t: Date[], v: number[]): TimeSeries {
  const start = Math.ceil(t[0].getTime() / HOUR_MS) * HOUR_MS;
  const end = Math.floor(t[t.length - 1].getTime() / HOUR_MS) * HOUR_MS;
  const time: Date[] = [];
  const values: number[] = [];

  let j = 0;
  for (let ms = start; ms <= end; ms += HOUR_MS) {
    while (j < t.length - 1 && t[j + 1].getTime() < ms) j++;
    const t0 = t[j].getTime();
    const t1 = t[j + 1]?.getTime() ?? t0;
    if (t1 === t0) {
      time.push(new Date(ms));
      values.push(v[j]);
      continue;
    }
    const w = (ms - t0) / (t1 - t0);
    time.push(new Date(ms));
    values.push(v[j] * (1 - w) + v[j + 1] * w);
  }
  return { time, values };
}
