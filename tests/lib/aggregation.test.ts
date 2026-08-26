import { describe, expect, it } from 'vitest';
import { aggregateSeries, aggregateBucket } from '../../src/lib/ingest/grid';

const DAY = 86400000;
const t0 = Date.UTC(2024, 5, 10);
/** One day of 3-hourly values, deliberately skewed by a single spike. */
const vals = [10, 12, 11, 13, 12, 11, 90, 12];
const series = {
  time: vals.map((_, i) => new Date(t0 + i * 3 * 3600e3)),
  values: vals,
};

describe('aggregateSeries', () => {
  it('gives three different answers, and the median resists the spike', () => {
    expect(aggregateSeries(series, DAY, 'max').values[0]).toBe(90);
    expect(aggregateSeries(series, DAY, 'mean').values[0]).toBeCloseTo(21.375, 12);
    // Sorted: 10 11 11 12 12 12 13 90 -> middle pair 12, 12.
    expect(aggregateSeries(series, DAY, 'median').values[0]).toBe(12);
  });

  it('agrees exactly when a bin holds one value', () => {
    // The common case: a daily gauge on a daily grid. All three must coincide,
    // so the selector cannot change a number it has no business changing.
    const daily = { time: [new Date(t0), new Date(t0 + DAY)], values: [5, 7] };
    for (const how of ['mean', 'median', 'max'] as const) {
      expect(aggregateSeries(daily, DAY, how).values).toEqual([5, 7]);
    }
  });

  it('ignores non-finite values in every mode', () => {
    const gappy = {
      time: [0, 1, 2, 3].map((i) => new Date(t0 + i * 3 * 3600e3)),
      values: [10, Number.NaN, 20, Number.NaN],
    };
    expect(aggregateSeries(gappy, DAY, 'median').values[0]).toBe(15);
    expect(aggregateSeries(gappy, DAY, 'mean').values[0]).toBe(15);
    expect(aggregateSeries(gappy, DAY, 'max').values[0]).toBe(20);
  });
});

describe('aggregateBucket', () => {
  // Two members: one spiky, one flat. Members must never be mixed.
  const bucket = {
    time: vals.map((_, i) => new Date(t0 + i * 3 * 3600e3)),
    members: vals.map((v) => [v, 100]),
  };

  it('summarises each member over TIME, never across members', () => {
    const med = aggregateBucket(bucket, DAY, 'median');
    expect(med.members).toHaveLength(1);
    // Member 0 keeps its own median; member 1 stays flat at 100 rather than
    // being pooled with member 0.
    expect(med.members[0]).toEqual([12, 100]);
    const mx = aggregateBucket(bucket, DAY, 'max');
    expect(mx.members[0]).toEqual([90, 100]);
  });

  it('gives NaN for a member with no finite value in the bin, in every mode', () => {
    const b = {
      time: [new Date(t0), new Date(t0 + 3 * 3600e3)],
      members: [[Number.NaN, 5], [Number.NaN, 7]],
    };
    for (const how of ['mean', 'median', 'max'] as const) {
      const out = aggregateBucket(b, DAY, how);
      expect(Number.isNaN(out.members[0][0])).toBe(true);
      expect(Number.isFinite(out.members[0][1])).toBe(true);
    }
  });

  it('does not let the max leak -Infinity for an all-NaN member', () => {
    const b = { time: [new Date(t0)], members: [[Number.NaN]] };
    expect(Number.isNaN(aggregateBucket(b, DAY, 'max').members[0][0])).toBe(true);
  });
});
