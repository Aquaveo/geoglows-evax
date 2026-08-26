import { describe, expect, it } from 'vitest';
import { gridRun } from '../../src/lib/ingest/gridRun';
import { kge } from '../../src/lib/metrics/kge';
import { aggregateSeries } from '../../src/lib/ingest/grid';
import type { ForecastRun } from '../../src/lib/types';

const H = 3600e3;
const DAY = 24 * H;
const T = 15 * 8; // 15 days of 3-hourly
const t0 = Date.UTC(2024, 5, 1);
const time = Array.from({ length: T }, (_, i) => new Date(t0 + i * 3 * H));
const shape = (i: number) => 20 + 400 * Math.exp(-((i - 60) ** 2) / 300);
const obs = aggregateSeries({ time, values: time.map((_, i) => shape(i)) }, DAY, 'mean');

const runOf = (members: number[][]): ForecastRun => ({ time, discharge: members });
const full = time.map((_, i) => shape(i));
const missingFirstDay = time.map((_, i) => (i < 8 ? Number.NaN : shape(i)));

describe('gridRun keeps members aligned', () => {
  it('gives every member the same number of bins, padding a gap with NaN', () => {
    const g = gridRun(runOf([full, missingFirstDay]), DAY, 'mean')!;
    expect(g.time).toHaveLength(15);
    expect(g.discharge[0]).toHaveLength(15);
    expect(g.discharge[1]).toHaveLength(15);
    // The absent day is a hole in place, not a removed row.
    expect(Number.isNaN(g.discharge[1][0])).toBe(true);
    expect(Number.isFinite(g.discharge[1][1])).toBe(true);
  });

  it('scores a perfect member with a gap as perfect', () => {
    // The defect: gridding members separately dropped the empty bin, so this
    // member's values lined up against member 0's timestamps one step early and
    // it scored 0.8384 instead of 1.
    const g = gridRun(runOf([full, missingFirstDay]), DAY, 'mean')!;
    const r = kge({ time: g.time, values: g.discharge[1] }, obs);
    expect(r.kge).toBeCloseTo(1, 10);
    expect(r.r).toBeCloseTo(1, 10);
    // Scored on the days it actually has.
    expect(r.n).toBe(14);
  });

  it('does not lose a run when MEMBER 0 is the one that is absent', () => {
    // Member 0's timestamps used to define the run's time axis, so an absent
    // member 0 emptied it and the whole run reported no data.
    const g = gridRun(runOf([time.map(() => Number.NaN), full]), DAY, 'mean')!;
    expect(g.time).toHaveLength(15);
    const r = kge({ time: g.time, values: g.discharge[1] }, obs);
    expect(r.kge).toBeCloseTo(1, 10);
    expect(r.n).toBe(15);
  });

  it('leaves complete members exactly as they were', () => {
    // The fix must not move numbers where there was no gap to mishandle.
    const g = gridRun(runOf([full, full]), DAY, 'mean')!;
    const direct = aggregateSeries({ time, values: full }, DAY, 'mean');
    expect(g.discharge[0]).toEqual(direct.values);
    expect(g.time.map((d) => d.getTime())).toEqual(direct.time.map((d) => d.getTime()));
  });

  it('returns null for an empty run', () => {
    expect(gridRun({ time: [], discharge: [] }, DAY, 'mean')).toBeNull();
    expect(gridRun({ time, discharge: [] }, DAY, 'mean')).toBeNull();
  });

  it('honours the summary it is given', () => {
    const spiky = time.map((_, i) => (i % 8 === 4 ? 900 : 50));
    const mx = gridRun(runOf([spiky]), DAY, 'max')!;
    const md = gridRun(runOf([spiky]), DAY, 'median')!;
    expect(mx.discharge[0][0]).toBe(900);
    expect(md.discharge[0][0]).toBe(50);
  });
});
