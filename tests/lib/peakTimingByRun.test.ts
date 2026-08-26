import { describe, expect, it } from 'vitest';
import { computePeakTimingByRun } from '../../src/lib/metrics/peakTimingByRun';
import type { ForecastRun } from '../../src/lib/types';

const H = 3600e3;
// Observed peak at 2024-06-10 12:00Z; the search window is ±72 h.
const obsTime = Array.from({ length: 40 }, (_, i) => new Date(Date.UTC(2024, 5, 8) + i * 6 * H));
const eventData = {
  time: obsTime,
  values: obsTime.map((_, i) => 20 + 300 * Math.exp(-((i - 10) ** 2) / 20)),
};
const obsPeakMs = obsTime[10].getTime();

const rt = Array.from({ length: 40 }, (_, i) => new Date(Date.UTC(2024, 5, 7) + i * 6 * H));
const inWindow = rt
  .map((d, i) => ({ d, i }))
  .filter((x) => Math.abs(x.d.getTime() - obsPeakMs) <= 72 * H)
  .map((x) => x.i);
const lastIn = inWindow[inWindow.length - 1];

const run = (f: (i: number) => number): Map<string, ForecastRun> =>
  new Map([['20240607', { time: rt, discharge: [rt.map((_, i) => f(i))] }]]);
const crest = (i: number) => 20 + 300 * Math.exp(-((i - 16) ** 2) / 20);

describe('censoring keys off the member own finite samples', () => {
  it('censors a member still rising at the window edge', () => {
    const r = computePeakTimingByRun(run((i) => 10 + i * 5), eventData);
    expect(r.values.flat().flat()).toHaveLength(0);
    expect(r.censoredMembers).toBe(1);
  });

  it('still censors it when the edge sample is missing', () => {
    // The defect: the test compared against the WINDOW's last index regardless
    // of whether that timestep held a value, so one NaN slid the maximum a step
    // inward and the member reported a confident "+66 h late" instead.
    const r = computePeakTimingByRun(
      run((i) => (i === lastIn ? Number.NaN : 10 + i * 5)),
      eventData,
    );
    expect(r.values.flat().flat()).toHaveLength(0);
    expect(r.censoredMembers).toBe(1);
  });
});

describe('a crest with a flat top is still a peak', () => {
  it('times a single-valued crest', () => {
    const r = computePeakTimingByRun(run(crest), eventData);
    expect(r.values.flat().flat()).toEqual([12]);
  });

  it('times a two-step plateau at its midpoint', () => {
    // Rejecting any tie discarded exactly the members a saturated bias
    // correction produces, since saturation maps neighbours to the same number.
    const r = computePeakTimingByRun(
      run((i) => (i === 16 || i === 17 ? 320 : crest(i))),
      eventData,
    );
    // Midway between +12 h and +18 h — leaning neither early nor late.
    expect(r.values.flat().flat()).toEqual([15]);
    expect(r.noPeakMembers).toBe(0);
  });

  it('times a three-step plateau at its centre', () => {
    const r = computePeakTimingByRun(
      run((i) => (i >= 15 && i <= 17 ? 320 : crest(i))),
      eventData,
    );
    expect(r.values.flat().flat()).toEqual([12]);
    expect(r.noPeakMembers).toBe(0);
  });

  it('still reports no peak when the member is flat throughout', () => {
    const r = computePeakTimingByRun(run(() => 100), eventData);
    expect(r.values.flat().flat()).toHaveLength(0);
    expect(r.noPeakMembers).toBe(1);
  });

  it('treats a later equal value after a dip as a separate crest, not a plateau', () => {
    // Contiguity matters: two equal maxima either side of a trough are two
    // crests, and averaging their positions would time neither.
    const r = computePeakTimingByRun(
      run((i) => (i === 14 || i === 20 ? 320 : i === 17 ? 50 : crest(i))),
      eventData,
    );
    const d = r.values.flat().flat();
    expect(d).toHaveLength(1);
    // The first maximum, not the midpoint of 14 and 20.
    expect(d[0]).toBe(0);
  });
});
