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

  it('times a plateau at its FIRST sample, not its midpoint', () => {
    // Time to peak is when the flow reaches its maximum; the rest of the plateau
    // is the crest holding rather than arriving, and operationally the first
    // moment is what a warning is issued against.
    //
    // It also has to match the other side of the subtraction: the observed peak
    // is found with `v > obsPeakVal`, which keeps the first of any ties. Timing
    // the forecast at a midpoint instead biased every plateau Δt LATE by half
    // the plateau's width — an offset produced by the estimator, not the
    // forecast.
    const r = computePeakTimingByRun(
      run((i) => (i === 16 || i === 17 ? 320 : crest(i))),
      eventData,
    );
    // Index 16, the same answer a single-valued crest at 16 gives.
    expect(r.values.flat().flat()).toEqual([12]);
    expect(r.noPeakMembers).toBe(0);
  });

  it('times a three-step plateau at its first sample too', () => {
    const r = computePeakTimingByRun(
      run((i) => (i >= 15 && i <= 17 ? 320 : crest(i))),
      eventData,
    );
    expect(r.values.flat().flat()).toEqual([6]);
    expect(r.noPeakMembers).toBe(0);
  });

  it('gives a plateau the same time as a single-valued crest starting there', () => {
    // The consistency the first-sample rule buys: widening a crest into a
    // plateau must not move its timing.
    const single = computePeakTimingByRun(run(crest), eventData).values.flat().flat();
    const plateau = computePeakTimingByRun(
      run((i) => (i === 16 || i === 17 ? crest(16) : crest(i))),
      eventData,
    )
      .values.flat()
      .flat();
    expect(plateau).toEqual(single);
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

describe('the search is bounded by the data, not by a window', () => {
  it('measures a peak far later than the old ±72 h window allowed', () => {
    // The defect: the forecast peak was sought only within ±72 h of the observed
    // one, so |Δt| could not exceed 72 h. A member cresting on 16 June — 132 h
    // after the observed peak — had no in-window maximum except at the window's
    // own edge, and was reported as CENSORED rather than as 5.5 days late.
    // Dropping it flattered exactly the members that got the event most wrong.
    const late = (i: number) => 20 + 300 * Math.exp(-((i - 36) ** 2) / 20);
    const r = computePeakTimingByRun(run(late), eventData);
    expect(r.values.flat().flat()).toEqual([132]);
    expect(r.censoredMembers).toBe(0);
  });

  it('reports a run that cannot reach the observed peak instead of scoring it', () => {
    // A run ending on the rising limb would score every member as early purely
    // because it never covered the crest. That is a fact about coverage, so it
    // is counted rather than turned into a timing number.
    const short = rt.slice(0, 8);
    const early: Map<string, ForecastRun> = new Map([
      ['20240607', { time: short, discharge: [short.map((_, i) => 20 + i * 3)] }],
    ]);
    const r = computePeakTimingByRun(early, eventData);
    expect(r.values.flat().flat()).toHaveLength(0);
    expect(r.runsNotCoveringPeak).toBe(1);
  });
});

describe('B14 — the run accounting closes', () => {
  it('leaves no run untraced, whatever it was skipped for', () => {
    // The defect: three run-level exits and two member-level exits incremented
    // nothing, so a run could vanish without appearing in any counter. Measured
    // on the audit's case, 6 runs x 5 members left 15 of 30 slots accounted for
    // and one run left no trace at all.
    const mk = (times: Date[], members: number) => ({
      time: times,
      discharge: Array.from({ length: members }, () =>
        times.map((_, i) => 20 + 300 * Math.exp(-((i - 4) ** 2) / 6)),
      ),
    });
    const day = (d: number, n: number) =>
      Array.from({ length: n }, (_, i) => new Date(Date.UTC(2024, 5, d) + i * 6 * H));

    const runs = new Map<string, ForecastRun>([
      ['20240607', mk(day(8, 12), 2)],   // scoreable
      ['not-a-date', mk(day(8, 12), 2)], // unparseable start date
      ['20240609', { time: [], discharge: [] }], // no timesteps
      ['20240610', mk(day(8, 2), 2)],    // too little overlap
      ['20240620', mk(day(20, 12), 2)],  // initialized after the peak
    ]);
    const r = computePeakTimingByRun(runs, eventData);

    const traced =
      r.initDates.length +
      r.runsAfterPeak +
      r.runsNotCoveringPeak +
      r.emptyRuns +
      r.unusableRuns;
    expect(traced).toBe(runs.size);
    // And each skip landed in the right bucket rather than a catch-all.
    expect(r.unusableRuns).toBeGreaterThanOrEqual(2);
    expect(r.runsAfterPeak).toBeGreaterThanOrEqual(1);
  });
});
