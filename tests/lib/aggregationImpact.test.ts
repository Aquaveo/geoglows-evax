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
