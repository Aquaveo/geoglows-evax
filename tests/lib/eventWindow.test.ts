import { describe, expect, it } from 'vitest';
import {
  extractEvent,
  findPeakNear,
  sliceByDay,
  suggestEventWindow,
} from '../../src/lib/ingest/eventWindow';
import type { TimeSeries } from '../../src/lib/types';

const DAY = 24 * 3600 * 1000;

/** A synthetic hydrograph: flat baseline, fast rise, slow recession. */
function hydrograph(
  startDay: string,
  days: number,
  peakAt: number,
  base = 250,
  peak = 3600,
  riseDays = 5,
  recessionDays = 25,
): TimeSeries {
  const t0 = new Date(`${startDay}T00:00:00Z`).getTime();
  const time: Date[] = [];
  const values: number[] = [];
  for (let i = 0; i < days; i++) {
    time.push(new Date(t0 + i * DAY));
    let v = base;
    if (i > peakAt - riseDays && i <= peakAt) {
      v = base + (peak - base) * ((i - (peakAt - riseDays)) / riseDays);
    } else if (i > peakAt) {
      // Exponential-ish decay back toward baseline.
      const f = Math.max(0, 1 - (i - peakAt) / recessionDays);
      v = base + (peak - base) * f * f;
    }
    values.push(v);
  }
  return { time, values };
}

describe('suggestEventWindow', () => {
  const s = hydrograph('2026-06-01', 70, 20);

  it('opens at the pre-event minimum and closes near it again', () => {
    const w = suggestEventWindow(s)!;
    expect(w.peakDay).toBe('2026-06-21');
    // Rise is 5 days, so the window should open shortly before the peak.
    expect(w.daysBefore).toBeGreaterThanOrEqual(4);
    expect(w.daysBefore).toBeLessThanOrEqual(12);
    // And stay open through most of the recession.
    expect(w.daysAfter).toBeGreaterThan(10);
    expect(w.endFlow).toBeLessThan(w.peakValue * 0.5);
  });

  it('never exceeds the cap', () => {
    for (const maxDays of [10, 20, 31]) {
      const w = suggestEventWindow(s, { maxDays })!;
      const span =
        (new Date(`${w.end}T00:00:00Z`).getTime() - new Date(`${w.start}T00:00:00Z`).getTime()) /
          DAY +
        1;
      expect(span).toBeLessThanOrEqual(maxDays);
    }
  });

  it('trims the front rather than the recession when the cap bites', () => {
    // A very long recession forces a choice; the falling limb must survive.
    const slow = hydrograph('2026-06-01', 90, 30, 250, 3600, 5, 60);
    const wide = suggestEventWindow(slow, { maxDays: 60 })!;
    const tight = suggestEventWindow(slow, { maxDays: 20 })!;
    expect(tight.daysAfter).toBeGreaterThan(tight.daysBefore);
    expect(tight.daysAfter).toBeGreaterThanOrEqual(Math.min(wide.daysAfter, 19));
  });

  it('keeps the peak inside the window even under a tiny cap', () => {
    const w = suggestEventWindow(s, { maxDays: 5 })!;
    expect(w.start <= w.peakDay).toBe(true);
    expect(w.peakDay <= w.end).toBe(true);
  });

  it('flags a truncated recession instead of pretending the window closed', () => {
    // Series ends while flow is still far above baseline.
    const cut = hydrograph('2026-06-01', 24, 20, 250, 3600, 5, 40);
    const w = suggestEventWindow(cut)!;
    expect(w.recessionTruncated).toBeTruthy();
    expect(w.dataLimited).toBeTruthy();
  });

  it('returns null for a series too short to have a shape', () => {
    expect(suggestEventWindow({ time: [new Date()], values: [1] })).toBeNull();
  });
});

describe('findPeakNear', () => {
  const s = hydrograph('2026-06-01', 70, 20);

  it('finds the peak from an approximate date', () => {
    expect(findPeakNear(s, '2026-06-19', 10)!.day).toBe('2026-06-21');
  });

  it('ignores peaks outside the search radius', () => {
    // Search near the start, far from the real peak.
    const found = findPeakNear(s, '2026-06-02', 3)!;
    expect(found.day).not.toBe('2026-06-21');
  });

  it('returns null when nothing is in range', () => {
    expect(findPeakNear(s, '2030-01-01', 5)).toBeNull();
  });
});

describe('sliceByDay', () => {
  it('is inclusive of both end days', () => {
    const s = hydrograph('2026-06-01', 30, 10);
    const cut = sliceByDay(s, '2026-06-05', '2026-06-07');
    expect(cut.time).toHaveLength(3);
    expect(cut.time[0].toISOString().slice(0, 10)).toBe('2026-06-05');
    expect(cut.time[2].toISOString().slice(0, 10)).toBe('2026-06-07');
  });
});

describe('extractEvent', () => {
  it('cuts an event out of a long daily record and flags the cadence', () => {
    // Three years of baseline with one flood in the middle.
    const t0 = new Date('2024-01-01T00:00:00Z').getTime();
    const time: Date[] = [];
    const values: number[] = [];
    for (let i = 0; i < 1000; i++) {
      time.push(new Date(t0 + i * DAY));
      values.push(250);
    }
    const ev = hydrograph('2026-06-01', 70, 20);
    for (let i = 0; i < ev.time.length; i++) {
      const idx = Math.round((ev.time[i].getTime() - t0) / DAY);
      if (idx >= 0 && idx < values.length) values[idx] = ev.values[i];
    }
    const got = extractEvent({ time, values }, '2026-06-20')!;
    expect(got.peakDay).toBe('2026-06-21');
    expect(got.n).toBeGreaterThan(10);
    expect(got.stepHours).toBe(24);
    // A daily record cannot support sub-daily peak timing, and says so.
    expect(got.cadenceCaveat).toContain('daily grid');
  });

  it('raises no cadence caveat for a sub-daily record', () => {
    const t0 = new Date('2026-06-01T00:00:00Z').getTime();
    const time: Date[] = [];
    const values: number[] = [];
    for (let i = 0; i < 70 * 8; i++) {
      time.push(new Date(t0 + i * 3 * 3600e3));
      const d = i / 8;
      values.push(d > 15 && d <= 20 ? 250 + 600 * (d - 15) : d > 20 ? Math.max(250, 3250 - 120 * (d - 20)) : 250);
    }
    const got = extractEvent({ time, values }, '2026-06-21')!;
    expect(got.stepHours).toBe(3);
    expect(got.cadenceCaveat).toBeNull();
  });

  it('returns null when the date is nowhere near the record', () => {
    const s = hydrograph('2026-06-01', 40, 20);
    expect(extractEvent(s, '2019-01-01')).toBeNull();
  });
});
