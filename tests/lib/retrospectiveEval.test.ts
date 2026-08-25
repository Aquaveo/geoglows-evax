import { describe, expect, it } from 'vitest';
import {
  flowDurationCurve,
  monthlyBias,
  murphyDecomposition,
  noiseFloorRes,
  pairDaily,
  summarise,
} from '../../src/lib/metrics/retrospectiveEval';

const DAY = 24 * 3600 * 1000;
const t0 = Date.UTC(2000, 0, 1);

function series(n: number, f: (i: number) => number, stepMs = DAY) {
  return {
    time: Array.from({ length: n }, (_, i) => new Date(t0 + i * stepMs)),
    values: Array.from({ length: n }, (_, i) => f(i)),
  };
}

describe('pairDaily', () => {
  it('reduces both sides to daily means before joining', () => {
    // Hourly simulated, daily observed — the real shape: retrospective is
    // hourly, an uploaded record is usually daily.
    const sim = series(48, (i) => (i < 24 ? 10 : 20), 3600e3);
    const obs = series(2, () => 15);
    const p = pairDaily(sim, obs);
    expect(p.days).toEqual(['2000-01-01', '2000-01-02']);
    expect(p.sim).toEqual([10, 20]);
  });

  it('inner joins and counts what it dropped', () => {
    const sim = series(5, () => 1);
    const obs = { time: [new Date(t0 + DAY)], values: [2] };
    const p = pairDaily(sim, obs);
    expect(p.sim).toHaveLength(1);
    expect(p.simOnly).toBe(4);
    expect(p.obsOnly).toBe(0);
  });

  it('skips non-finite values rather than averaging them in', () => {
    const sim = { time: [new Date(t0), new Date(t0 + 3600e3)], values: [10, NaN] };
    const obs = { time: [new Date(t0)], values: [5] };
    expect(pairDaily(sim, obs).sim).toEqual([10]);
  });

  it('returns days in chronological order regardless of input order', () => {
    const sim = { time: [new Date(t0 + 2 * DAY), new Date(t0)], values: [3, 1] };
    const obs = { time: [new Date(t0), new Date(t0 + 2 * DAY)], values: [1, 3] };
    expect(pairDaily(sim, obs).days).toEqual(['2000-01-01', '2000-01-03']);
  });
});

describe('murphyDecomposition', () => {
  it('closes exactly when the simulated value is constant within each bin', () => {
    // Two distinct simulated values -> two bins, no within-bin spread, so the
    // identity MSE = REL - RES + var(obs) is exact.
    const sim: number[] = [];
    const obs: number[] = [];
    for (let i = 0; i < 400; i++) {
      sim.push(i < 200 ? 10 : 20);
      obs.push(i < 200 ? 12 + (i % 2) : 25 + (i % 2));
    }
    const d = murphyDecomposition(sim, obs, 2)!;
    expect(Math.abs(d.closurePct)).toBeLessThan(1e-6);
    expect(d.rel - d.res + d.unc).toBeCloseTo(d.mse, 8);
  });

  it('leaves a residual for continuous inputs, shrinking as bins are added', () => {
    const sim: number[] = [];
    const obs: number[] = [];
    for (let i = 0; i < 4000; i++) {
      const s = i / 40;
      sim.push(s);
      obs.push(s * 1.4 + 5);
    }
    const coarse = murphyDecomposition(sim, obs, 5)!;
    const fine = murphyDecomposition(sim, obs, 100)!;
    expect(Math.abs(fine.closurePct)).toBeLessThan(Math.abs(coarse.closurePct));
  });

  it('reports zero resolution when the model carries no information', () => {
    // Observations independent of the simulation: every conditional mean should
    // land on the overall mean, so RES collapses.
    const sim = Array.from({ length: 2000 }, (_, i) => i % 50);
    const obs = Array.from({ length: 2000 }, (_, i) => (i % 7) * 3);
    const d = murphyDecomposition(sim, obs, 10)!;
    expect(d.res).toBeLessThan(noiseFloorRes(d.unc, 10, d.n) * 6);
  });

  it('recovers a known slope of the conditional means', () => {
    const sim = Array.from({ length: 2000 }, (_, i) => i / 20);
    const obs = sim.map((s) => s * 2);
    const d = murphyDecomposition(sim, obs, 20)!;
    expect(d.slope).toBeCloseTo(2, 2);
  });

  it('refuses a sample too small for the requested bins', () => {
    expect(murphyDecomposition([1, 2, 3], [1, 2, 3], 50)).toBeNull();
  });
});

describe('monthlyBias', () => {
  it('computes the ratio per calendar month across years', () => {
    const days: string[] = [];
    const sim: number[] = [];
    const obs: number[] = [];
    for (const y of [2000, 2001]) {
      for (const m of ['01', '07']) {
        days.push(`${y}-${m}-15`);
        sim.push(m === '01' ? 5 : 20);
        obs.push(10);
      }
    }
    const rows = monthlyBias({ days, sim, obs, simOnly: 0, obsOnly: 0 });
    expect(rows.map((r) => r.month)).toEqual([1, 7]);
    expect(rows[0].ratio).toBeCloseTo(0.5, 10);
    expect(rows[1].ratio).toBeCloseTo(2.0, 10);
    expect(rows[0].n).toBe(2);
  });
});

describe('flowDurationCurve', () => {
  it('is monotonically non-increasing as exceedance rises', () => {
    const v = Array.from({ length: 1000 }, (_, i) => i);
    const fdc = flowDurationCurve(v, 50);
    for (let i = 1; i < fdc.length; i++) {
      expect(fdc[i].exceedance).toBeGreaterThan(fdc[i - 1].exceedance);
      expect(fdc[i].value).toBeLessThanOrEqual(fdc[i - 1].value);
    }
  });

  it('puts the largest values at the smallest exceedance', () => {
    const fdc = flowDurationCurve(Array.from({ length: 1000 }, (_, i) => i), 50);
    expect(fdc[0].value).toBeGreaterThan(fdc[fdc.length - 1].value);
  });
});

describe('summarise', () => {
  it('gives NSE 1 and KGE 1 for a perfect match', () => {
    const days = Array.from({ length: 500 }, (_, i) =>
      new Date(t0 + i * DAY).toISOString().slice(0, 10),
    );
    const v = Array.from({ length: 500 }, (_, i) => 10 + Math.sin(i / 9) * 4);
    const s = summarise({ days, sim: [...v], obs: [...v], simOnly: 0, obsOnly: 0 })!;
    expect(s.nse).toBeCloseTo(1, 10);
    expect(s.kge).toBeCloseTo(1, 8);
    expect(s.pbias).toBeCloseTo(0, 10);
  });

  it('reports a negative percent bias when the model runs low', () => {
    const days = Array.from({ length: 500 }, (_, i) =>
      new Date(t0 + i * DAY).toISOString().slice(0, 10),
    );
    const obs = Array.from({ length: 500 }, () => 100);
    const sim = Array.from({ length: 500 }, () => 76);
    const s = summarise({ days, sim, obs, simOnly: 0, obsOnly: 0 })!;
    expect(s.pbias).toBeCloseTo(-24, 8);
    expect(s.beta).toBeCloseTo(0.76, 10);
  });
});
