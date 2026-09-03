import { describe, expect, it } from 'vitest';
import { floodCheck } from '../../src/lib/floodCheck';
import type { ForecastRun } from '../../src/lib/types';

const DAY = 24 * 3600 * 1000;
const SIM_RP = { 2: 100, 5: 200, 10: 300, 25: 400, 50: 500, 100: 600 };

/**
 * One run of `members` members, 3-hourly for `days` days from `start`.
 * `valueAt(member, timestamp)` supplies the discharge.
 */
function run(
  start: string,
  days: number,
  members: number,
  valueAt: (m: number, t: Date) => number,
): [string, ForecastRun] {
  const t0 = Date.parse(`${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6, 8)}T00:00:00Z`);
  const time: Date[] = [];
  for (let ms = t0; ms <= t0 + days * DAY; ms += 3 * 3600 * 1000) time.push(new Date(ms));
  const discharge = Array.from({ length: members }, (_, m) => time.map((t) => valueAt(m, t)));
  return [start, { time, discharge }];
}

const EVENT = new Date(Date.parse('2024-09-10T00:00:00Z'));

describe('floodCheck', () => {
  it('counts a member once however long it stays above the level', () => {
    // Member 0 crosses at a single timestep; member 1 sits above for the whole
    // event day. Both called the flood, so both must count once.
    const forecasts = new Map([
      run('20240908', 15, 2, (m, t) => {
        const onEventDay = t.getTime() >= EVENT.getTime() && t.getTime() < EVENT.getTime() + DAY;
        if (!onEventDay) return 10;
        if (m === 1) return 250;
        return t.getUTCHours() === 12 ? 250 : 10;
      }),
    ]);
    const r = floodCheck(forecasts, SIM_RP, {
      eventStart: EVENT,
      eventEnd: EVENT,
      toleranceDays: 0,
    });
    const five = r.byInitialisation.grid[r.byInitialisation.levels.indexOf(5)][0];
    expect(five).toEqual({ share: 1, crossed: 2, total: 2 });
    // Nothing reached the 10-year level.
    expect(r.byInitialisation.grid[r.byInitialisation.levels.indexOf(10)][0].crossed).toBe(0);
    expect(r.highestLevelReached).toBe(5);
  });

  it('credits the earliest forecast that called it, not the latest', () => {
    // Two runs both call the event; the warning time is measured from the
    // earlier one, and against the flood's start date rather than as a lead
    // within the run — so it cannot saturate at the fetch horizon.
    const forecasts = new Map([
      run('20240902', 15, 4, (_m, t) => (sameDay(t, EVENT) ? 250 : 10)),
      run('20240909', 15, 4, (_m, t) => (sameDay(t, EVENT) ? 250 : 10)),
    ]);
    const r = floodCheck(forecasts, SIM_RP, {
      eventStart: EVENT,
      eventEnd: EVENT,
      toleranceDays: 0,
    });
    const five = r.levels.find((l) => l.level === 5)!;
    expect(five.everCrossed).toBe(true);
    // Every member crosses in both runs, so the majority is reached in the
    // EARLIER of them — the one that would actually have given the warning.
    expect(five.majorityInit).toBe('20240902');
    expect(five.majorityLeadDays).toBe(8);
    expect(five.majorityCrossed).toBe(4);
    expect(five.majorityTotal).toBe(4);
  });

  it('leaves a column with no data in the window as NaN, not zero', () => {
    // The run ends before the event, so it has nothing to say — which is not the
    // same as saying no member crossed.
    const forecasts = new Map([
      run('20240801', 15, 3, () => 10),
      run('20240909', 15, 3, () => 10),
    ]);
    const r = floodCheck(forecasts, SIM_RP, {
      eventStart: EVENT,
      eventEnd: EVENT,
      toleranceDays: 0,
    });
    expect(r.byInitialisation.columns).toEqual(['20240909']);
    expect(r.runsUsed).toBe(1);
    // A lead day beyond this run's horizon carries no data either.
    const leadRow = r.byLead.grid[0];
    expect(Number.isNaN(leadRow[r.byLead.columns.indexOf('15')].share)).toBe(true);
  });

  it('widens the window by the tolerance', () => {
    const forecasts = new Map([
      run('20240905', 15, 5, (_m, t) =>
        sameDay(t, new Date(EVENT.getTime() + 2 * DAY)) ? 250 : 10,
      ),
    ]);
    const strict = floodCheck(forecasts, SIM_RP, {
      eventStart: EVENT,
      eventEnd: EVENT,
      toleranceDays: 0,
    });
    expect(strict.highestLevelReached).toBe(null);

    const loose = floodCheck(forecasts, SIM_RP, {
      eventStart: EVENT,
      eventEnd: EVENT,
      toleranceDays: 2,
    });
    expect(loose.highestLevelReached).toBe(5);
  });

  it('pools lead days across initialisations', () => {
    // Three runs, each 51 members; at lead 1 only the last one crosses.
    const forecasts = new Map(
      ['20240908', '20240909', '20240910'].map((d) =>
        run(d, 15, 51, (_m, t) => (d === '20240910' && sameDay(t, EVENT) ? 250 : 10)),
      ),
    );
    const r = floodCheck(forecasts, SIM_RP, {
      eventStart: EVENT,
      eventEnd: EVENT,
      toleranceDays: 0,
    });
    // Lead 0 is the initialisation timestamp itself: only 20240910 has one
    // inside the event day, and all 51 of its members are above.
    const li = r.byLead.levels.indexOf(5);
    const lead0 = r.byLead.grid[li][r.byLead.columns.indexOf('0')];
    expect(lead0).toEqual({ share: 1, crossed: 51, total: 51 });
  });

  it('separates a lone outlier from ensemble agreement', () => {
    // The shape found on real data (reach 770143064, June 2025): one member of
    // one run crosses every level to the 100-year at long lead, while the rest
    // of the ensemble never leaves normal flow. everCrossed and maxLead are
    // true at every level; peakShare is what says it was one member.
    const forecasts = new Map([
      run('20240901', 15, 50, (m, t) => (m === 0 && sameDay(t, EVENT) ? 9999 : 10)),
      run('20240909', 15, 50, (_m, t) => (sameDay(t, EVENT) ? 250 : 10)),
    ]);
    const r = floodCheck(forecasts, SIM_RP, {
      eventStart: EVENT,
      eventEnd: EVENT,
      toleranceDays: 0,
    });
    const hundred = r.levels.find((l) => l.level === 100)!;
    expect(hundred.everCrossed).toBe(true);
    expect(hundred.peakShare).toBeCloseTo(1 / 50, 6);
    expect(hundred.peakShareInit).toBe('20240901');
    // Counts, which is what the table shows: one member, not "2%".
    expect(hundred.peakCrossed).toBe(1);
    expect(hundred.peakTotal).toBe(50);
    // And no majority ever, which is the honest reading of that one member.
    expect(hundred.majorityInit).toBe(null);

    // The level the ensemble actually agreed on tells the other half of it.
    const five = r.levels.find((l) => l.level === 5)!;
    expect(five.peakShare).toBe(1);
    expect(five.peakShareInit).toBe('20240909');
  });

  it('ignores levels the fit did not produce', () => {
    const partial = { 2: 100, 5: 200 };
    const forecasts = new Map([run('20240909', 15, 2, () => 250)]);
    const r = floodCheck(forecasts, partial, {
      eventStart: EVENT,
      eventEnd: EVENT,
      toleranceDays: 0,
    });
    expect(r.byInitialisation.levels).toEqual([2, 5]);
    expect(r.levels.map((l) => l.level)).toEqual([2, 5]);
  });
});

function sameDay(t: Date, day: Date): boolean {
  return t.getTime() >= day.getTime() && t.getTime() < day.getTime() + DAY;
}

describe('warning time', () => {
  const EV = new Date(Date.parse('2026-01-19T00:00:00Z'));

  /** A run whose members all sit at `v` through the whole event window. */
  function flat(start: string, v: number, members = 51): [string, ForecastRun] {
    const t0 = Date.parse(`${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6, 8)}T00:00:00Z`);
    const time: Date[] = [];
    for (let ms = t0; ms <= t0 + 15 * DAY; ms += 3 * 3600 * 1000) time.push(new Date(ms));
    return [start, { time, discharge: Array.from({ length: members }, () => time.map(() => v)) }];
  }

  it('reports the earliest run where more than half the members crossed', () => {
    // 01-09 has 20/51 over the 5-year level; 01-12 has 40/51. Only the second is
    // a majority, so the warning time is measured from 01-12 -> 7 days.
    const mk = (start: string, nOver: number): [string, ForecastRun] => {
      const [k, r] = flat(start, 10);
      for (let m = 0; m < nOver; m++) r.discharge[m] = r.discharge[m].map(() => 250);
      return [k, r];
    };
    const r = floodCheck(new Map([mk('20260109', 20), mk('20260112', 40)]), SIM_RP, {
      eventStart: EV,
      eventEnd: EV,
      toleranceDays: 0,
    });
    const five = r.levels.find((l) => l.level === 5)!;
    expect(five.majorityInit).toBe('20260112');
    expect(five.majorityLeadDays).toBe(7);
    expect(five.majorityShare).toBeCloseTo(40 / 51, 6);
  });

  it('is null when no run ever reached a majority, even though members crossed', () => {
    const [k, run] = flat('20260109', 10);
    // A single member over the 5-year level: everCrossed, but never a majority.
    run.discharge[0] = run.discharge[0].map(() => 250);
    const r = floodCheck(new Map([[k, run]]), SIM_RP, {
      eventStart: EV,
      eventEnd: EV,
      toleranceDays: 0,
    });
    const five = r.levels.find((l) => l.level === 5)!;
    expect(five.everCrossed).toBe(true);
    // One member is all it was, and the counts say so.
    expect(five.peakCrossed).toBe(1);
    expect(five.peakTotal).toBe(51);
    // The warning time correctly reports that nothing was ever called.
    expect(five.majorityInit).toBe(null);
    expect(five.majorityLeadDays).toBe(null);
  });

  it('needs strictly more than half, so an exact tie does not count', () => {
    const [k, run] = flat('20260109', 10, 50);
    for (let m = 0; m < 25; m++) run.discharge[m] = run.discharge[m].map(() => 250);
    const tie = floodCheck(new Map([[k, run]]), SIM_RP, {
      eventStart: EV, eventEnd: EV, toleranceDays: 0,
    });
    expect(tie.levels.find((l) => l.level === 5)!.majorityInit).toBe(null);

    run.discharge[25] = run.discharge[25].map(() => 250);
    const over = floodCheck(new Map([[k, run]]), SIM_RP, {
      eventStart: EV, eventEnd: EV, toleranceDays: 0,
    });
    expect(over.levels.find((l) => l.level === 5)!.majorityInit).toBe('20260109');
  });

  it('measures lead to the opening of the window, not to the crest', () => {
    const r = floodCheck(new Map([flat('20260112', 250)]), SIM_RP, {
      eventStart: EV,
      eventEnd: new Date(EV.getTime() + 5 * DAY),
      toleranceDays: 0,
    });
    // 01-12 to 01-19 is 7 days, regardless of the window being six days long.
    expect(r.levels.find((l) => l.level === 5)!.majorityLeadDays).toBe(7);
  });
});

describe('persistence counts', () => {
  const EV = new Date(Date.parse('2026-01-19T00:00:00Z'));

  /** A run where exactly `nOver` of 51 members sit above 250 all window. */
  function withOver(start: string, nOver: number): [string, ForecastRun] {
    const t0 = Date.parse(`${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6, 8)}T00:00:00Z`);
    const time: Date[] = [];
    for (let ms = t0; ms <= t0 + 15 * DAY; ms += 3 * 3600 * 1000) time.push(new Date(ms));
    const discharge = Array.from({ length: 51 }, (_, m) => time.map(() => (m < nOver ? 250 : 10)));
    return [start, { time, discharge }];
  }

  /**
   * The case the repo owner raised: a level that a large minority crosses,
   * repeatedly, and a majority never does. The row must stay informative — a
   * blank reads as "nothing happened", which is false.
   */
  it('keeps a persistent minority signal visible when no majority ever forms', () => {
    // 18 of 51 is ~35%, in four separate forecasts.
    const r = floodCheck(
      new Map([
        withOver('20260108', 18),
        withOver('20260109', 18),
        withOver('20260110', 18),
        withOver('20260111', 18),
      ]),
      SIM_RP,
      { eventStart: EV, eventEnd: EV, toleranceDays: 0 },
    );
    const five = r.levels.find((l) => l.level === 5)!;
    expect(five.majorityInit).toBe(null);        // no notice figure
    expect(five.majorityForecasts).toBe(0);
    expect(five.anyForecasts).toBe(4);           // but the signal was there, four times
    expect(five.peakCrossed).toBe(18);           // and this is how strong it got
    expect(five.peakTotal).toBe(51);
  });

  it('counts forecasts, not the best of them, so one outlier cannot inflate it', () => {
    const r = floodCheck(
      new Map([withOver('20260108', 1), withOver('20260109', 1), withOver('20260110', 40)]),
      SIM_RP,
      { eventStart: EV, eventEnd: EV, toleranceDays: 0 },
    );
    const five = r.levels.find((l) => l.level === 5)!;
    expect(five.anyForecasts).toBe(3);
    // Only the third forecast had a majority, however strong it was.
    expect(five.majorityForecasts).toBe(1);
    expect(five.peakCrossed).toBe(40);
  });

  it('reports zero for a level nothing ever reached', () => {
    const r = floodCheck(new Map([withOver('20260108', 51)]), SIM_RP, {
      eventStart: EV, eventEnd: EV, toleranceDays: 0,
    });
    // 250 is over the 5-year (200) but under the 10-year (300).
    const ten = r.levels.find((l) => l.level === 10)!;
    expect(ten.anyForecasts).toBe(0);
    expect(ten.majorityForecasts).toBe(0);
    expect(ten.everCrossed).toBe(false);
    const five = r.levels.find((l) => l.level === 5)!;
    expect(five.majorityForecasts).toBe(1);
    expect(five.anyForecasts).toBe(1);
  });
});
