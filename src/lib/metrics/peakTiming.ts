import type { TimeSeries } from '../types';

const HOUR_MS = 3600 * 1000;

/** Why a member produced no Δt, or null when it produced one. */
export type NoPeakReason = 'no-overlap' | 'no-distinct-peak' | 'peak-at-window-edge';

export interface PeakTimingResult {
  /** Hours; negative is an early forecast peak. Null when there is no timing. */
  deltaHours: number | null;
  reason: NoPeakReason | null;
}

/**
 * Peak timing error in hours: Δt_peak = t_peak_forecast − t_peak_observed.
 *
 * Every member's maximum is taken, with no threshold deciding whether it counts
 * as "a peak". Two earlier candidates for such a threshold were both wrong:
 *
 * A RELATIVE PROMINENCE gate — the in-window range as a fraction of the maximum
 * — discards broad crests, because within a window centred on the crest the
 * minimum IS flood flow, so the test compares the crest against itself. Measured
 * on a flood three times baseflow: prominence 0.667 for a 12-hour crest, 0.029
 * for a 240-hour snowmelt crest, which a 0.1 gate rejects outright. It fails on
 * exactly the sustained events that matter most, and river size is irrelevant to
 * it — the ratio is scale-free, the crest width is what breaks it.
 *
 * A RETURN-PERIOD gate reintroduces magnitude into a metric that is deliberately
 * magnitude-independent. Δt is 0 for a member with perfect timing and hopeless
 * magnitude, which is the property that makes it worth reporting separately from
 * KGE′ — so discarding a member for running low would measure the wrong thing.
 * It would also empty the metric on any event below the 2-year threshold.
 *
 * So nothing is excluded for being a poor forecast. Only two cases yield no
 * timing, and both are facts about the data rather than tuned thresholds:
 *
 *   no-distinct-peak     the maximum is attained at more than one timestep, so
 *                        there is no argmax. A flat member is this. Previously
 *                        the tie-break silently returned the FIRST timestep,
 *                        manufacturing a large systematic "early" — measured at
 *                        −240 h on a 21-day window, identical for every flat
 *                        member, so they voted in unison.
 *   peak-at-window-edge  the maximum is the first or last sample, so the true
 *                        peak may lie outside and Δt is a bound, not a
 *                        measurement.
 *
 * Members with a coherent but noisy shape ARE scored. Their scatter is the
 * finding — the model had no peak to time — and hiding it would flatter the
 * spread. Callers must report the counts alongside, or excluding anything at all
 * becomes survivorship bias.
 */
export function computePeakTiming(
  forecast: TimeSeries,
  observed: TimeSeries,
): PeakTimingResult {
  if (forecast.time.length === 0 || observed.time.length === 0) {
    return { deltaHours: null, reason: 'no-overlap' };
  }

  const fStart = forecast.time[0].getTime();
  const fEnd = forecast.time[forecast.time.length - 1].getTime();
  const oStart = observed.time[0].getTime();
  const oEnd = observed.time[observed.time.length - 1].getTime();
  const start = Math.max(fStart, oStart);
  const end = Math.min(fEnd, oEnd);
  if (start >= end) return { deltaHours: null, reason: 'no-overlap' };

  const fcst = argmaxInWindow(forecast, start, end);
  const obs = argmaxInWindow(observed, start, end);
  if (fcst == null || obs == null) return { deltaHours: null, reason: 'no-overlap' };
  // The forecast side is the one being judged; a degenerate observed series is
  // an upload problem and surfaces as no-overlap for every member alike.
  if (fcst.flat) return { deltaHours: null, reason: 'no-distinct-peak' };
  if (fcst.atEdge) return { deltaHours: null, reason: 'peak-at-window-edge' };

  return { deltaHours: (fcst.time - obs.time) / HOUR_MS, reason: null };
}

/** Back-compat shim: the Δt alone, null whenever there is no timing. */
export function computePeakTimingError(
  forecast: TimeSeries,
  observed: TimeSeries,
): number | null {
  return computePeakTiming(forecast, observed).deltaHours;
}

interface Argmax {
  time: number;
  /**
   * Every finite value in the window is the same, so there is no peak at all.
   *
   * Distinct from a maximum shared by a few adjacent timesteps, which is a crest
   * with a plateau and IS a peak. Rejecting any tie discarded those — and a
   * saturated bias correction maps neighbouring values to exactly the same
   * number, so they are what the corrected variants produce.
   */
  flat: boolean;
  /** It is the first or last finite sample in the window. */
  atEdge: boolean;
}

function argmaxInWindow(s: TimeSeries, start: number, end: number): Argmax | null {
  let bestT: number | null = null;
  let lastPlateauT: number | null = null;
  let bestV = -Infinity;
  let distinct = 0;
  let prevV = Number.NaN;
  let prevT: number | null = null;
  let firstT: number | null = null;
  let lastT: number | null = null;

  for (let i = 0; i < s.time.length; i++) {
    const ms = s.time[i].getTime();
    if (ms < start || ms > end) continue;
    const v = s.values[i];
    if (!Number.isFinite(v)) continue;
    if (firstT == null) firstT = ms;
    lastT = ms;
    if (v !== prevV) {
      distinct += 1;
      prevV = v;
    }
    if (v > bestV) {
      bestV = v;
      // FIRST attainment: the time to peak is when the flow reaches its
      // maximum, and it must match the observed side, which keeps the first of
      // any ties too.
      bestT = ms;
      lastPlateauT = ms;
    } else if (v === bestV && prevT === lastPlateauT) {
      // Contiguous continuation of the same crest, tracked only so the edge
      // test can see whether the plateau runs to the window's end.
      lastPlateauT = ms;
    }
    prevT = ms;
  }
  if (bestT == null) return null;
  return {
    time: bestT,
    flat: distinct <= 1,
    atEdge: bestT === firstT || lastPlateauT === lastT,
  };
}
