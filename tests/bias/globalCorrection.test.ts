import { describe, expect, it } from 'vitest';
import { correctForecastsGlobal } from '../../src/lib/bias/globalCorrection';
import { isUsableFit } from '../../src/lib/bias/dischargeTransform';
import type { ForecastRun } from '../../src/lib/types';
import type { RiverPolyfits } from '../../src/lib/bias/polyfitTypes';

const GOOD = {
  qrange: [0, 1000] as [number, number],
  qtop: [0, 0, 0, 0, 0, 0, 0.001, 0],
  ptoq: [0, 0, 0, 0, 0, 0, 0.9, 0],
};
const NAN_FIT = {
  qrange: [Number.NaN, Number.NaN] as [number, number],
  qtop: Array(8).fill(Number.NaN),
  ptoq: Array(8).fill(Number.NaN),
};
/** All months good except `broken`. */
const fitsWithBroken = (broken: number): RiverPolyfits =>
  Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [i + 1, i + 1 === broken ? NAN_FIT : GOOD]),
  ) as RiverPolyfits;

const runIn = (month: number, days: number): Map<string, ForecastRun> => {
  const time = Array.from(
    { length: days * 4 },
    (_, i) => new Date(Date.UTC(2024, month - 1, 20) + i * 6 * 3600e3),
  );
  return new Map([['x', { time, discharge: [time.map((_, i) => 50 + 300 * Math.exp(-((i - 20) ** 2) / 60))] }]]);
};

describe('isUsableFit', () => {
  it('rejects NaN coefficients, which no comparison can detect', () => {
    // Every guard in transformSeries is a comparison, and a comparison against
    // NaN is false — so this has to be an explicit inspection.
    expect(isUsableFit(GOOD)).toBe(true);
    expect(isUsableFit(NAN_FIT)).toBe(false);
    expect(isUsableFit({ ...GOOD, qrange: [0, Number.NaN] })).toBe(false);
    expect(isUsableFit({ ...GOOD, qtop: [1, Number.NaN, 2] })).toBe(false);
    expect(isUsableFit({ ...GOOD, ptoq: [] })).toBe(false);
  });
});

describe('a river with some months unusable', () => {
  it('corrects an event that never touches the bad month', () => {
    const r = correctForecastsGlobal(runIn(6, 5), fitsWithBroken(7));
    const vals = [...r.forecasts.values()][0].discharge[0];
    expect(vals.every(Number.isFinite)).toBe(true);
    expect(r.unusableMonths).toEqual([]);
    expect(r.skippedNoFit).toBe(0);
    expect(r.unusable).toBeNull();
  });

  it('still corrects an event that only partly touches it, and says how much it lost', () => {
    const r = correctForecastsGlobal(runIn(6, 20), fitsWithBroken(7));
    expect(r.unusableMonths).toEqual([7]);
    expect(r.skippedNoFit).toBeGreaterThan(0);
    expect(r.noFitShare).toBeGreaterThan(0.2);
    // Rejecting the whole river here would discard a correction that works for
    // most of the event.
    expect(r.unusable).toBeNull();
    expect(r.n).toBeGreaterThan(0);
  });

  it('declares itself unusable when the bad month is the whole event', () => {
    const r = correctForecastsGlobal(runIn(7, 5), fitsWithBroken(7));
    const vals = [...r.forecasts.values()][0].discharge[0];
    expect(vals.every((v) => Number.isNaN(v))).toBe(true);
    expect(r.n).toBe(0);
    expect(r.unusable).toMatch(/no usable transform is published for month 7/);
  });

  it('does not report a saturation share computed from nothing', () => {
    // The defect: n counted NaN values as transformed, so (atCeiling+atFloor)/n
    // was 0/n and the only two unusable conditions both missed.
    const r = correctForecastsGlobal(runIn(7, 5), fitsWithBroken(7));
    expect(r.atCeiling).toBe(0);
    expect(r.atFloor).toBe(0);
    expect(r.unusable).not.toBeNull();
  });
});
