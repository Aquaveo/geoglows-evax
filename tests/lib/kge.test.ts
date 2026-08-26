import { describe, expect, it } from 'vitest';
import { kge } from '../../src/lib/metrics/kge';
import type { TimeSeries } from '../../src/lib/types';

const t = (n: number) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i)));
const N = 30;
const obs: TimeSeries = {
  time: t(N),
  values: Array.from({ length: N }, (_, i) => 20 + 60 * Math.exp(-((i - 15) ** 2) / 40) + (i % 7)),
};
const flat = (c: number): TimeSeries => ({ time: t(N), values: Array.from({ length: N }, () => c) });

describe('kge with a constant forecast', () => {
  // Saturation maps every larger discharge to one value and the negative clamp
  // maps to exactly 0, so constant members are what the corrected variants
  // produce. Each of these constants is a perfectly flat forecast.
  const constants = [32, 12.7, 31.4159, 0.1, 1000, 517.4, 88.88, 3.3];

  it('treats every constant the same, whatever its bit pattern', () => {
    // The defect: the guard tested the COMPUTED standard deviation for exact
    // zero. Summing 30 copies of 12.7 and dividing by 30 does not round-trip, so
    // sd came out 5.4e-15 rather than 0 and the constant slipped through to
    // publish an r built from rounding residue. 32 and 1000 round-trip exactly
    // and were caught. Same physical situation, opposite outcome.
    const results = constants.map((c) => kge(flat(c), obs));
    for (const r of results) {
      expect(Number.isNaN(r.r)).toBe(true);
      expect(Number.isNaN(r.kge)).toBe(true);
    }
  });

  it('still reports beta and gamma, which are well defined for a flat forecast', () => {
    // These were suppressed by the same guard. Gamma is 0 for a flat forecast --
    // "no variability at all" -- which is the informative answer, and it is
    // exactly what the variability panel exists to show when the transform has
    // saturated.
    const r = kge(flat(40), obs);
    const muO = obs.values.reduce((a, b) => a + b, 0) / obs.values.length;
    expect(r.beta).toBeCloseTo(40 / muO, 12);
    expect(r.gamma).toBe(0);
  });

  it('reports NSE, which needs neither', () => {
    expect(Number.isFinite(kge(flat(40), obs).nse)).toBe(true);
  });

  it('withholds beta only when the OBSERVED mean is zero', () => {
    const zeroObs: TimeSeries = { time: t(4), values: [-1, 1, -1, 1] };
    const f: TimeSeries = { time: t(4), values: [1, 2, 3, 4] };
    expect(Number.isNaN(kge(f, zeroObs).beta)).toBe(true);
  });
});

describe('kge with a normal forecast', () => {
  const good: TimeSeries = { time: t(N), values: obs.values.map((v) => v * 1.05) };

  it('is unchanged by the guard rework', () => {
    const r = kge(good, obs);
    expect(r.r).toBeCloseTo(1, 10);
    expect(r.beta).toBeCloseTo(1.05, 10);
    expect(r.gamma).toBeCloseTo(1, 10);
    expect(Number.isFinite(r.kge)).toBe(true);
  });

  it('matches the KGE-prime definition exactly', () => {
    const r = kge(good, obs);
    const expected = 1 - Math.sqrt((r.r - 1) ** 2 + (r.beta - 1) ** 2 + (r.gamma - 1) ** 2);
    expect(r.kge).toBeCloseTo(expected, 12);
  });

  it('withholds everything when the observations are flat', () => {
    // r is 0/0 on that side too, and gamma divides by an observed CV of 0.
    const r = kge(good, flat(50));
    expect(Number.isNaN(r.r)).toBe(true);
    expect(Number.isNaN(r.gamma)).toBe(true);
    expect(Number.isNaN(r.kge)).toBe(true);
    expect(Number.isFinite(r.beta)).toBe(true);
  });
});

describe('per-metric member counts', () => {
  it('lets NSE and KGE-prime disagree on how many members backed them', async () => {
    // With the guards split, a flat member scores NSE but not KGE'. The hover
    // used to print max(nse, kge) under BOTH bars, overstating whichever had
    // fewer.
    const { skillByLead } = await import('../../src/lib/metrics/skillSummary');
    const times = t(N);
    const bucket = {
      time: times,
      // member 0 tracks the observations, member 1 is flat at a constant that
      // does NOT round-trip, so the old guard let it through.
      members: obs.values.map((v) => [v * 1.05, 12.7]),
    };
    const rows = skillByLead({ 1: bucket } as never, obs, { maxLead: 1, minPairs: 5 });
    const scored = rows.find((r) => r.kgeMembers > 0 || r.nseMembers > 0);
    expect(scored).toBeDefined();
    expect(scored!.nseMembers).toBe(2);
    expect(scored!.kgeMembers).toBe(1);
  });
});
