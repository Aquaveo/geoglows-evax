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
  /**
   * Longest lead at which a member crossed it — the warning time this level got.
   *
   * Longest, not shortest: the question a flood check answers is how much notice
   * the model gave, and the earliest forecast to call the event is the one that
   * would have given it.
   */
  maxLead: number | null;
  /** Initialisation date behind `maxLead`, as YYYYMMDD. */
  maxLeadInit: string | null;
  /**
   * Largest share of members crossing in any single initialisation.
   *
   * This is the column that keeps `everCrossed` honest. On a real run (reach
   * 770143064, June 2025) one member of one forecast crossed every level up to
   * the 100-year, 15 days out — so `everCrossed` and `maxLead` were true at all
   * six levels while the ensemble as a whole never agreed above the 2-year.
   * Reported together, the pair says what happened; either alone does not.
   */
  peakShare: number;
  /** Initialisation behind `peakShare`, as YYYYMMDD. */
  peakShareInit: string | null;
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
    maxLead: null,
    maxLeadInit: null,
    peakShare: 0,
    peakShareInit: null,
  }));

  let peakForecast = Number.NEGATIVE_INFINITY;
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
        if (v > peakForecast) peakForecast = v;
        for (let li = 0; li < levels.length; li++) {
          if (v < simRp[levels[li]]) continue;
          initCrossed[li][m] = true;
          lc[li][m] = true;
          const s = summaries[li];
          s.everCrossed = true;
          if (s.maxLead == null || lead > s.maxLead) {
            s.maxLead = lead;
            s.maxLeadInit = key;
          }
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
      if (initTotal > 0 && c / initTotal > summaries[li].peakShare) {
        summaries[li].peakShare = c / initTotal;
        summaries[li].peakShareInit = key;
      }
      for (const [lead, lc] of leadCrossed) {
        const total = count(leadHasData.get(lead) ?? []);
        if (total === 0) continue;
        add(byLead[li], String(lead), count(lc[li]), total);
      }
    }
  }

  return {
    byInitialisation: assemble(levels, initKeys.filter((k) => byInit[0]?.has(k) ?? false), byInit),
    byLead: assemble(levels, leadKeys, byLead),
    levels: summaries,
    highestLevelReached: summaries.filter((s) => s.everCrossed).map((s) => s.level).pop() ?? null,
    peakForecast: Number.isFinite(peakForecast) ? peakForecast : Number.NaN,
    runsUsed,
    memberForecasts,
  };
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
