import { describe, expect, it } from 'vitest';
import transformFixture from '../fixtures/bias/polyfit-transform.json';
import runFixture from '../fixtures/bias/polyfit-run.json';
import {
  polyval,
  probeMonth,
  transformSeries,
  transformValue,
} from '../../src/lib/bias/dischargeTransform';
import type { MonthPolyfit, RiverPolyfits } from '../../src/lib/bias/polyfitTypes';

/** Fixtures encode non-finite floats as sentinel strings. */
function num(v: number | string): number {
  if (typeof v === 'number') return v;
  if (v === 'NaN') return Number.NaN;
  if (v === 'Infinity') return Number.POSITIVE_INFINITY;
  if (v === '-Infinity') return Number.NEGATIVE_INFINITY;
  throw new Error(`unexpected sentinel ${v}`);
}

function fitsOf(c: (typeof transformFixture.cases)[number]): RiverPolyfits {
  const out: RiverPolyfits = {};
  for (const [month, f] of Object.entries(c.coefficients)) {
    out[Number(month)] = {
      qrange: [num(f.qrange[0]), num(f.qrange[1])] as [number, number],
      qtop: f.qtop.map(num),
      ptoq: f.ptoq.map(num),
    };
  }
  return out;
}

describe('polyval', () => {
  it('reads coefficients in descending powers, as np.poly1d does', () => {
    // 2x^2 + 3x + 4 at x = 5 -> 50 + 15 + 4
    expect(polyval([2, 3, 4], 5)).toBe(69);
    // Getting the order backwards would give 4*25 + 3*5 + 2 = 117.
    expect(polyval([2, 3, 4], 5)).not.toBe(117);
  });

  it('handles a degree-7 polynomial without loss against a direct sum', () => {
    const c = [1e-12, 2e-10, 3e-8, 1e-6, -4e-3, 1e-1, -9e-1, 4.5];
    const x = 12.5;
    let direct = 0;
    for (let i = 0; i < c.length; i++) direct += c[i] * x ** (c.length - 1 - i);
    expect(polyval(c, x)).toBeCloseTo(direct, 10);
  });
});

describe('discharge_transform parity with the python package', () => {
  for (const c of transformFixture.cases) {
    const fits = fitsOf(c);

    it(`reproduces every probe point for river ${c.riverId}`, () => {
      let worst = 0;
      let worstAt = '';
      for (const p of c.probes) {
        const got = transformValue(fits[p.month], num(p.input));
        const want = num(p.expected);
        if (Number.isNaN(want)) {
          expect(Number.isNaN(got)).toBe(true);
          continue;
        }
        const diff = Math.abs(got - want);
        if (diff > worst) {
          worst = diff;
          worstAt = `month ${p.month}, q=${p.input}: got ${got}, want ${want}`;
        }
      }
      // Same double arithmetic in the same order, so this should be exact.
      expect(worst, worstAt).toBeLessThan(1e-9);
    });

    it(`never returns a non-finite value for river ${c.riverId}`, () => {
      // The whole point of preferring this over the empirical-CDF method: the
      // polynomials are finite everywhere and the percentile is clamped, so
      // there is no division and therefore no divide-by-zero infinity.
      for (const p of c.probes) {
        expect(Number.isFinite(transformValue(fits[p.month], num(p.input)))).toBe(true);
      }
    });

    it('clips inputs beyond Qrange rather than extrapolating the fit', () => {
      for (const month of [1, 6, 10, 12]) {
        const fit = fits[month];
        const atMax = transformValue(fit, fit.qrange[1]);
        expect(transformValue(fit, fit.qrange[1] * 10)).toBe(atMax);
        expect(transformValue(fit, 1e12)).toBe(atMax);
      }
    });
  }
});

describe('transformSeries', () => {
  const fits = fitsOf(transformFixture.cases[0]);

  it('picks the month from each timestamp in UTC', () => {
    // 2024-10-31T23:00Z is October; one hour later is November, and the two
    // months have different coefficients, so the outputs must differ.
    const time = [new Date('2024-10-31T23:00:00Z'), new Date('2024-11-01T00:00:00Z')];
    const { values, diagnostics } = transformSeries(time, [8, 8], fits);
    expect(diagnostics.months).toEqual([10, 11]);
    expect(values[0]).not.toBe(values[1]);
  });

  it('passes non-finite inputs through untouched and excludes them from n', () => {
    const time = [new Date('2024-10-01T00:00:00Z'), new Date('2024-10-01T03:00:00Z')];
    const { values, diagnostics } = transformSeries(time, [NaN, 5], fits);
    expect(Number.isNaN(values[0])).toBe(true);
    expect(diagnostics.n).toBe(1);
  });

  it('counts inputs clipped at the top of Qrange', () => {
    const qmax = fits[10].qrange[1];
    const time = [0, 1, 2].map((i) => new Date(Date.UTC(2024, 9, 1, i)));
    const { diagnostics } = transformSeries(time, [1, qmax + 1, qmax * 5], fits);
    expect(diagnostics.clippedToQmax).toBe(2);
  });

  it('reports saturation, which is this method’s real limitation', () => {
    // October on this river saturates: the percentile clamps to 0 well inside
    // Qrange, so every larger discharge maps onto one value. That is not a bug
    // to fix but a property to surface -- it means the corrected series cannot
    // tell two flood-magnitude forecasts apart.
    const { diagnostics } = transformSeries(
      [new Date('2024-10-15T00:00:00Z')],
      [20],
      fits,
    );
    const s = diagnostics.saturation[10];
    expect(s.ceiling).not.toBeNull();
    expect(s.ceiling!.atDischarge).toBeLessThan(fits[10].qrange[1]);
    // Everything inside that region really is identical: 20 and 100 m3/s, five
    // times apart, come out as the same number.
    expect(Math.abs(transformValue(fits[10], 20) - transformValue(fits[10], 100)))
      .toBeLessThan(1e-9);
    expect(s.ceiling!.toValue).toBeCloseTo(transformValue(fits[10], 20), 9);
  });

  it('does not assume the saturated region reaches Qrange’s upper endpoint', () => {
    // The percentile polynomial rises back above zero exactly at the top of
    // October's range, so the endpoint escapes the clamp and maps slightly
    // lower than everything just below it. Harmless, but it means the endpoint
    // must not be used as the representative saturated value.
    const fit = fits[10];
    const inside = transformValue(fit, 100);
    const endpoint = transformValue(fit, fit.qrange[1]);
    expect(endpoint).toBeLessThan(inside);
    expect(inside - endpoint).toBeLessThan(1);
  });

  it('clamps negative outputs to zero', () => {
    const probe = probeMonth(fits[11]);
    expect(probe).toBeDefined();
    const time = Array.from({ length: 5 }, (_, i) => new Date(Date.UTC(2024, 10, 1, i)));
    const { values } = transformSeries(time, [30, 40, 50, 60, 69], fits);
    for (const v of values) expect(v).toBeGreaterThanOrEqual(0);
  });
});

describe('a real forecast run, end to end', () => {
  it('matches the python output column for column', () => {
    const time = runFixture.time.map((t) => new Date(t));
    const fits = fitsOf(transformFixture.cases[0]);
    let worst = 0;
    for (const col of runFixture.columns) {
      const original = (runFixture.original as Record<string, (number | string)[]>)[col].map(num);
      const expected = (runFixture.corrected as Record<string, (number | string)[]>)[col].map(num);
      const { values } = transformSeries(time, original, fits);
      for (let i = 0; i < expected.length; i++) {
        if (!Number.isFinite(expected[i])) continue;
        // The port clamps negatives to zero; python does not. Compare on the
        // clamped value so the two agree where python went slightly negative.
        worst = Math.max(worst, Math.abs(values[i] - Math.max(expected[i], 0)));
      }
    }
    expect(worst).toBeLessThan(1e-9);
  });

  it('produces no infinities on a run the empirical-CDF method could not correct', () => {
    // 2024-10-25 is one of the six runs the local quantile mapping had to
    // exclude for mapping to infinity. This method handles it.
    const time = runFixture.time.map((t) => new Date(t));
    const fits = fitsOf(transformFixture.cases[0]);
    for (const col of runFixture.columns) {
      const original = (runFixture.original as Record<string, (number | string)[]>)[col].map(num);
      const { values } = transformSeries(time, original, fits);
      expect(values.every((v) => Number.isFinite(v))).toBe(true);
    }
  });
});

describe('saturation is reported at both ends, each measured in its own region', () => {
  // Clamps at BOTH ends: the percentile exceeds 100 at low flow and drops below
  // 0 at high flow. exp(5 - 0.06q) - 1 crosses 100 at q = 6.42 and 0 at q = 83.33.
  const both: MonthPolyfit = { qrange: [0, 100], qtop: [-0.06, 5], ptoq: [-0.03, 4] };

  it('reports the ceiling, which walking upward from Qmin always missed', () => {
    // The defect: the probe walked discharge ascending and stopped at the first
    // clamped sample. Low discharge carries HIGH percentile, so that walk always
    // met the floor first and a both-ends month reported end='floor' with the
    // ceiling — the end that flattens floods — never mentioned.
    const s = probeMonth(both);
    expect(s.ceiling).not.toBeNull();
    expect(s.floor).not.toBeNull();
    expect(s.ceiling!.atDischarge).toBeCloseTo(83.33, 1);
    expect(s.floor!.atDischarge).toBeCloseTo(6.42, 1);
  });

  it('quotes a value inputs in that region actually map to', () => {
    // The defect: toValue was transformValue(fit, (firstClip + hi) / 2). With
    // firstClip at the floor that sampled the middle of the HEALTHY range, so
    // the banner claimed "everything above 0.0 maps to 44.08" while 0.5, 50 and
    // 100 gave 1.72, 44.08 and 53.60 — 44.08 being just the midpoint's value.
    const s = probeMonth(both);
    // Each region's quoted value is what the whole region really produces.
    expect(s.ceiling!.toValue).toBeCloseTo(transformValue(both, 90), 6);
    expect(s.ceiling!.toValue).toBeCloseTo(transformValue(both, 100), 6);
    expect(s.floor!.toValue).toBeCloseTo(transformValue(both, 0), 6);
    expect(s.floor!.toValue).toBeCloseTo(transformValue(both, 3), 6);
    // And is NOT the midpoint value that used to be reported.
    expect(Math.abs(s.ceiling!.toValue - transformValue(both, 50))).toBeGreaterThan(1);
    expect(Math.abs(s.floor!.toValue - transformValue(both, 50))).toBeGreaterThan(1);
  });

  it('never quotes a negative corrected discharge', () => {
    // transformSeries clamps its output at zero, so a probe that did not would
    // quote a value no forecast can receive.
    const undershoot: MonthPolyfit = { qrange: [0, 100], qtop: [-0.06, 5], ptoq: [-0.03, -2] };
    const s = probeMonth(undershoot);
    if (s.floor) expect(s.floor.toValue).toBeGreaterThanOrEqual(0);
    if (s.ceiling) expect(s.ceiling.toValue).toBeGreaterThanOrEqual(0);
  });

  it('reports a ceiling-only month with no floor, and the reverse', () => {
    // Percentile stays inside (0, 100] until high flow: ceiling only.
    const ceilOnly: MonthPolyfit = { qrange: [1, 100], qtop: [-0.06, 4], ptoq: [-0.03, 4] };
    const a = probeMonth(ceilOnly);
    expect(a.floor).toBeNull();
    expect(a.ceiling).not.toBeNull();
  });

  it('counts inputs clipped UP to Qmin, not just down to Qmax', () => {
    // The defect: clippedToQmax existed alone, so a forecast clipped up to the
    // fitted minimum was indistinguishable from one inside the range.
    const fit: RiverPolyfits = { 6: { qrange: [10, 100], qtop: [-0.06, 5], ptoq: [-0.03, 4] } };
    const time = Array.from({ length: 4 }, (_, i) => new Date(Date.UTC(2024, 5, 1, i)));
    const { diagnostics } = transformSeries(time, [-5, 2, 50, 400], fit);
    expect(diagnostics.clippedToQmin).toBe(2);
    expect(diagnostics.clippedToQmax).toBe(1);
  });
});
