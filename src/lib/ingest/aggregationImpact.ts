import { determineEventReturnPeriod } from '../metrics/contingency';
import type { RpThresholds, TimeSeries } from '../types';
import { aggregateSeries, type Aggregation } from './grid';

export interface AggregationImpact {
  /** The summary in use. */
  chosen: Aggregation;
  /** Observed peak the chosen summary reports, and what each alternative would. */
  peak: Record<Aggregation, number>;
  /** Event return period each summary yields. */
  eventRp: Record<Aggregation, number>;
  /** True when the choice changes the event's return-period classification. */
  changesEventRp: boolean;
  /** Bins classified above the lowest threshold, per summary. */
  exceedances: Record<Aggregation, number>;
}

/**
 * What the bin-summary choice actually costs on THIS event.
 *
 * Neither summary is universally right, which is why the app offers the choice
 * — but the choice can be silently decisive, and which way it goes depends on
 * the shape of the event relative to the grid:
 *
 *   flashy event, coarse grid   a 1.2-hour spike inside a 3-hour bin survives
 *                               the MAX and is erased by the mean or median.
 *                               Measured: peak 280 kept by max, reported as 204
 *                               by the median, and an exceedance of the 250
 *                               threshold becomes zero exceedances.
 *   broad event, fine scatter   the max picks up hour-to-hour noise and inflates
 *                               the exceedance rate. Measured: 5.0% against a
 *                               true 2.9%, where the median gave 2.5%.
 *
 * So rather than argue for a default, this reports whether the choice changed
 * the answer for the data actually loaded. The sharpest form of that is the
 * event's return period: if the summary decides whether this was a 5-year or a
 * 10-year flood, every categorical metric downstream inherits that.
 *
 * Costs three aggregations of one observed series — small beside the per-member
 * gridding already being done.
 */
export function aggregationImpact(
  observed: TimeSeries,
  obsRp: RpThresholds,
  stepMs: number,
  chosen: Aggregation,
): AggregationImpact | null {
  if (observed.time.length === 0) return null;

  const ways: Aggregation[] = ['mean', 'median', 'max'];
  const peak = {} as Record<Aggregation, number>;
  const eventRp = {} as Record<Aggregation, number>;
  const exceedances = {} as Record<Aggregation, number>;

  const lowest = lowestThreshold(obsRp);
  for (const how of ways) {
    const g = aggregateSeries(observed, stepMs, how);
    let mx = Number.NEGATIVE_INFINITY;
    let over = 0;
    for (const v of g.values) {
      if (!Number.isFinite(v)) continue;
      if (v > mx) mx = v;
      if (lowest != null && v >= lowest) over += 1;
    }
    peak[how] = Number.isFinite(mx) ? mx : Number.NaN;
    exceedances[how] = over;
    eventRp[how] = determineEventReturnPeriod(g, obsRp);
  }

  const rps = ways.map((w) => eventRp[w]);
  return {
    chosen,
    peak,
    eventRp,
    exceedances,
    changesEventRp: new Set(rps).size > 1,
  };
}

function lowestThreshold(rp: RpThresholds): number | null {
  let best: number | null = null;
  for (const k of Object.keys(rp)) {
    const v = rp[Number(k)];
    if (Number.isFinite(v) && (best == null || v < best)) best = v;
  }
  return best;
}
