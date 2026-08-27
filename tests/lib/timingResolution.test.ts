import { describe, expect, it } from 'vitest';
import { computePeakTiming } from '../../src/lib/metrics/peakTiming';
import { computePeakTimingByRun } from '../../src/lib/metrics/peakTimingByRun';
import { aggregateBucket, aggregateSeries, bucketCadence } from '../../src/lib/ingest/grid';
import { reorganizeByLead, memberSeries } from '../../src/lib/leadBuckets';
import type { ForecastRun } from '../../src/lib/types';

const H = 3600e3;
const D = 24 * H;

/**
 * An RFS run changes spacing across its horizon while all 51 members share one
 * time index. A Δt smaller than the lead's own spacing is therefore the argmax
 * landing on the nearest available sample, not a measurement — and on a PERFECT
 * forecast that is exactly what a naive panel reports as bias.
 */
const ev0 = Date.UTC(2019, 5, 16);
const peakMs = ev0 + 4 * D + 3 * H; // 03:00, unrepresentable on a 6-hourly lattice
const shape = (ms: number) => 20 + 300 * Math.exp(-(((ms - peakMs) / H) ** 2) / 60);

const obsTime = Array.from({ length: 16 * 8 }, (_, i) => new Date(ev0 + i * 3 * H));
const obs = { time: obsTime, values: obsTime.map((d) => shape(d.getTime())) };

/** 20 perfect runs, 3-hourly for 7 days then 6-hourly — as RFS publishes. */
function perfectRuns(): Map<string, ForecastRun> {
  const out = new Map<string, ForecastRun>();
  for (let r = 0; r < 20; r++) {
    const t0 = ev0 - 15 * D + r * D;
    const time: Date[] = [];
    for (let ms = 0; ms < 7 * D; ms += 3 * H) time.push(new Date(t0 + ms));
    for (let ms = 7 * D; ms <= 15 * D; ms += 6 * H) time.push(new Date(t0 + ms));
    const d = new Date(t0);
    const key =
      `${d.getUTCFullYear()}` +
      `${String(d.getUTCMonth() + 1).padStart(2, '0')}` +
      `${String(d.getUTCDate()).padStart(2, '0')}`;
    out.set(key, {
      time,
      discharge: Array.from({ length: 3 }, () => time.map((x) => shape(x.getTime()))),
    });
  }
  return out;
}

describe('a perfect forecast reports Δt inside its own resolution, never outside', () => {
  it('by lead: the apparent bias at the cadence break is one step', () => {
    const buckets = reorganizeByLead(perfectRuns(), 15);
    const step = 3 * H;
    const gObs = aggregateSeries(obs, step, 'mean');

    const seen: { lead: number; res: number; dt: number }[] = [];
    for (let lead = 1; lead <= 15; lead++) {
      const b = buckets[lead];
      if (!b || b.time.length < 3) continue;
      const g = aggregateBucket(b, step, 'mean');
      const res = bucketCadence(g)!.stepMs / H;
      const dt = computePeakTiming(memberSeries(g, 0), gObs).deltaHours;
      if (dt == null) continue;
      seen.push({ lead, res, dt });
    }
    expect(seen.length).toBeGreaterThan(8);

    // The finding: a PERFECT forecast is not reported as Δt = 0 everywhere.
    expect(seen.some((s) => s.dt !== 0)).toBe(true);
    // But every non-zero value is inside that lead's own spacing, which is what
    // the band has to cover for the panel to be honest.
    for (const s of seen) {
      expect(Math.abs(s.dt), `lead ${s.lead}: Δt ${s.dt}h vs ${s.res}h spacing`)
        .toBeLessThanOrEqual(s.res);
    }
    // And the resolution really does coarsen, or the test proves nothing.
    expect(new Set(seen.map((s) => s.res)).size).toBeGreaterThan(1);
  });

  it('by initialization: the same holds on raw run timestamps', () => {
    const r = computePeakTimingByRun(perfectRuns(), obs);
    expect(r.resolutionHours).toHaveLength(r.values.length);
    let checked = 0;
    for (let i = 0; i < r.values.length; i++) {
      const res = r.resolutionHours[i];
      if (res == null) continue;
      for (const dt of r.values[i]) {
        expect(Math.abs(dt), `run ${r.initDates[i]}: Δt ${dt}h vs ${res}h spacing`)
          .toBeLessThanOrEqual(res);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
