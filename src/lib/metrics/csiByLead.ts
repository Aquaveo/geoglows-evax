import { memberSeries } from '../leadBuckets';
import type { LeadBuckets, RpThresholds, TimeSeries } from '../types';
import { buildContingencyMatrix, exceedanceLabels, validCategories } from './contingency';
import { computeCsi } from './csi';

/**
 * CSI by lead day, at every exceedance threshold, from the MEMBER-POOLED
 * contingency matrix.
 *
 * Two decisions here, and both matter more than they look.
 *
 * POOLED, not median-across-members. The obvious construction — score each of
 * the 51 members separately and plot the median — is what the combined
 * categorical chart does, and it degrades badly on a single event: at the
 * 25-year threshold most members produce the same degenerate table, so the
 * median is decided by a handful of timesteps and its ordering accuracy against
 * a known-better forecast measures 0.576, which is a coin flip. Pooling the
 * members into one table per lead and scoring that once uses every member as
 * evidence rather than as a separate experiment.
 *
 * PER THRESHOLD, explicitly. CSI is only defined on a 2x2 table — there is no
 * accepted multi-category CSI, and the standard practice is to report it per
 * threshold. That is why it cannot share an axis with the multi-category MCC and
 * HSS: collapsing to "at or above the 2-year level" is an easier question than
 * grading all K categories, and CSI reads 0.08-0.12 higher on a severe event for
 * that reason alone. Giving it its own panel with the threshold named turns that
 * from a hidden inconsistency into the point of the chart.
 *
 * The reason to carry CSI at all is that it is the only score here that is
 * essentially exactly invariant to how long a window was uploaded: padding an
 * event with quiet days adds only correct negatives, and CSI = a/(a+b+c) never
 * touches the correct-negative cell. Measured over an 800-fold increase in
 * window length, CSI moves 0.003 while RPSS moves 0.028, MCC 0.070 and HSS
 * 0.074.
 */

export interface CsiThresholdSeries {
  /** Threshold category index into the matrix, 1-based. */
  category: number;
  /** Display label for the exceedance level, e.g. "≥10yr". */
  label: string;
  /** CSI per lead. NaN where nothing was observed or forecast at this level. */
  csi: number[];
  /** Probability of detection per lead, for the hover. */
  pod: number[];
  /** False-alarm ratio per lead, for the hover. */
  far: number[];
  /**
   * DISTINCT observed exceedance timesteps per lead — the honest sample size.
   *
   * Not the pooled hit count, which is inflated by the member dimension: 51
   * members scoring the same three flood days looks like 153 events and is
   * really three. Every guard and every caveat has to key off this number.
   */
  eventSteps: number[];
  /** Pooled cells, for the hover. */
  hits: number[];
  falseAlarms: number[];
  misses: number[];
}

export interface CsiByLead {
  leads: number[];
  thresholds: CsiThresholdSeries[];
  /** Members pooled into each lead's table. */
  members: number;
}

export function csiByLead(
  buckets: LeadBuckets,
  observed: TimeSeries,
  obsRp: RpThresholds,
  simRp: RpThresholds,
  eventRp: number,
  maxLead = 15,
  memberCount = 51,
): CsiByLead | null {
  const cats = validCategories(eventRp);
  // Exceedance labels, not band labels: each row is "at or above level k",
  // which includes every band above k as well.
  const labels = exceedanceLabels(eventRp);
  const K = cats.length;
  // K = 1 means the observations never crossed the lowest threshold, so there is
  // no exceedance to score at any level.
  if (K < 2) return null;

  const leads: number[] = [];
  const series: CsiThresholdSeries[] = [];
  for (let k = 1; k < K; k++) {
    series.push({
      category: k,
      label: labels[k] ?? `cat ${k}`,
      csi: [],
      pod: [],
      far: [],
      eventSteps: [],
      hits: [],
      falseAlarms: [],
      misses: [],
    });
  }

  const obsAt = new Map<number, number>();
  for (let i = 0; i < observed.time.length; i++) {
    const v = observed.values[i];
    if (Number.isFinite(v)) obsAt.set(observed.time[i].getTime(), v);
  }

  for (let lead = 0; lead <= maxLead; lead++) {
    leads.push(lead);
    const bucket = buckets[lead];

    // Pool every member into one table for this lead.
    const pooled: number[][] = Array.from({ length: K }, () => new Array<number>(K).fill(0));
    if (bucket && bucket.time.length > 0) {
      for (let m = 0; m < memberCount; m++) {
        const cm = buildContingencyMatrix(
          memberSeries(bucket, m),
          observed,
          obsRp,
          simRp,
          eventRp,
        );
        if (cm.n === 0) continue;
        for (let i = 0; i < K; i++) {
          for (let j = 0; j < K; j++) pooled[i][j] += cm.matrix[i][j];
        }
      }
    }

    for (const s of series) {
      let a = 0;
      let b = 0;
      let c = 0;
      for (let i = 0; i < K; i++) {
        for (let j = 0; j < K; j++) {
          const v = pooled[i][j];
          if (!Number.isFinite(v) || v === 0) continue;
          const obsEvent = i >= s.category;
          const fcstEvent = j >= s.category;
          if (obsEvent && fcstEvent) a += v;
          else if (!obsEvent && fcstEvent) b += v;
          else if (obsEvent && !fcstEvent) c += v;
        }
      }
      s.hits.push(a);
      s.falseAlarms.push(b);
      s.misses.push(c);
      s.eventSteps.push(distinctExceedances(bucket, obsAt, obsRp, cats[s.category]));
      // Through the canonical implementation, so the formula lives in exactly
      // one place. It returns NaN for an all-correct-negative table, which is
      // what lets this panel draw a GAP at thresholds a given lead never saw
      // rather than a line dropping to the floor — 0 is the worst attainable
      // CSI, and a lead where nothing happened did not earn it. The cells above
      // are kept for the hover and for POD/FAR, and a test pins them to agree.
      s.csi.push(computeCsi(pooled, s.category));
      s.pod.push(a + c === 0 ? Number.NaN : a / (a + c));
      s.far.push(a + b === 0 ? Number.NaN : b / (a + b));
    }
  }

  return { leads, thresholds: series, members: memberCount };
}

/**
 * How many distinct timesteps in this lead's bucket had an observation at or
 * above the threshold.
 *
 * Deduplicated by timestamp: a lead bucket pools across start dates and can
 * carry the same valid time more than once, and counting those separately would
 * overstate the sample exactly where it is smallest.
 */
function distinctExceedances(
  bucket: { time: Date[] } | undefined,
  obsAt: Map<number, number>,
  obsRp: RpThresholds,
  rpLevel: number,
): number {
  if (!bucket) return 0;
  const threshold = obsRp[rpLevel];
  if (!Number.isFinite(threshold)) return 0;
  const seen = new Set<number>();
  for (const t of bucket.time) {
    const ms = t.getTime();
    if (seen.has(ms)) continue;
    const v = obsAt.get(ms);
    if (v !== undefined && v >= threshold) seen.add(ms);
  }
  return seen.size;
}
