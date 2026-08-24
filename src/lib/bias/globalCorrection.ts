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

  for (const [date, run] of forecasts) {
    const discharge = run.discharge.map((series) => {
      const r = transformSeries(run.time, series, fits);
      n += r.diagnostics.n;
      clippedToQmax += r.diagnostics.clippedToQmax;
      atCeiling += r.diagnostics.atCeiling;
      atFloor += r.diagnostics.atFloor;
      negativeClamped += r.diagnostics.negativeClamped;
      for (const m of r.diagnostics.months) {
        months.add(m);
        saturation[m] = r.diagnostics.saturation[m];
      }
      return r.values;
    });
    out.set(date, { time: run.time, discharge });
  }

  const monthList = [...months].sort((a, b) => a - b);

  // Saturated everywhere means every forecast collapsed onto one number per
  // month, so the corrected series carries no information about magnitude at
  // all. Reporting a metric from that would be reporting a constant.
  const saturatedShare = n > 0 ? (atCeiling + atFloor) / n : 0;
  const unusable =
    n === 0
      ? 'no forecast values to transform'
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
    saturation,
    noExclusions: true,
    unusable,
  };
}
