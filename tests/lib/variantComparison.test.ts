import { describe, expect, it } from 'vitest';
import { variantComparison, improvement, median } from '../../src/lib/metrics/variantComparison';
import type { PerLeadDistribution } from '../../src/plots/distributionVsLead';

const dist = (perLead: number[][]): PerLeadDistribution => ({
  leads: perLead.map((_, i) => i),
  values: perLead,
  pairs: perLead.map(() => 30),
  skipped: perLead.map(() => null),
});
const acc = (v: number) => ({
  kge: dist([[v, v], [v, v]]),
  r: dist([[v, v], [v, v]]),
  beta: dist([[v, v], [v, v]]),
  gamma: dist([[v, v], [v, v]]),
});

describe('median', () => {
  it('ignores non-finite values and averages the middle pair', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([Number.NaN, 5, Number.NaN])).toBe(5);
    expect(Number.isNaN(median([]))).toBe(true);
    expect(Number.isNaN(median([Number.NaN]))).toBe(true);
  });
});

describe('variantComparison', () => {
  const rows = variantComparison({
    accuracy: { raw: acc(0.4), local: acc(0.6), global: null },
    skill: { raw: null, local: null, global: null },
    crps: { raw: null, local: null, global: null },
  });

  it('summarises each variant as a median across leads', () => {
    const kge = rows.find((r) => r.metric === "KGE′")!;
    expect(kge.values.raw).toBeCloseTo(0.4, 12);
    expect(kge.values.local).toBeCloseTo(0.6, 12);
  });

  it('reports NaN for a variant that was never computed', () => {
    const kge = rows.find((r) => r.metric === "KGE′")!;
    expect(Number.isNaN(kge.values.global)).toBe(true);
  });

  it('covers the metrics the section is about', () => {
    const names = rows.map((r) => r.metric);
    expect(names).toEqual([
      "KGE′", 'NSE', 'Correlation r', 'Bias ratio β', 'Variability ratio γ',
      'CRPS (m³/s)', 'CRPSS',
    ]);
  });
});

describe('improvement', () => {
  const row = (metric: string, lowerIsBetter = false) =>
    variantComparison({
      accuracy: { raw: null, local: null, global: null },
      skill: { raw: null, local: null, global: null },
      crps: { raw: null, local: null, global: null },
    }).find((r) => r.metric === metric)! ?? { metric, lowerIsBetter, ideal: '1', digits: 3, values: {} as never };

  it('treats a rise as improvement for scores that target 1 from below', () => {
    expect(improvement(row("KGE′"), 0.4, 0.6)).toBeCloseTo(0.2, 12);
    expect(improvement(row("KGE′"), 0.6, 0.4)).toBeCloseTo(-0.2, 12);
  });

  it('treats a FALL as improvement for CRPS, where lower is better', () => {
    expect(improvement(row('CRPS (m³/s)'), 12, 8)).toBeCloseTo(4, 12);
    expect(improvement(row('CRPS (m³/s)'), 8, 12)).toBeCloseTo(-4, 12);
  });

  it('measures β and γ as distance from 1, in either direction', () => {
    // This is the case a naive "higher is better" gets wrong: over-correcting
    // past 1 is not an improvement.
    expect(improvement(row('Bias ratio β'), 0.6, 1.0)).toBeCloseTo(0.4, 12);
    expect(improvement(row('Bias ratio β'), 1.0, 1.4)).toBeCloseTo(-0.4, 12);
    // A rise that overshoots: 0.9 -> 1.4 moves AWAY from the ideal.
    expect(improvement(row('Bias ratio β'), 0.9, 1.4)).toBeCloseTo(-0.3, 12);
    expect(improvement(row('Variability ratio γ'), 1.5, 1.1)).toBeCloseTo(0.4, 12);
  });

  it('returns NaN when either side is missing', () => {
    expect(Number.isNaN(improvement(row("KGE′"), Number.NaN, 0.5))).toBe(true);
    expect(Number.isNaN(improvement(row("KGE′"), 0.5, Number.NaN))).toBe(true);
  });
});
