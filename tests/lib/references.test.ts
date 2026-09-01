import { describe, expect, it } from 'vitest';
import { categoricalReference, continuousReference } from '../../src/lib/metrics/references';
import { climatologyCrpsAt } from '../../src/lib/metrics/crps';

const H = 3600e3;

/** 20 years of hourly record with a seasonal cycle and real sub-daily shape. */
function hourlyRecord() {
  const n = 20 * 365 * 24;
  const t0 = Date.UTC(2000, 0, 1);
  const time: Date[] = [];
  const values: number[] = [];
  for (let i = 0; i < n; i++) {
    const doy = (i / 24) % 365;
    const seasonal = 40 + 60 * Math.exp(-((doy - 170) ** 2) / 900);
    const pulse = seasonal > 60 ? 25 * Math.exp(-(((i % 24) - 15) ** 2) / 6) : 0;
    time.push(new Date(t0 + i * H));
    values.push(seasonal + pulse + 6 * Math.sin(i / 7.3));
  }
  return { time, values };
}

/** 20 years of DAILY record — the common upload. */
function dailyRecord() {
  const n = 20 * 365;
  const t0 = Date.UTC(2000, 0, 1);
  const time: Date[] = [];
  const values: number[] = [];
  for (let i = 0; i < n; i++) {
    const doy = i % 365;
    time.push(new Date(t0 + i * 24 * H));
    values.push(40 + 60 * Math.exp(-((doy - 170) ** 2) / 900) + 6 * Math.sin(i / 3.1));
  }
  return { time, values };
}

const eventStart = Date.UTC(2019, 5, 18);
const scoredObs = {
  time: Array.from({ length: 32 }, (_, i) => new Date(eventStart + i * 3 * H)),
  values: Array.from({ length: 32 }, () => 150),
};

describe('the CRPSS reference tracks the grid it will be scored against', () => {
  it('is not floored at a day, so a sub-daily grid keeps its sub-daily spread', () => {
    // The defect: the reference was built at max(stepMs, DAY_MS), so on a 3-hourly
    // grid CRPS was scored on 3-hourly means against a reference of DAILY means.
    // A daily sample is narrower, a narrower reference scores worse against an
    // unusual observation, and CRPSS = 1 - CRPS/CRPS_clim was inflated.
    const rec = hourlyRecord();
    const matched = continuousReference(rec, scoredObs, 3 * H)!;
    const floored = continuousReference(rec, scoredObs, 24 * H)!;

    // Eight times the sample, and materially wider.
    expect(matched.sorted.length).toBeGreaterThan(floored.sorted.length * 7);
    const span = (c: typeof matched) =>
      c.sorted[Math.floor(0.95 * (c.sorted.length - 1))] -
      c.sorted[Math.floor(0.05 * (c.sorted.length - 1))];
    expect(span(matched)).toBeGreaterThan(span(floored) * 1.5);

    // The floored reference is the easier one to beat at every magnitude, and
    // most so near the climatological body, where the verdict is marginal.
    const inflation = (obs: number) =>
      1 - 12 / climatologyCrpsAt(floored, obs) - (1 - 12 / climatologyCrpsAt(matched, obs));
    expect(inflation(110)).toBeGreaterThan(0.05);
    expect(inflation(400)).toBeGreaterThan(0);
    expect(inflation(400)).toBeLessThan(0.005);
  });

  it('is unchanged by the grid when the record is coarser than it', () => {
    // The only case the floor could have been protecting. Aggregating a daily
    // record onto a 3-hourly grid is a no-op, so removing the floor is safe.
    const rec = dailyRecord();
    const fine = continuousReference(rec, scoredObs, 3 * H)!;
    const floored = continuousReference(rec, scoredObs, 24 * H)!;
    expect(fine.sorted).toEqual(floored.sorted);
    expect(fine.spread).toBe(floored.spread);
  });
});

describe('the two references differ only where their scored observations do', () => {
  it('follows the chosen bin summary for RPSS and the mean for CRPSS', () => {
    const rec = hourlyRecord();
    const thr = [80, 100, 120, 140];
    const median = categoricalReference(rec, scoredObs, 3 * H, 'median', thr)!;
    const max = categoricalReference(rec, scoredObs, 3 * H, 'max', thr)!;
    // The summary reaches the categorical reference: bin maxima cross the
    // thresholds more often than bin medians do, so LESS climatological mass
    // sits in the lowest category and more sits above it.
    expect(max.climatology[0]).toBeLessThan(median.climatology[0]);
    const above = (c: number[]) => c.slice(1).reduce((a, b) => a + b, 0);
    expect(above(max.climatology)).toBeGreaterThan(above(median.climatology));
    // Same season and minimum, so the same number of values underlies both.
    expect(max.n).toBe(median.n);
  });

  it('withholds rather than estimating when there is no record', () => {
    expect(continuousReference(null, scoredObs, 3 * H)).toBeNull();
    expect(categoricalReference(null, scoredObs, 3 * H, 'median', [80, 100])).toBeNull();
  });

  it('withholds when too little of the record falls in season', () => {
    const t0 = Date.UTC(2019, 0, 1);
    const tiny = {
      time: Array.from({ length: 10 }, (_, i) => new Date(t0 + i * 24 * H)),
      values: Array.from({ length: 10 }, () => 50),
    };
    expect(continuousReference(tiny, scoredObs, 3 * H)).toBeNull();
  });
});
