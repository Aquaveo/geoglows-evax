import type { LeadBucket, TimeSeries } from './types';
import { memberSeries, statSeries } from './leadBuckets';
import type { StatKey } from './leadBuckets';

/** Dropdown labels mirror the notebook's `get_forecast_options`. */
export const STAT_KEYS: { key: `stat_${StatKey}`; label: string }[] = [
  { key: 'stat_median', label: 'Median (p50)' },
  { key: 'stat_mean', label: 'Mean' },
  { key: 'stat_p25', label: 'Percentile 25' },
  { key: 'stat_p75', label: 'Percentile 75' },
  { key: 'stat_min', label: 'Minimum' },
  { key: 'stat_max', label: 'Maximum' },
];

export function memberKeys(): string[] {
  return Array.from({ length: 51 }, (_, i) => `ensemble_${String(i + 1).padStart(2, '0')}`);
}

export function allSeriesKeys(): string[] {
  return [...memberKeys(), ...STAT_KEYS.map((s) => s.key)];
}

export function resolveSeries(bucket: LeadBucket, key: string): TimeSeries {
  if (key.startsWith('ensemble_')) {
    const idx = Number(key.split('_')[1]) - 1;
    if (idx < 0 || idx >= 51) throw new Error(`Bad ensemble key: ${key}`);
    return memberSeries(bucket, idx);
  }
  if (key.startsWith('stat_')) {
    const stat = key.replace('stat_', '') as StatKey;
    return statSeries(bucket, stat);
  }
  throw new Error(`Unknown forecast series key: ${key}`);
}
