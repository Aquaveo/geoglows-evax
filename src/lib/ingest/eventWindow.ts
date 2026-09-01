import type { TimeSeries } from '../types';

const DAY_MS = 24 * 3600 * 1000;

export interface WindowSuggestion {
  /** Suggested event start, YYYY-MM-DD. */
  start: string;
  /** Suggested event end, YYYY-MM-DD. */
  end: string;
  /** Day of the observed peak. */
  peakDay: string;
  peakValue: number;
  daysBefore: number;
  daysAfter: number;
  /** Flow the window opens at — the pre-event baseline it was chosen from. */
  baseline: number;
  /** Flow the window closes at. Close to `baseline` means the event is bracketed. */
  endFlow: number;
  /**
   * Set when the recession had not returned to near baseline by the window end,
   * so the falling limb is truncated.
   */
  recessionTruncated: string | null;
  /** Set when the uploaded series itself is the limiting factor. */
  dataLimited: string | null;
}

export interface SuggestOptions {
  /** Hard cap on start-to-end span, matching the Forecast tab. */
  maxDays?: number;
  /**
   * Flow is treated as "back to baseline" once it falls within this fraction
   * above the pre-event minimum.
   */
  recessionTolerance?: number;
  /** Days to search back from the peak for the pre-event minimum. */
  lookbackDays?: number;
}

/** Daily maxima, keyed YYYY-MM-DD. Sub-daily uploads need reducing first. */
function dailyMax(s: TimeSeries): { days: string[]; values: number[] } {
  const m = new Map<string, number>();
  for (let i = 0; i < s.time.length; i++) {
    const v = s.values[i];
    if (!Number.isFinite(v)) continue;
    const k = s.time[i].toISOString().slice(0, 10);
    const cur = m.get(k);
    if (cur === undefined || v > cur) m.set(k, v);
  }
  const days = [...m.keys()].sort();
  return { days, values: days.map((d) => m.get(d)!) };
}

const addDays = (day: string, n: number) =>
  new Date(new Date(`${day}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);

const spanDays = (a: string, b: string) =>
  Math.round(
    (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / DAY_MS,
  ) + 1;

/**
 * A start and end date that bracket the event in an uploaded series.
 *
 * The rule is hydrograph-shaped rather than a fixed number of days, because the
 * right answer depends on how fast the river rose and how slowly it drains. Two
 * events verified with this app wanted 5 days before the peak and 25 after, and
 * 16 before and 14 after, respectively — a fixed rule would have clipped one of
 * them.
 *
 * Open at the last minimum before the rise, close once flow is back near that
 * value. When the two cannot both fit inside the cap, the FRONT is trimmed
 * first: losing pre-event days costs a little lead coverage, whereas losing the
 * falling limb distorts every volume and timing metric, and the peak stops being
 * bracketed.
 *
 * Deliberately does NOT shorten the window to raise the categorical base rate.
 * Measured on a real event, the base rate stays 8-80x its long-run value at
 * every window length under the cap, so the dilution cannot be fixed this way —
 * it has to be read alongside the pair count instead. Meanwhile pairs per lead
 * equal the window length in days, so a longer window is strictly better for
 * every other metric.
 */
export function suggestEventWindow(
  event: TimeSeries,
  opts: SuggestOptions = {},
): WindowSuggestion | null {
  const maxDays = opts.maxDays ?? 31;
  const tol = opts.recessionTolerance ?? 0.3;
  const lookback = opts.lookbackDays ?? 20;

  const { days, values } = dailyMax(event);
  if (days.length < 3) return null;

  let pk = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[pk]) pk = i;

  // Pre-event minimum: the lowest day within `lookback` before the peak. That is
  // where the rise began, and it anchors both ends of the window.
  const from = Math.max(0, pk - lookback);
  let lo = from;
  for (let i = from; i < pk; i++) if (values[i] < values[lo]) lo = i;
  const baseline = values[lo];

  // Close once flow is back within tolerance of that baseline.
  const target = baseline * (1 + tol);
  let hi = values.length - 1;
  for (let i = pk + 1; i < values.length; i++) {
    if (values[i] <= target) {
      hi = i;
      break;
    }
  }

  const recessionIncomplete = values[hi] > target;
  let start = days[lo];
  let end = days[hi];

  // Trim the front if the pair exceeds the cap — the falling limb is worth more.
  if (spanDays(start, end) > maxDays) {
    start = addDays(end, -(maxDays - 1));
    // Never trim past the peak itself; if even peak-to-end will not fit, keep
    // the peak and accept a truncated recession instead.
    if (spanDays(start, days[pk]) < 1) {
      start = days[pk];
      end = addDays(start, maxDays - 1);
    }
  }

  const startIdx = days.indexOf(start);
  const endIdx = days.indexOf(end);
  const endFlow = endIdx >= 0 ? values[endIdx] : values[values.length - 1];
  const openFlow = startIdx >= 0 ? values[startIdx] : baseline;

  return {
    start,
    end,
    peakDay: days[pk],
    peakValue: values[pk],
    daysBefore: spanDays(start, days[pk]) - 1,
    daysAfter: spanDays(days[pk], end) - 1,
    baseline: openFlow,
    endFlow,
    recessionTruncated:
      recessionIncomplete || endFlow > target
        ? `flow is still ${(((endFlow - baseline) / baseline) * 100).toFixed(0)}% above the ` +
          `pre-event baseline at the window end, so the falling limb is cut off — volume and ` +
          `peak-timing metrics will be affected`
        : null,
    dataLimited:
      hi === values.length - 1 && recessionIncomplete
        ? 'the uploaded series ends before the river returned to baseline; a longer upload would ' +
          'let the window close properly'
        : null,
  };
}

/** Where an event was found in a long record, and the slice taken from it. */
export interface ExtractedEvent {
  /** The sliced series, ready to use as event observations. */
  series: TimeSeries;
  /** Window actually used. */
  start: string;
  end: string;
  peakDay: string;
  peakValue: number;
  /** Values in the slice. */
  n: number;
  /** Median spacing of the sliced series, in hours. */
  stepHours: number;
  /**
   * Set when the record's own cadence limits what can be measured. A daily
   * record cannot support sub-daily peak timing however the window is chosen.
   */
  cadenceCaveat: string | null;
}

/**
 * The highest value within `searchDays` of a target date, as a day key.
 *
 * Lets the user name an approximate date — "the flood was around the 21st" —
 * rather than having to locate the exact peak first.
 */
export function findPeakNear(
  record: TimeSeries,
  aroundDay: string,
  searchDays = 10,
): { day: string; value: number } | null {
  const target = new Date(`${aroundDay}T00:00:00Z`).getTime();
  let best: { day: string; value: number } | null = null;
  for (let i = 0; i < record.time.length; i++) {
    const v = record.values[i];
    if (!Number.isFinite(v)) continue;
    const dt = Math.abs(record.time[i].getTime() - target);
    if (dt > searchDays * DAY_MS) continue;
    if (!best || v > best.value) {
      best = { day: record.time[i].toISOString().slice(0, 10), value: v };
    }
  }
  return best;
}

/** Points of `s` falling inside [startDay, endDay] inclusive. */
export function sliceByDay(s: TimeSeries, startDay: string, endDay: string): TimeSeries {
  const lo = new Date(`${startDay}T00:00:00Z`).getTime();
  const hi = new Date(`${endDay}T23:59:59.999Z`).getTime();
  const time: Date[] = [];
  const values: number[] = [];
  for (let i = 0; i < s.time.length; i++) {
    const t = s.time[i].getTime();
    if (t < lo || t > hi) continue;
    time.push(s.time[i]);
    values.push(s.values[i]);
  }
  return { time, values };
}

/**
 * Cut an event out of a long observed record, given an approximate date.
 *
 * Removes the need to upload the same data twice: a multi-decade record already
 * contains the flood, so naming the date is enough. The window is chosen by
 * `suggestEventWindow` on a slice around the target, so the same
 * baseline-to-baseline rule applies.
 *
 * The catch is cadence, and it is stated rather than hidden. A historical record
 * is usually daily, and the comparison grid is the coarser of the two sides, so
 * an event derived from a daily record is compared daily — which caps peak
 * timing at 24-hour resolution however precise the forecasts are. Uploading a
 * sub-daily event file is the only way to do better.
 */
export function extractEvent(
  record: TimeSeries,
  aroundDay: string,
  opts: SuggestOptions & { searchDays?: number } = {},
): ExtractedEvent | null {
  const peak = findPeakNear(record, aroundDay, opts.searchDays ?? 10);
  if (!peak) return null;

  // Suggest from a generous slice around the peak so the recession is visible,
  // then let the suggestion trim to the cap.
  const context = sliceByDay(
    record,
    addDays(peak.day, -(opts.lookbackDays ?? 20) - 5),
    addDays(peak.day, 60),
  );
  const suggestion = suggestEventWindow(context, opts);
  if (!suggestion) return null;

  const series = sliceByDay(record, suggestion.start, suggestion.end);
  if (series.time.length < 2) return null;

  const gaps: number[] = [];
  for (let i = 1; i < series.time.length; i++) {
    gaps.push((series.time[i].getTime() - series.time[i - 1].getTime()) / 3600e3);
  }
  gaps.sort((a, b) => a - b);
  const stepHours = gaps[Math.floor(gaps.length / 2)];

  return {
    series,
    start: suggestion.start,
    end: suggestion.end,
    peakDay: suggestion.peakDay,
    peakValue: suggestion.peakValue,
    n: series.time.length,
    stepHours,
    cadenceCaveat:
      stepHours >= 24
        ? `this record is ${stepHours >= 24 ? 'daily' : 'coarse'}, so the comparison runs on a ` +
          `daily grid and peak timing cannot resolve better than 24 h. Upload a sub-daily event ` +
          `file if peak timing matters.`
        : null,
  };
}
