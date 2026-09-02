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

  it('reports the longest lead that saw the level, not the shortest', () => {
    // Two runs both call the event; the earlier one saw it 9 days out. Nine and
    // not eight because lead windows are upper-inclusive — the event day runs
    // from exactly 8 days after the 09-02 issue (lead 8) to 8d21h (lead 9).
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
    expect(five.maxLead).toBe(9);
    expect(five.maxLeadInit).toBe('20240902');
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
    expect(hundred.maxLead).toBe(10);
    expect(hundred.peakShare).toBeCloseTo(1 / 50, 6);
    expect(hundred.peakShareInit).toBe('20240901');

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
