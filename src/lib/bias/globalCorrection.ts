import type { ForecastRun } from '../types';
import type { RiverPolyfits } from './polyfitTypes';
import { transformSeries, type MonthSaturation } from './dischargeTransform';

/** What the global transform did across every run, so numbers are never bare. */
export interface GlobalCorrection {
  /** Every run, transformed. Nothing is excluded — see `noExclusions`. */
  forecasts: Map<string, ForecastRun>;
  /** Member-timesteps transformed. */
  n: number;
  /** Inputs above the month's fitted maximum, clipped before transforming. */
  clippedToQmax: number;
  /** Percentile clamped to 0 — mapped onto the month's maximum discharge. */
  atCeiling: number;
  /** Percentile clamped to 100 — mapped onto the month's minimum discharge. */
  atFloor: number;
  negativeClamped: number;
  /**
   * Calendar months the event covers whose published coefficients are unusable.
   *
   * A river can be in the store and still carry NaN coefficients for some
   * months. Those months are skipped rather than the whole river being rejected,
   * so a forecast that never touches one is corrected normally.
   */
  unusableMonths: number[];
  /** Values that fell in such a month, and so were not transformed. */
  skippedNoFit: number;
  /** Those values as a share of everything the event covers. */
  noFitShare: number;
  months: number[];
  saturation: Record<number, MonthSaturation>;
  /**
   * Always true, and stated explicitly because it is the whole reason this
   * variant exists: the transform needs no observed record, so no run can be
   * excluded for mapping to infinity and the surviving set cannot be biased
   * toward the runs that missed the event.
   */
  noExclusions: true;
  /** Non-null when the result should not be shown as a metric. */
  unusable: string | null;
}

/**
 * Apply the published per-river transform to every downloaded forecast run.
 *
 * Contrast with `correctForecasts`, which fits an empirical CDF to the user's
 * own gauge record and therefore inherits that record's sparsity. Here the
 * coefficients are fitted centrally, so a short or lopsided local history cannot
 * break the mapping — but the transform has a ceiling of its own, which is what
 * the saturation fields report.
 */
export function correctForecastsGlobal(
  forecasts: Map<string, ForecastRun>,
  fits: RiverPolyfits,
): GlobalCorrection {
  const out = new Map<string, ForecastRun>();
  const months = new Set<number>();
  const saturation: Record<number, MonthSaturation> = {};
  let n = 0;
  let clippedToQmax = 0;
  let atCeiling = 0;
  let atFloor = 0;
  let negativeClamped = 0;
  let skippedNoFit = 0;
  const unusableMonths = new Set<number>();

  for (const [date, run] of forecasts) {
    const discharge = run.discharge.map((series) => {
      const r = transformSeries(run.time, series, fits);
      n += r.diagnostics.n;
      clippedToQmax += r.diagnostics.clippedToQmax;
      atCeiling += r.diagnostics.atCeiling;
      atFloor += r.diagnostics.atFloor;
      negativeClamped += r.diagnostics.negativeClamped;
      skippedNoFit += r.diagnostics.skippedNoFit;
      for (const m of r.diagnostics.unusableMonths) unusableMonths.add(m);
      for (const m of r.diagnostics.months) {
        months.add(m);
        saturation[m] = r.diagnostics.saturation[m];
      }
      return r.values;
    });
    out.set(date, { time: run.time, discharge });
  }

  const monthList = [...months].sort((a, b) => a - b);
  const badMonthList = [...unusableMonths].sort((a, b) => a - b);

  // Saturated everywhere means every forecast collapsed onto one number per
  // month, so the corrected series carries no information about magnitude at
  // all. Reporting a metric from that would be reporting a constant.
  const saturatedShare = n > 0 ? (atCeiling + atFloor) / n : 0;
  // Values that fell in a month with no usable transform, as a share of every
  // value the event covers. Kept separate from `n`, which counts only values
  // that were actually transformed — conflating the two is what let an all-NaN
  // series report a saturation share of zero and pass as healthy.
  const total = n + skippedNoFit;
  const noFitShare = total > 0 ? skippedNoFit / total : 0;
  //
  // Any part of the event falling in a month with no transform withholds the
  // variant entirely, rather than serving a correction that covers only some of
  // it. `unusableMonths` is populated only when a timestep actually lands in
  // that month, so this is already scoped to the event rather than to the river.
  //
  // A partial correction is not merely incomplete, it is incomparable. The
  // metrics would be computed from the surviving months while raw is computed
  // from all of them, and the comparison table puts the two side by side as
  // though they measured the same thing. Worse, the gap is a contiguous block of
  // calendar time: lose the month holding the crest and the corrected scores
  // improve, because only the recession was scored. correctForecasts already
  // takes this position for its own exclusions — "a biased subset is worse than
  // no answer: it looks like a result" — and there is no reason for the two
  // corrections to disagree about it.
  //
  // No tolerance threshold, deliberately. Any missing stretch can be the one
  // that matters, and a share cannot tell you whether it was.
  const unusable =
    total === 0
      ? 'no forecast values to transform'
      : badMonthList.length > 0
        ? `no usable transform is published for ${
            badMonthList.length === 1 ? 'month' : 'months'
          } ${badMonthList.join(', ')}, which ${
            badMonthList.length === 1 ? 'covers' : 'cover'
          } ${(noFitShare * 100).toFixed(0)}% of this event. Correcting only the rest would be ` +
          'scored on a different stretch of the event than the raw forecast, so the two would not ' +
          'be comparable'
        : saturatedShare >= 0.995
        ? `${(saturatedShare * 100).toFixed(1)}% of forecast values hit the transform's clamp, ` +
          'so nearly every value maps onto the same number and the corrected series is effectively constant'
        : null;

  return {
    forecasts: out,
    n,
    clippedToQmax,
    atCeiling,
    atFloor,
    negativeClamped,
    months: monthList,
    unusableMonths: badMonthList,
    skippedNoFit,
    noFitShare,
    saturation,
    noExclusions: true,
    unusable,
  };
}
