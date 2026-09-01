import { describe, expect, it } from 'vitest';
import { alignTimes, countAlignedPairs } from '../../src/lib/alignment';
import { computeCsi } from '../../src/lib/metrics/csi';
import { rpsByLead } from '../../src/lib/metrics/rps';
import { computeCrpsByLead } from '../../src/lib/metrics/crps';
import { reorganizeByLead } from '../../src/lib/leadBuckets';
import type { ForecastRun, LeadBucket } from '../../src/lib/types';

/**
 * Guards for the audit's latent findings — defects reproduced on the real
 * modules that today's pipeline happens not to reach. Each test states the
 * finding, because "unreachable today" is a property of the current call sites,
 * not of the code, and one refactor changes it.
 */

const H = 3600e3;
const t = (h: number) => new Date(Date.UTC(2024, 5, 1) + h * H);

describe('B8 — alignment does not assume ascending input', () => {
  it('aligns a newest-first series instead of silently finding no pairs', () => {
    // The defect: the window came from time[0] and time[last], so a descending
    // series gave start > end and every paired metric returned zero pairs — NaN
    // everywhere, no error, no explanation. parseCsv does not sort, so a
    // newest-first gauge CSV is one refactor from live.
    const desc = { time: [t(9), t(6), t(3)], values: [30, 20, 10] };
    const asc = { time: [t(3), t(6), t(9)], values: [1, 2, 3] };
    const a = alignTimes(desc, asc);
    expect(a.time.map((d) => d.getTime())).toEqual([t(3), t(6), t(9)].map((d) => d.getTime()));
    expect(a.forecast).toEqual([10, 20, 30]);
    expect(a.observed).toEqual([1, 2, 3]);
  });

  it('counts a repeated timestamp once, not twice', () => {
    // A duplicate forecast timestamp was paired against the same observation
    // twice, double-weighting one instant in every paired metric.
    const dup = { time: [t(3), t(3), t(6)], values: [10, 999, 20] };
    const obs = { time: [t(3), t(6)], values: [1, 2] };
    expect(alignTimes(dup, obs).time).toHaveLength(2);
    expect(countAlignedPairs(dup.time, obs)).toBe(2);
  });

  it('returns chronological output whatever the input order', () => {
    const shuffled = { time: [t(6), t(3), t(9)], values: [20, 10, 30] };
    const obs = { time: [t(3), t(6), t(9)], values: [1, 2, 3] };
    const ms = alignTimes(shuffled, obs).time.map((d) => d.getTime());
    expect(ms).toEqual([...ms].sort((a, b) => a - b));
  });
});

describe('B7 — CSI cannot be asked for an empty dichotomisation', () => {
  it('returns NaN at atOrAbove 0 rather than a silent perfect score', () => {
    // The defect: only the UPPER end of atOrAbove was guarded, so 0 put every
    // cell on the event side of both splits — every count a hit, b and c zero —
    // and the function returned 1.0. computeCsi([[10,1],[2,5]], 0) === 1.
    expect(computeCsi([[10, 1], [2, 5]], 0)).toBeNaN();
    expect(computeCsi([[10, 1], [2, 5]], -1)).toBeNaN();
    // The real question still works, and a genuine zero is still zero.
    expect(computeCsi([[10, 1], [2, 5]], 1)).toBeCloseTo(5 / 8, 12);
    expect(computeCsi([[10, 0], [4, 0]], 1)).toBe(0);
  });
});

describe('B3 — RPS refuses mismatched threshold sets', () => {
  it('withholds instead of scoring 1.0 for a wrong call', () => {
    // The defect: RPS differences cumulative probabilities over K-1 boundaries,
    // and nothing checked the two sets agreed on K. An observed category above
    // the forecast's top collapsed into it, and a forecast confidently calling
    // >=5yr on a >=10yr day scored rpss 1.0000 — a perfect score for being wrong.
    const bucket: LeadBucket = {
      time: [t(0), t(24), t(48)],
      members: [[150, 150], [150, 150], [150, 150]],
    };
    const observed = { time: [t(0), t(24), t(48)], values: [350, 350, 350] };
    const r = rpsByLead({ 1: bucket }, observed, [100, 200, 300], [100, 200], null, {
      maxLead: 1,
    });
    expect(r.rps[1]).toBeNaN();
    expect(r.rpss[1]).toBeNaN();
    expect(r.skipped[1]).toMatch(/different category counts/);
  });
});

describe('B1 — CRPS survives a bucket row with no members', () => {
  it('skips the row instead of blanking all three panels', () => {
    // The defect: crpsTimestep(bucket.members[i], obs) threw
    // "TypeError: members is not iterable", and the throw reached setCrpsError,
    // which blanks the raw, local and SABER panels together. rps.ts already
    // defended against exactly this with `?? []`.
    const bucket = {
      time: [t(0), t(3), t(6)],
      // Middle row absent, as a ragged bucket would leave it.
      members: [[10, 12], undefined, [14, 16]] as unknown as number[][],
    };
    const observed = { time: [t(0), t(3), t(6)], values: [11, 13, 15] };
    expect(() => computeCrpsByLead({ 1: bucket }, observed, 1, null)).not.toThrow();
    const out = computeCrpsByLead({ 1: bucket }, observed, 1, null);
    expect(Number.isFinite(out.crps[1])).toBe(true);
    expect(out.nTimesteps[1]).toBe(2);
  });
});

describe('B9 — an unparseable timestamp does not take down the tab', () => {
  it('skips the timestep instead of indexing buckets[NaN]', () => {
    // The defect: Math.ceil(NaN) is NaN, and NaN < 0 and NaN > maxLead are BOTH
    // false, so the guard passed and buckets[NaN].time.push threw
    // "Cannot read properties of undefined", taking the Metrics and Forecast
    // tabs down together.
    const run: ForecastRun = {
      time: [new Date(Date.UTC(2024, 5, 1)), new Date(NaN), new Date(Date.UTC(2024, 5, 2))],
      discharge: [[1, 2, 3]],
    };
    const buckets = reorganizeByLead(new Map([['20240601', run]]), 15);
    expect(buckets[0].time).toHaveLength(1);
    expect(buckets[1].time).toHaveLength(1);
    // Nothing landed in a bogus bucket.
    expect(Object.keys(buckets).every((k) => Number.isInteger(Number(k)))).toBe(true);
  });
});
