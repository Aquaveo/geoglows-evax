import type { TimeSeries } from '../types';
import { aggregateSeries, type Aggregation } from '../ingest/grid';
import { buildClimatology, type ClimatologySample } from './crps';
import { seasonalClimatology } from './rps';

/** Calendar half-width, in days, of the season both references are restricted to. */
export const CLIMATOLOGY_WINDOW_DAYS = 15;

/**
 * The climatological references for RPSS and CRPSS, built side by side.
 *
 * A skill score means nothing without saying what it was compared against, so
 * the two references in this app have to be defensible together. `season.ts`
 * already extracted the part they share — the ±15-day calendar filter and the
 * 30-value minimum — after the two had drifted apart once. This module finishes
 * that job by owning the other half, the aggregation, which had drifted in
 * exactly the same way: the RPS reference followed the comparison grid while the
 * CRPS reference floored itself at daily.
 *
 * The rule both now follow: **a reference is aggregated to the same grid, with
 * the same bin summary, as the observations it will be scored against.** Anything
 * else compares a forecast against a baseline that was asked an easier or harder
 * question.
 *
 * That rule makes the two references DIFFER, which is the part worth stating
 * plainly, because it looks like an inconsistency and is not:
 *
 *   - RPS categorises the chosen-summary grid, so its reference uses the user's
 *     bin summary — median by default.
 *   - CRPS is an error magnitude scored on the bin-MEAN grid, so its reference
 *     uses the mean.
 *
 * Same grid step, same season, same minimum; different summary, because the
 * scored observations differ. Forcing one summary on both would break the rule
 * for whichever metric lost.
 */

/**
 * RPSS reference: climatological probability per return-period category.
 *
 * Null when there is no record or too little of it falls in season — withheld
 * rather than estimated, since the alternative is a baseline built from the very
 * event being scored.
 */
export function categoricalReference(
  historical: TimeSeries | null,
  scoredObs: TimeSeries,
  stepMs: number,
  summary: Aggregation,
  obsThresholds: number[],
): { climatology: number[]; n: number } | null {
  if (!historical) return null;
  return seasonalClimatology(
    aggregateSeries(historical, stepMs, summary),
    scoredObs,
    obsThresholds,
    CLIMATOLOGY_WINDOW_DAYS,
  );
}

/**
 * CRPSS reference: climatological distribution of discharge.
 *
 * `stepMs` is the comparison grid, NOT floored at a day. It used to be
 * `max(stepMs, DAY_MS)`, which on a sub-daily grid built the reference from daily
 * means while CRPS itself was scored on sub-daily means. A daily-mean sample is
 * narrower than a sub-daily one — measured p05–p95 of 20.8 against 34.7 on a
 * 20-year hourly record — and a narrower reference scores worse against an
 * unusual observation, so the ratio inflated CRPSS. Measured inflation was
 * +0.088 at an observation just above the climatological median and +0.0003 far
 * out in the tail: it flattered the score most exactly where the verdict is
 * marginal.
 *
 * Removing the floor is safe for a record COARSER than the grid, which was the
 * only case it could have been protecting. Aggregating a daily record onto a
 * 3-hourly grid is a no-op — one value per populated bin, empty bins dropped —
 * and the resulting sample is bit-identical to the floored one, verified in
 * `tests/lib/references.test.ts`.
 */
export function continuousReference(
  historical: TimeSeries | null,
  scoredObs: TimeSeries,
  stepMs: number,
): ClimatologySample | null {
  if (!historical) return null;
  return buildClimatology(
    aggregateSeries(historical, stepMs, 'mean'),
    scoredObs,
    CLIMATOLOGY_WINDOW_DAYS,
  );
}
