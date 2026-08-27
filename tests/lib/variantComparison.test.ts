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
/**
 * Skill rows carry BOTH nse and kge, and the table sources both from here — not
 * KGE' from the accuracy distributions, which left it dashed beside a populated
 * NSE computed from the same kge() call, and gated on a different member set.
 */
const skillRows = (nse: number, kgeVal: number) =>
  [0, 1].map((i) => ({
    label: `Lead ${i}`,
    nse,
    kge: kgeVal,
    pairs: 30,
    members: 2,
    nseMembers: 2,
    kgeMembers: 2,
  }));

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
    skill: { raw: skillRows(0.2, 0.4), local: skillRows(0.3, 0.6), global: null },
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

describe("KGE′ is sourced where NSE is", () => {
  it('fills from the skill rows even when the accuracy block has not run', () => {
    // The defect: KGE' read the accuracy distributions, which sit behind their own
    // Compute button, so the table rendered KGE' as a dash beside a populated NSE
    // — both of which come from the same kge() call on the same members.
    const rows = variantComparison({
      accuracy: { raw: null, local: null, global: null },
      skill: { raw: skillRows(-2.446, 0.31), local: skillRows(-1.096, 0.52), global: null },
      crps: { raw: null, local: null, global: null },
    });
    const kge = rows.find((r) => r.metric === "KGE′")!;
    const nse = rows.find((r) => r.metric === 'NSE')!;
    expect(kge.values.raw).toBeCloseTo(0.31, 12);
    expect(kge.values.local).toBeCloseTo(0.52, 12);
    // Neither is dashed while the other is populated.
    expect(Number.isFinite(kge.values.raw)).toBe(Number.isFinite(nse.values.raw));
  });

  it('tags every row with the computation that fills it', () => {
    const rows = variantComparison({
      accuracy: { raw: null, local: null, global: null },
      skill: { raw: null, local: null, global: null },
      crps: { raw: null, local: null, global: null },
    });
    const need = (m: string) => rows.find((r) => r.metric.startsWith(m))!.needs;
    expect(need('KGE')).toBe('skill');
    expect(need('NSE')).toBe('skill');
    expect(need('Correlation')).toBe('accuracy');
    expect(need('Bias ratio')).toBe('accuracy');
    expect(need('Variability')).toBe('accuracy');
    expect(need('CRPS (')).toBe('crps');
    expect(need('CRPSS')).toBe('crps');
  });
});
