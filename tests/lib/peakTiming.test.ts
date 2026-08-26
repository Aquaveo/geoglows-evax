import { describe, expect, it } from 'vitest';
import { computePeakTiming } from '../../src/lib/metrics/peakTiming';
import type { TimeSeries } from '../../src/lib/types';

const H = 3600e3;
const N = 84; // 21 days at 6-hourly
const time = Array.from({ length: N }, (_, i) => new Date(Date.UTC(2024, 5, 1) + i * 6 * H));
const at = (i: number) => 40 + 400 * Math.exp(-((i - 40) ** 2) / 40);
const obs: TimeSeries = { time, values: Array.from({ length: N }, (_, i) => at(i)) };
const series = (f: (i: number) => number): TimeSeries => ({
  time,
  values: Array.from({ length: N }, (_, i) => f(i)),
});

describe('computePeakTiming exclusions are facts, not thresholds', () => {
  it('reports no timing for a flat member instead of inventing one', () => {
    // Previously the tie-break returned the FIRST timestep, so every flat member
    // reported the same large "early" value and they voted in unison.
    const r = computePeakTiming(series(() => 60), obs);
    expect(r.deltaHours).toBeNull();
    expect(r.reason).toBe('no-distinct-peak');
  });

  it('reports no timing when the maximum sits on the window edge', () => {
    // A monotonically rising member: its true peak is beyond the window, so Δt
    // would be a bound rather than a measurement.
    const r = computePeakTiming(series((i) => 40 + i * 3), obs);
    expect(r.deltaHours).toBeNull();
    expect(r.reason).toBe('peak-at-window-edge');
  });

  it('scores a broad snowmelt crest, which a prominence gate rejected', () => {
    // Flood 3x baseflow with a 240-hour crest: prominence within the window is
    // 0.029, so a 0.1 gate discarded it despite it being a major event.
    const broad = series((i) => 50 + 100 * Math.exp(-(((i - 44) * 6) ** 2) / (2 * 240 ** 2)));
    const r = computePeakTiming(broad, obs);
    expect(r.reason).toBeNull();
    expect(r.deltaHours).toBeCloseTo(24, 6); // peaks at index 44 vs observed 40
  });

  it('scores a member that is badly low but correctly timed', () => {
    // Magnitude independence is the whole point of this metric, so a return-period
    // gate would have been wrong: this member runs 55% low and times it perfectly.
    const low = series((i) => at(i) * 0.45);
    const r = computePeakTiming(low, obs);
    expect(r.reason).toBeNull();
    expect(r.deltaHours).toBe(0);
  });

  it('scores a noisy member rather than hiding its scatter', () => {
    // No coherent peak, but it does have a unique maximum. Its scatter IS the
    // finding; excluding it would flatter the spread.
    let z = 3;
    const R = () => { z = (Math.imul(z, 1664525) + 1013904223) >>> 0; return z / 4294967296; };
    const r = computePeakTiming(series(() => 55 + R() * 12), obs);
    expect(r.reason === null || r.reason === 'peak-at-window-edge').toBe(true);
  });

  it('signs the error the way the plots claim', () => {
    // Positive is late, negative is early.
    expect(computePeakTiming(series((i) => at(i - 4)), obs).deltaHours).toBeGreaterThan(0);
    expect(computePeakTiming(series((i) => at(i + 4)), obs).deltaHours).toBeLessThan(0);
  });

  it('returns no-overlap for empty or disjoint series', () => {
    expect(computePeakTiming({ time: [], values: [] }, obs).reason).toBe('no-overlap');
    const far: TimeSeries = {
      time: [new Date(Date.UTC(2030, 0, 1)), new Date(Date.UTC(2030, 0, 2))],
      values: [1, 2],
    };
    expect(computePeakTiming(far, obs).reason).toBe('no-overlap');
  });
});

describe('plateaux in the by-lead module', () => {
  it('times a plateau at its first sample, matching the by-run module', () => {
    // Both sides of Δt must use the same tie rule. The observed argmax keeps the
    // first of any ties, so the forecast has to as well or every plateau reads
    // late by half its width.
    const plateau = series((i) => (i === 40 || i === 41 ? 500 : at(i)));
    const single = series((i) => (i === 40 ? 500 : at(i)));
    const a = computePeakTiming(plateau, obs);
    const b = computePeakTiming(single, obs);
    expect(a.reason).toBeNull();
    expect(a.deltaHours).toBe(b.deltaHours);
  });

  it('still reports no peak only when the member is flat throughout', () => {
    expect(computePeakTiming(series(() => 60), obs).reason).toBe('no-distinct-peak');
    expect(computePeakTiming(series((i) => (i === 40 || i === 41 ? 500 : at(i))), obs).reason)
      .toBeNull();
  });

  it('censors a plateau that runs to the window edge', () => {
    // The peak may continue past the window, so Δt would be a bound.
    const toEdge = series((i) => (i >= 80 ? 900 : at(i)));
    expect(computePeakTiming(toEdge, obs).reason).toBe('peak-at-window-edge');
  });
});
