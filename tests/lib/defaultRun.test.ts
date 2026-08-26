import { describe, expect, it } from 'vitest';
import { pickDefaultRun } from '../../src/lib/defaultRun';
import type { TimeSeries } from '../../src/lib/types';

const DAY = 86400000;
const key = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');

/** The app's real fetch range: eventStart − 15d through eventEnd. */
function runKeys(eventStart: number, eventDays: number): string[] {
  const out: string[] = [];
  for (let t = eventStart - 15 * DAY; t <= eventStart + (eventDays - 1) * DAY; t += DAY) {
    out.push(key(t));
  }
  return out;
}

/** Daily observations over the event, crest on `peakDay` (0-based). */
function observed(eventStart: number, eventDays: number, peakDay: number): TimeSeries {
  return {
    time: Array.from({ length: eventDays }, (_, i) => new Date(eventStart + i * DAY)),
    values: Array.from({ length: eventDays }, (_, i) => 20 + 400 * Math.exp(-((i - peakDay) ** 2) / 6)),
  };
}

const START = Date.UTC(2026, 5, 10);

describe('pickDefaultRun', () => {
  it('puts the crest a few days into the chosen run horizon', () => {
    const keys = runKeys(START, 31);
    const obs = observed(START, 31, 15); // crest 2026-06-25
    const pick = pickDefaultRun(keys, obs, 15)!;
    // Crest minus the 5-day target.
    expect(pick).toBe(key(START + 15 * DAY - 5 * DAY));
  });

  it('never picks a run whose horizon misses the crest', () => {
    const keys = runKeys(START, 31);
    for (const peakDay of [0, 3, 8, 15, 22, 30]) {
      const obs = observed(START, 31, peakDay);
      const pick = pickDefaultRun(keys, obs, 15)!;
      const t0 = Date.UTC(
        Number(pick.slice(0, 4)), Number(pick.slice(4, 6)) - 1, Number(pick.slice(6, 8)),
      );
      const peak = START + peakDay * DAY;
      expect(peak).toBeGreaterThanOrEqual(t0);
      expect(peak).toBeLessThanOrEqual(t0 + 15 * DAY);
    }
  });

  it('clamps to the earliest available run when the crest is right at the start', () => {
    // crest on day 0 -> target is 5 days before the event, which exists (lookback
    // is 15 days), so the target is reachable and the crest is at lead 5.
    const keys = runKeys(START, 31);
    const pick = pickDefaultRun(keys, observed(START, 31, 0), 15)!;
    expect(pick).toBe(key(START - 5 * DAY));
  });

  it('does not choose the newest run, whose horizon is entirely after the event', () => {
    const keys = runKeys(START, 31);
    const pick = pickDefaultRun(keys, observed(START, 31, 15), 15);
    expect(pick).not.toBe(keys[keys.length - 1]);
  });

  it('falls back to the middle initialization with no observations', () => {
    const keys = runKeys(START, 31);
    const middle = keys[Math.floor((keys.length - 1) / 2)];
    expect(pickDefaultRun(keys, null, 15)).toBe(middle);
    expect(pickDefaultRun(keys, undefined, 15)).toBe(middle);
    expect(pickDefaultRun(keys, { time: [], values: [] }, 15)).toBe(middle);
  });

  it('falls back to the middle when every observation is non-finite', () => {
    const keys = runKeys(START, 31);
    const allNaN = {
      time: Array.from({ length: 5 }, (_, i) => new Date(START + i * DAY)),
      values: [Number.NaN, Number.NaN, Number.NaN, Number.NaN, Number.NaN],
    };
    expect(pickDefaultRun(keys, allNaN, 15)).toBe(keys[Math.floor((keys.length - 1) / 2)]);
  });

  it('falls back to the middle when no run reaches the crest at all', () => {
    // Observations a year after every fetched run.
    const keys = runKeys(START, 31);
    const far = observed(START + 365 * DAY, 5, 2);
    expect(pickDefaultRun(keys, far, 15)).toBe(keys[Math.floor((keys.length - 1) / 2)]);
  });

  it('keeps the earlier run on a tie, so more of the rise is in view', () => {
    // Crest exactly between two candidates: target lands midway.
    const keys = [key(START), key(START + 2 * DAY)];
    const obs = {
      time: [new Date(START + 6 * DAY)],
      values: [500],
    };
    // target = crest − 5d = START + 1d, equidistant from both keys.
    expect(pickDefaultRun(keys, obs, 15)).toBe(key(START));
  });

  it('returns null for no runs, and handles a single run', () => {
    expect(pickDefaultRun([], observed(START, 31, 15), 15)).toBeNull();
    const one = [key(START)];
    expect(pickDefaultRun(one, observed(START, 31, 2), 15)).toBe(one[0]);
  });

  it('ignores an unparseable key rather than throwing', () => {
    // Crest on day 7 -> target START+2d, which one candidate hits exactly, so
    // this tests key parsing rather than the tie rule.
    const keys = ['notadate', key(START), key(START + 2 * DAY)];
    expect(pickDefaultRun(keys, observed(START, 31, 7), 15)).toBe(key(START + 2 * DAY));
  });
});
