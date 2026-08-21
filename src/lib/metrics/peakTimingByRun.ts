import type { ForecastRun, TimeSeries } from '../types';

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type { ForecastRun };

export interface PeakTimingByRunOptions {
  /**
   * Half-width, in hours, of the window around the observed peak in which a
   * forecast peak is looked for. Bounds |Δt| by construction.
   */
  searchWindowHours?: number;
  /**
   * Minimum relative prominence, (max − min) / max inside the window, for a
   * member to count as having predicted a peak at all.
   */
  minProminence?: number;
}

export interface PeakTimingByRun {
  /** Whole days between each run's initialization and the day the observed peak fell on. */
  daysBefore: number[];
  /** Initialization date of each run as YYYY-MM-DD, aligned with `daysBefore`. */
  initDates: string[];
  /** values[i] = Δt_peak in hours for each member of run i. Negative = forecast early. */
  values: number[][];
  /** Timestamp of the observed peak, or null when the event series is empty. */
  obsPeak: Date | null;
  /** Members whose in-window maximum sat on the window edge — peak likely outside it. */
  censoredMembers: number;
  /** Members with no discernible peak in the window: they never predicted the event. */
  noPeakMembers: number;
  /** Runs skipped for being initialized after the observed peak had already passed. */
  runsAfterPeak: number;
  /** Runs left with no usable member, so they contribute no box. */
  emptyRuns: number;
  /** Half-width actually used, for labelling. */
  searchWindowHours: number;
}

/**
 * Peak timing error grouped by how far ahead of the observed peak each forecast
 * was issued — "what did the forecast say 15 days out, 14 days out, …".
 *
 * This is deliberately per-run. The lead-bucket version of peak timing splices
 * one member index across many initializations, but ensemble member identity
 * does not carry between runs, so its 51 values are 51 arbitrary splices rather
 * than an ensemble. Here every box is one model run, and within a run the 51
 * members genuinely are the ensemble — so box height is real forecast spread.
 *
 * Two guards keep the answer meaningful, both learned the hard way:
 *
 * 1. The forecast peak is sought only within `searchWindowHours` of the observed
 *    peak. Searching a run's whole 15-day horizon means that a run which never
 *    predicted the event — flat baseflow, which is what long-lead runs look like
 *    before the rain enters the initial conditions — yields an argmax at an
 *    arbitrary point, reporting timing errors of hundreds of hours. Bounding the
 *    window caps |Δt| at the half-width.
 * 2. The member must actually have a peak: its in-window range must clear
 *    `minProminence` relative to its maximum. A flat series has no peak to time,
 *    so it is counted as "no peak predicted" rather than scored. That count is
 *    the real signal at long lead — not a timing number.
 *
 * A member whose in-window maximum sits on the window edge is censored too: the
 * true peak probably lies outside, making Δt a bound rather than a measurement.
 */
export function computePeakTimingByRun(
  forecasts: Map<string, ForecastRun>,
  eventData: TimeSeries,
  opts: PeakTimingByRunOptions = {},
): PeakTimingByRun {
  const searchWindowHours = opts.searchWindowHours ?? 72;
  const minProminence = opts.minProminence ?? 0.1;

  const empty: PeakTimingByRun = {
    daysBefore: [],
    initDates: [],
    values: [],
    obsPeak: null,
    censoredMembers: 0,
    noPeakMembers: 0,
    runsAfterPeak: 0,
    emptyRuns: 0,
    searchWindowHours,
  };
  if (eventData.time.length === 0 || forecasts.size === 0) return empty;

  // Observed peak over the whole uploaded event.
  let obsPeakMs: number | null = null;
  let obsPeakVal = -Infinity;
  for (let i = 0; i < eventData.time.length; i++) {
    const v = eventData.values[i];
    if (!Number.isFinite(v)) continue;
    if (v > obsPeakVal) {
      obsPeakVal = v;
      obsPeakMs = eventData.time[i].getTime();
    }
  }
  if (obsPeakMs == null) return empty;

  const obsPeakDay = utcDayFloor(obsPeakMs);

  const winLo = obsPeakMs - searchWindowHours * HOUR_MS;
  const winHi = obsPeakMs + searchWindowHours * HOUR_MS;

  const rows: { daysBefore: number; initDate: string; deltas: number[] }[] = [];
  let censoredMembers = 0;
  let noPeakMembers = 0;
  let runsAfterPeak = 0;
  let emptyRuns = 0;

  for (const [dateStr, run] of forecasts) {
    const t0 = parseStartDate(dateStr);
    if (t0 == null || run.time.length === 0) continue;

    // Whole days from the run's initialization to the observed peak's day. Both
    // are UTC midnight, so this is exact.
    const daysBefore = Math.round((obsPeakDay - t0) / DAY_MS);
    if (daysBefore < 0) {
      // Initialized after the peak had already happened — not a forecast of it.
      runsAfterPeak++;
      continue;
    }

    // Indices of this run's timesteps that fall inside the search window.
    const inWindow: number[] = [];
    for (let i = 0; i < run.time.length; i++) {
      const ms = run.time[i].getTime();
      if (ms >= winLo && ms <= winHi) inWindow.push(i);
    }
    if (inWindow.length < 3) continue; // window not covered by this run

    const deltas: number[] = [];
    for (let m = 0; m < run.discharge.length; m++) {
      const series = run.discharge[m];
      if (!series) continue;

      let bestIdx = -1;
      let bestVal = -Infinity;
      let minVal = Infinity;
      for (const i of inWindow) {
        const v = series[i];
        if (!Number.isFinite(v)) continue;
        if (v > bestVal) {
          bestVal = v;
          bestIdx = i;
        }
        if (v < minVal) minVal = v;
      }
      if (bestIdx < 0) continue;

      // No discernible rise: this member never predicted the event, so there is
      // no peak whose timing could be wrong.
      const prominence = bestVal > 0 ? (bestVal - minVal) / bestVal : 0;
      if (!(prominence >= minProminence)) {
        noPeakMembers++;
        continue;
      }

      // Maximum on the window edge: the real peak is probably outside it.
      if (bestIdx === inWindow[0] || bestIdx === inWindow[inWindow.length - 1]) {
        censoredMembers++;
        continue;
      }
      deltas.push((run.time[bestIdx].getTime() - obsPeakMs) / HOUR_MS);
    }

    // A run with nothing left after censoring gets counted but not plotted —
    // an empty box would just stretch the axis. Runs older than the forecast
    // horizon land here, which is why the plot stops where it does.
    if (deltas.length === 0) {
      emptyRuns++;
      continue;
    }
    rows.push({
      daysBefore,
      initDate: `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`,
      deltas,
    });
  }

  // Ascending by initialization date, i.e. oldest forecast on the left.
  rows.sort((a, b) => b.daysBefore - a.daysBefore);

  return {
    daysBefore: rows.map((r) => r.daysBefore),
    initDates: rows.map((r) => r.initDate),
    values: rows.map((r) => r.deltas),
    obsPeak: new Date(obsPeakMs),
    censoredMembers,
    noPeakMembers,
    runsAfterPeak,
    emptyRuns,
    searchWindowHours,
  };
}

function utcDayFloor(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** YYYYMMDD → UTC midnight. Mirrors the parser in leadBuckets. */
function parseStartDate(yyyymmdd: string): number | null {
  if (!/^\d{8}$/.test(yyyymmdd)) return null;
  return Date.UTC(
    Number(yyyymmdd.slice(0, 4)),
    Number(yyyymmdd.slice(4, 6)) - 1,
    Number(yyyymmdd.slice(6, 8)),
  );
}
