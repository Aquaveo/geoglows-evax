import type { ForecastRun, RpThresholds } from './types';
import { RP_LEVELS } from './types';
import { parseStartDate } from './leadBuckets';

const DAY_MS = 24 * 3600 * 1000;

/** One cell of the grid. */
export interface Cell {
  /** Share of member forecasts that crossed, 0–1. NaN when the column has no data. */
  share: number;
  /** Members that crossed. */
  crossed: number;
  /** Members with data in the window for this column — the denominator. */
  total: number;
}

export interface ExceedanceGrid {
  /** Return-period levels, ascending — the rows. */
  levels: number[];
  /** Column keys: YYYYMMDD initialisation dates, or lead-day numbers as strings. */
  columns: string[];
  /** grid[levelIndex][columnIndex]. */
  grid: Cell[][];
}

/** What the ensemble did at one threshold, across the whole window. */
export interface LevelSummary {
  level: number;
  /** Threshold value in m³/s. */
  threshold: number;
  /** Members that crossed it in any forecast. */
  everCrossed: boolean;
  /*
   * There is deliberately no "longest lead any member crossed" field here.
   *
   * It existed, was displayed, and was removed. The lookback is exactly
   * `tolerance + maxLead` days, so the oldest run's lead into the OPENING of
   * the flood window is `maxLead` by construction, and one member crossing
   * anywhere inside the window pins it there. On a real event (reach
   * 120694849, January 2026) it read "15 d" at all six levels while the
   * warning time below ranged from 7 days down to 3. `majorityLeadDays` is
   * the quantity it was standing in for and could not supply.
   */
  /**
   * Largest share of members crossing in any single initialisation.
   *
   * This is the column that keeps `everCrossed` honest. On a real run (reach
   * 770143064, June 2025) one member of one forecast crossed every level up to
   * the 100-year, 15 days out — so `everCrossed` was true at all six levels
   * while the ensemble as a whole never agreed above the 2-year.
   * Reported together, the pair says what happened; either alone does not.
   */
  peakShare: number;
  /** Initialisation behind `peakShare`, as YYYYMMDD. */
  peakShareInit: string | null;
  /**
   * The earliest forecast in which more than half the members crossed this
   * level, and how many days before the flood it was issued.
   *
   * This is the warning time, and it is the number `maxLead` was standing in
   * for and could not supply. `maxLead` is structurally incapable of it: the
   * lookback is exactly `tolerance + maxLead` days, so the oldest run's lead
   * into the opening of the window is `maxLead` by construction, and a single
   * member crossing anywhere pins it there. On a real event it reported "15 d"
   * at all six levels.
   *
   * "More than half the members" is a description of the ensemble, not a
   * skill threshold and not a probability — it is the plainest statement of
   * when the bulk of the spread committed, which is what a lone outlier cannot
   * fake.
   */
  majorityInit: string | null;
  /** Days from `majorityInit` to the start of the reported flood window. */
  majorityLeadDays: number | null;
  /** Share at `majorityInit`, so the figure never travels without its share. */
  majorityShare: number | null;
  /** Members over the level at `majorityInit`, and the members with data there. */
  majorityCrossed: number | null;
  majorityTotal: number | null;
  /**
   * Members over the level at `peakShareInit`, as counts.
   *
   * Counts rather than only a percentage because "2%" and "1 of 51" carry the
   * same number and not the same warning, and a percentage of members invites
   * being read as a probability, which it is not.
   */
  peakCrossed: number | null;
  peakTotal: number | null;
  /**
   * Forecasts in which more than half the members were over this level, and
   * forecasts in which any member was.
   *
   * The pair is what keeps a row informative when no majority ever forms. A
   * level crossed by 35% of members in seven separate forecasts is a real,
   * persistent, minority signal; reporting only "never over half" would throw
   * that away and leave the row blank, which reads as "nothing happened".
   *
   * A count of forecasts, not a maximum over them, so one twitchy member
   * cannot move it the way the old `maxLead` did.
   */
  majorityForecasts: number;
  anyForecasts: number;
}

export interface FloodCheckResult {
  /** By the date each forecast was issued — the timeline a person lived through. */
  byInitialisation: ExceedanceGrid;
  /** By lead day, pooled across initialisations — the forecast-horizon view. */
  byLead: ExceedanceGrid;
  /** One row per return-period level, ascending. */
  levels: LevelSummary[];
  /** Highest level any member reached anywhere in the window, or null. */
  highestLevelReached: number | null;
  /** Largest single member value in the window, for a sanity check on the reach. */
  peakForecast: number;
  /** When that largest member value occurred, and which run carried it. */
  peakForecastTime: Date | null;
  peakForecastInit: string | null;
  /** Initialisations that returned usable data. */
  runsUsed: number;
  /** Member forecasts examined, across all initialisations. */
  memberForecasts: number;
}

export interface FloodCheckOptions {
  /** Reported event start and end, inclusive, as UTC days. */
  eventStart: Date;
  eventEnd: Date;
  /**
   * Days either side of the reported window that still count as the event.
   *
   * People report the day they NOTICED flooding, which usually lags the crest,
   * and a forecast that called the peak one day off is not a forecast that
   * missed the flood. Without slack the check would answer a question about
   * date bookkeeping instead of one about the model.
   */
  toleranceDays?: number;
  maxLead?: number;
}

/**
 * What share of ensemble members crossed each return-period level during a
 * reported flood, by initialisation date and by lead day.
 *
 * Deliberately not a score. It reports what the forecasts said and leaves the
 * judgement to the reader: any fixed "captured / not captured" rule would need a
 * member fraction and a threshold to defend, and neither has a defensible value.
 *
 * Thresholds are the SIMULATED return periods, fitted to the model's own
 * retrospective. That is what makes the check fair to a biased reach — a model
 * running systematically low still crosses its own 5-year level, where an
 * observed threshold would report it as having missed every flood it forecast
 * correctly but small.
 *
 * A member counts as crossing a level if it goes above it at ANY timestep inside
 * the window, so the denominator is member forecasts, not member-timesteps: a
 * member that spends one hour over the threshold called the flood just as much
 * as one that spent three days there.
 */
export function floodCheck(
  forecasts: Map<string, ForecastRun>,
  simRp: RpThresholds,
  opts: FloodCheckOptions,
): FloodCheckResult {
  const tol = (opts.toleranceDays ?? 2) * DAY_MS;
  const maxLead = opts.maxLead ?? 15;
  const lo = opts.eventStart.getTime() - tol;
  const hi = opts.eventEnd.getTime() + DAY_MS - 1 + tol;

  const levels = RP_LEVELS.filter((rp) => Number.isFinite(simRp[rp])).sort((a, b) => a - b);
  const initKeys = [...forecasts.keys()].sort();
  const leadKeys = Array.from({ length: maxLead + 1 }, (_, d) => String(d));

  const byInit = levels.map(() => new Map<string, [number, number]>());
  const byLead = levels.map(() => new Map<string, [number, number]>());

  const summaries: LevelSummary[] = levels.map((level) => ({
    level,
    threshold: simRp[level],
    everCrossed: false,
    peakShare: 0,
    peakShareInit: null,
    majorityInit: null,
    majorityLeadDays: null,
    majorityShare: null,
    majorityCrossed: null,
    majorityTotal: null,
    peakCrossed: null,
    peakTotal: null,
    majorityForecasts: 0,
    anyForecasts: 0,
  }));

  let peakForecast = Number.NEGATIVE_INFINITY;
  let peakForecastTime: Date | null = null;
  let peakForecastInit: string | null = null;
  let runsUsed = 0;
  let memberForecasts = 0;

  for (const key of initKeys) {
    const run = forecasts.get(key);
    const t0 = parseStartDate(key)?.getTime();
    if (!run || run.time.length === 0 || run.discharge.length === 0 || t0 == null) continue;

    const M = run.discharge.length;
    // Per-member flags for this run: crossed anywhere in the window (init view),
    // and crossed at each lead day (lead view).
    const initCrossed = levels.map(() => new Array<boolean>(M).fill(false));
    const initHasData = new Array<boolean>(M).fill(false);
    const leadCrossed = new Map<number, boolean[][]>();
    const leadHasData = new Map<number, boolean[]>();

    let touched = false;
    for (let i = 0; i < run.time.length; i++) {
      const ms = run.time[i]?.getTime();
      if (!Number.isFinite(ms) || ms < lo || ms > hi) continue;
      const lead = ms === t0 ? 0 : Math.ceil((ms - t0) / DAY_MS);
      if (lead < 0 || lead > maxLead) continue;

      let lc = leadCrossed.get(lead);
      let lh = leadHasData.get(lead);
      if (!lc || !lh) {
        lc = levels.map(() => new Array<boolean>(M).fill(false));
        lh = new Array<boolean>(M).fill(false);
        leadCrossed.set(lead, lc);
        leadHasData.set(lead, lh);
      }

      for (let m = 0; m < M; m++) {
        const v = run.discharge[m]?.[i];
        if (!Number.isFinite(v)) continue;
        touched = true;
        initHasData[m] = true;
        lh[m] = true;
        if (v > peakForecast) {
          peakForecast = v;
          peakForecastTime = run.time[i];
          peakForecastInit = key;
        }
        for (let li = 0; li < levels.length; li++) {
          if (v < simRp[levels[li]]) continue;
          initCrossed[li][m] = true;
          lc[li][m] = true;
          summaries[li].everCrossed = true;
        }
      }
    }
    if (!touched) continue;
    runsUsed += 1;

    const initTotal = count(initHasData);
    memberForecasts += initTotal;
    for (let li = 0; li < levels.length; li++) {
      const c = count(initCrossed[li]);
      byInit[li].set(key, [c, initTotal]);
      if (c > 0) summaries[li].anyForecasts += 1;
      if (initTotal > 0 && c / initTotal > 0.5) summaries[li].majorityForecasts += 1;
      if (initTotal > 0 && c / initTotal > summaries[li].peakShare) {
        summaries[li].peakShare = c / initTotal;
        summaries[li].peakShareInit = key;
        summaries[li].peakCrossed = c;
        summaries[li].peakTotal = initTotal;
      }
      for (const [lead, lc] of leadCrossed) {
        const total = count(leadHasData.get(lead) ?? []);
        if (total === 0) continue;
        add(byLead[li], String(lead), count(lc[li]), total);
      }
    }
  }

  // Warning time, read off the assembled initialisation grid: the first column,
  // in issue order, where more than half the members crossed.
  const usedInits = initKeys.filter((k) => byInit[0]?.has(k) ?? false);
  for (let li = 0; li < levels.length; li++) {
    for (const k of usedInits) {
      const t = byInit[li].get(k);
      if (!t || t[1] === 0 || t[0] / t[1] <= 0.5) continue;
      const issued = parseStartDate(k)?.getTime();
      if (issued == null) continue;
      summaries[li].majorityInit = k;
      summaries[li].majorityShare = t[0] / t[1];
      summaries[li].majorityCrossed = t[0];
      summaries[li].majorityTotal = t[1];
      // Days before the flood window OPENS, not before the crest: the crest day
      // is not known at issue time, so lead-to-onset is the figure a forecaster
      // would actually have had.
      summaries[li].majorityLeadDays = Math.round(
        (opts.eventStart.getTime() - issued) / DAY_MS,
      );
      break;
    }
  }

  return {
    byInitialisation: assemble(levels, usedInits, byInit),
    byLead: assemble(levels, leadKeys, byLead),
    levels: summaries,
    highestLevelReached: summaries.filter((s) => s.everCrossed).map((s) => s.level).pop() ?? null,
    peakForecast: Number.isFinite(peakForecast) ? peakForecast : Number.NaN,
    peakForecastTime,
    peakForecastInit,
    runsUsed,
    memberForecasts,
  };
}

/**
 * Per-timestep ensemble median of one run, and where it crests.
 *
 * The crest of the MEDIAN rather than of the highest member, because the
 * question "what day did the forecast put the peak on" is about what the
 * ensemble as a whole said. A single high member can crest a day or two off the
 * bulk of the spread, and reporting that as the forecast peak day would be the
 * same one-member overreach the verdict table exists to prevent.
 */
export function medianSeries(run: ForecastRun): { time: Date[]; median: number[] } {
  const time = run.time;
  const median = new Array<number>(time.length).fill(Number.NaN);
  const buf: number[] = [];
  for (let i = 0; i < time.length; i++) {
    buf.length = 0;
    for (let m = 0; m < run.discharge.length; m++) {
      const v = run.discharge[m]?.[i];
      if (Number.isFinite(v)) buf.push(v);
    }
    if (buf.length === 0) continue;
    buf.sort((a, b) => a - b);
    const mid = buf.length >> 1;
    median[i] = buf.length % 2 === 1 ? buf[mid] : (buf[mid - 1] + buf[mid]) / 2;
  }
  return { time, median };
}

/** Where a run's ensemble median crests inside [lo, hi]. */
export function crestOfRun(
  run: ForecastRun,
  lo: number,
  hi: number,
): { time: Date; value: number } | null {
  const { time, median } = medianSeries(run);
  let best = Number.NEGATIVE_INFINITY;
  let at: Date | null = null;
  for (let i = 0; i < time.length; i++) {
    const ms = time[i]?.getTime();
    if (!Number.isFinite(ms) || ms < lo || ms > hi) continue;
    if (median[i] > best) {
      best = median[i];
      at = time[i];
    }
  }
  return at && Number.isFinite(best) ? { time: at, value: best } : null;
}

/** Highest return-period level a value reaches, or null if below the 2-year. */
export function levelOf(value: number, rp: RpThresholds): number | null {
  let out: number | null = null;
  for (const lvl of RP_LEVELS) {
    if (Number.isFinite(rp[lvl]) && value >= rp[lvl]) out = lvl;
  }
  return out;
}

function count(flags: readonly boolean[]): number {
  let n = 0;
  for (const f of flags) if (f) n++;
  return n;
}

function add(m: Map<string, [number, number]>, key: string, crossed: number, total: number) {
  const cur = m.get(key);
  if (cur) {
    cur[0] += crossed;
    cur[1] += total;
  } else {
    m.set(key, [crossed, total]);
  }
}

function assemble(
  levels: number[],
  columns: string[],
  tally: Map<string, [number, number]>[],
): ExceedanceGrid {
  return {
    levels,
    columns,
    // NaN, not 0, where a column has no data: a level nothing came near and a
    // date nothing was fetched for both read as zero otherwise, and they mean
    // opposite things.
    grid: levels.map((_, li) =>
      columns.map((c) => {
        const t = tally[li].get(c);
        return t && t[1] > 0
          ? { share: t[0] / t[1], crossed: t[0], total: t[1] }
          : { share: Number.NaN, crossed: 0, total: 0 };
      }),
    ),
  };
}
