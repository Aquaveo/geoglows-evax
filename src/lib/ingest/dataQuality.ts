import type { TimeSeries } from '../types';
import { detectCadence } from './cadence';

export interface Gap {
  after: Date;
  before: Date;
  /** Missing steps at the series' own cadence. */
  missingSteps: number;
}

export interface Outlier {
  time: Date;
  value: number;
  /** Multiple of the reference maximum. */
  ratio: number;
}

export interface DataQuality {
  n: number;
  cadenceLabel: string;
  spanDays: number;
  /** Runs of missing timesteps, largest first. */
  gaps: Gap[];
  totalMissingSteps: number;
  /** Values above the reference maximum, largest first. */
  outliers: Outlier[];
  /** The reference maximum outliers were judged against, when one was available. */
  referenceMax: number | null;
}

/**
 * Flag the two things that quietly wreck magnitude metrics: gaps, and single
 * readings far above anything in the historical record.
 *
 * Both matter because they are invisible in a summary. One reading twelve times
 * the all-time maximum owns almost all of a short event's variance, so NSE and
 * KGE' stop measuring forecast skill and start measuring whether the forecast
 * reproduced that one value — which nothing will. A gap through the peak means
 * the observed maximum may simply not be in the file.
 */
export function assessEventData(
  event: TimeSeries,
  reference?: TimeSeries | null,
  opts: { outlierRatio?: number; maxReport?: number } = {},
): DataQuality | null {
  if (event.time.length === 0) return null;
  const ratioThreshold = opts.outlierRatio ?? 1;
  const maxReport = opts.maxReport ?? 5;

  const cadence = detectCadence(event);
  const step = cadence?.stepMs ?? 0;

  const gaps: Gap[] = [];
  let totalMissingSteps = 0;
  if (step > 0) {
    for (let i = 1; i < event.time.length; i++) {
      const delta = event.time[i].getTime() - event.time[i - 1].getTime();
      const missing = Math.round(delta / step) - 1;
      if (missing >= 1) {
        gaps.push({ after: event.time[i - 1], before: event.time[i], missingSteps: missing });
        totalMissingSteps += missing;
      }
    }
  }
  // Non-finite values inside the series are missing too, even without a time gap.
  for (let i = 0; i < event.values.length; i++) {
    if (!Number.isFinite(event.values[i])) totalMissingSteps += 1;
  }
  gaps.sort((a, b) => b.missingSteps - a.missingSteps);

  let referenceMax: number | null = null;
  if (reference && reference.values.length > 0) {
    let m = -Infinity;
    for (const v of reference.values) if (Number.isFinite(v) && v > m) m = v;
    if (Number.isFinite(m)) referenceMax = m;
  }

  const outliers: Outlier[] = [];
  if (referenceMax != null && referenceMax > 0) {
    for (let i = 0; i < event.values.length; i++) {
      const v = event.values[i];
      if (Number.isFinite(v) && v > referenceMax * ratioThreshold) {
        outliers.push({ time: event.time[i], value: v, ratio: v / referenceMax });
      }
    }
    outliers.sort((a, b) => b.value - a.value);
  }

  const spanDays =
    (event.time[event.time.length - 1].getTime() - event.time[0].getTime()) / 86_400_000;

  return {
    n: event.time.length,
    cadenceLabel: cadence?.label ?? 'unknown',
    spanDays,
    gaps: gaps.slice(0, maxReport),
    totalMissingSteps,
    outliers: outliers.slice(0, maxReport),
    referenceMax,
  };
}
