import { describe, expect, it } from 'vitest';
import { aggregationImpact } from '../../src/lib/ingest/aggregationImpact';
import type { TimeSeries } from '../../src/lib/types';

const H = 3600e3;
const t0 = Date.UTC(2024, 5, 1);
const hourly = (f: (i: number) => number, n = 24 * 20): TimeSeries => ({
  time: Array.from({ length: n }, (_, i) => new Date(t0 + i * H)),
  values: Array.from({ length: n }, (_, i) => f(i)),
});
const obsRp = { 2: 250, 5: 400, 10: 600, 25: 900, 50: 1200, 100: 1600 };

describe('aggregationImpact', () => {
  it('flags a flashy event, where the median erases what the max keeps', () => {
    // A 280 m³/s peak only 1.2 h wide, binned to 3 hours. The max retains it and
    // classifies a 2-year event; the median reports ~204 and classifies nothing.
    const flashy = hourly((i) => 20 + 260 * Math.exp(-((i - 240) ** 2) / (2 * 1.2 ** 2)));
    const r = aggregationImpact(flashy, obsRp, 3 * H, 'median')!;
    expect(r.changesEventRp).toBe(true);
    expect(r.peak.max).toBeGreaterThan(r.peak.median);
    expect(r.eventRp.max).toBe(2);
    expect(r.eventRp.median).toBe(0);
    expect(r.exceedances.max).toBeGreaterThan(r.exceedances.median);
  });

  it('stays quiet when the summary makes no difference', () => {
    // A broad crest well above the threshold: every summary agrees.
    const broad = hourly((i) => 20 + 800 * Math.exp(-((i - 240) ** 2) / (2 * 60 ** 2)));
    const r = aggregationImpact(broad, obsRp, 3 * H, 'median')!;
    expect(r.changesEventRp).toBe(false);
    expect(new Set(Object.values(r.eventRp)).size).toBe(1);
  });

  it('stays quiet when a bin holds one value', () => {
    // The common case: a daily gauge on a daily grid. All three coincide, so the
    // choice cannot change anything and the warning must not fire.
    const daily: TimeSeries = {
      time: Array.from({ length: 20 }, (_, i) => new Date(t0 + i * 24 * H)),
      values: Array.from({ length: 20 }, (_, i) => 20 + 500 * Math.exp(-((i - 10) ** 2) / 8)),
    };
    const r = aggregationImpact(daily, obsRp, 24 * H, 'median')!;
    expect(r.changesEventRp).toBe(false);
    expect(r.peak.max).toBeCloseTo(r.peak.median, 9);
  });

  it('reports every summary, not only the chosen one', () => {
    const flashy = hourly((i) => 20 + 260 * Math.exp(-((i - 240) ** 2) / (2 * 1.2 ** 2)));
    const r = aggregationImpact(flashy, obsRp, 3 * H, 'max')!;
    expect(r.chosen).toBe('max');
    for (const w of ['mean', 'median', 'max'] as const) {
      expect(Number.isFinite(r.peak[w])).toBe(true);
      expect(Number.isFinite(r.eventRp[w])).toBe(true);
    }
  });

  it('returns null with no observations', () => {
    expect(aggregationImpact({ time: [], values: [] }, obsRp, 3 * H, 'median')).toBeNull();
  });
});

describe('aggregationImpact on the forecast side', () => {
  // The common case: a DAILY gauge with 3-hourly forecasts. The grid is daily,
  // so the observations already sit on it and their peak cannot move — a
  // diagnostic looking only at them would stay silent while the choice was
  // reshaping the forecast 8 values at a time.
  const DAY = 24 * H;
  const dailyObs: TimeSeries = {
    time: Array.from({ length: 15 }, (_, i) => new Date(t0 + i * DAY)),
    values: Array.from({ length: 15 }, (_, i) => 20 + 600 * Math.exp(-((i - 7) ** 2) / 6)),
  };
  const simRp = { 2: 150, 5: 250, 10: 350, 25: 500, 50: 650, 100: 800 };
  // One lead bucket of 3-hourly members with a pronounced within-day shape, so
  // the daily max sits well above the daily median.
  const buckets = {
    1: {
      time: Array.from({ length: 15 * 8 }, (_, i) => new Date(t0 + i * 3 * H)),
      members: Array.from({ length: 15 * 8 }, (_, i) => {
        const day = Math.floor(i / 8);
        const base = 20 + 500 * Math.exp(-((day - 7) ** 2) / 6);
        const shape = 1 + 0.6 * Math.sin(((i % 8) / 8) * 2 * Math.PI);
        return [base * shape, base * shape * 0.9];
      }),
    },
  };

  it('reports which side is actually being summarised', () => {
    const r = aggregationImpact(dailyObs, obsRp, DAY, 'median', {
      buckets: buckets as never,
      simRp,
      obsStepMs: DAY,
      fcstStepMs: 3 * H,
    })!;
    expect(r.summarising).toBe('forecasts');
    // The observed peak genuinely cannot move here.
    expect(r.peak.max).toBeCloseTo(r.peak.median, 9);
    expect(r.changesEventRp).toBe(false);
  });

  it('counts forecast exceedances per summary, which is where the effect lands', () => {
    const r = aggregationImpact(dailyObs, obsRp, DAY, 'median', {
      buckets: buckets as never,
      simRp,
      obsStepMs: DAY,
      fcstStepMs: 3 * H,
    })!;
    expect(r.forecastExceedances).not.toBeNull();
    // The max cannot cross less often than the median.
    expect(r.forecastExceedances!.max).toBeGreaterThanOrEqual(r.forecastExceedances!.median);
    // And on a shape this pronounced it crosses strictly more.
    expect(r.forecastExceedances!.max).toBeGreaterThan(r.forecastExceedances!.median);
  });

  it('says nothing is summarised when both sides sit at the grid', () => {
    const r = aggregationImpact(dailyObs, obsRp, DAY, 'median', {
      buckets: null,
      simRp,
      obsStepMs: DAY,
      fcstStepMs: DAY,
    })!;
    expect(r.summarising).toBe('neither');
    expect(r.forecastExceedances).toBeNull();
  });
});
