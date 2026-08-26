import type { ForecastRun, TimeSeries } from '../types'
import { BiasCorrectionError, buildMonthlyCdf, flowToProbability, probabilityToFlow } from './quantileMap'
import type { MonthlyCdf } from './quantileMap'

/** Re-exported for callers that only import from this module. */
export type { ForecastRun }

/** The pair of CDFs that define one month's mapping. */
export interface MonthlyMapping {
  /** 1-12, UTC. */
  month: number
  simulated: MonthlyCdf
  observed: MonthlyCdf
}

export interface CorrectedRun {
  /** Ascending — the reference ends with `sort_index()`. */
  time: Date[]
  /** [member][timestep], with `clip(lower=0)` applied. */
  discharge: number[][]
  month: number
  /** Values that came out +Infinity. These survive the clip. */
  positiveInfinite: number
  /**
   * Finite raw values whose mapping was NaN, so the RAW value was retained.
   * This is not a failure — it is what `pandas.DataFrame.update` does — but it
   * means those cells are uncorrected and must be reported, not hidden.
   */
  nanKeptRaw: number
  /**
   * Finite positive raw values that came out of the mapping at exactly 0.
   *
   * Purely diagnostic — nothing about the arithmetic changes, which stays
   * bit-faithful to geoglows 2.2.0. It exists because the alternative outcome
   * for the same input is invisible otherwise.
   *
   * Below the simulated monthly minimum the mapping extrapolates off the bottom
   * of the observed CDF, and which of two very different things happens is
   * decided by whether the observed month has anything in its lowest bin:
   *
   *   empty  -> observed cdf[0] === cdf[1], so the inverse slope is x/0 = inf,
   *             and inf * 0 = NaN. update() then keeps the RAW value.
   *   filled -> the slope is finite, the value maps at or below 0, and clip(0)
   *             makes it 0. The raw low flow is gone.
   *
   * So a single value in the observed record flips every sub-minimum timestep
   * between "kept raw" and "zeroed" — and parseCsv manufactures exactly such a
   * value by clamping negative gauge readings to 0. The reference behaves the
   * same way, so this is reported rather than corrected.
   */
  zeroedBelowRange: number
  /**
   * Finite raw values at or above the top of the simulated distribution.
   *
   * There the CDF is flat, so the forward map has zero slope and EVERY such
   * forecast collapses onto the same probability, then onto the same corrected
   * flow. Measured on a realistic June pair: forecasts of 178, 324, 810, 3239
   * and 161,950 m³/s all mapped to 277.09. That is not a correction, it is a
   * ceiling.
   *
   * Detected directly rather than inferred from an infinite result. The infinity
   * only appears when the probability lands strictly ABOVE the observed CDF's
   * top, which turns on whether two cumulative sums of several hundred floats
   * both finished at exactly 1.0: at p = 1 the value is finite and the run is
   * kept, one ulp higher it is Infinity and the run is excluded. The intent was
   * always to exclude above-range runs, so this tests that condition instead of
   * a rounding artefact of it.
   */
  aboveSimRange: number;
  /** Values clipped up to 0 (negative results, including -Infinity). */
  negativeClipped: number
  /** Raw inputs that were already non-finite before correction ran. */
  rawNonFinite: number
}

/**
 * Calendar month (1-12, UTC) that the reference builds its mapping from:
 * the first timestamp for `useMonth = 0`, the last for `-1`.
 *
 * UTC deliberately. A local-time read silently picks the wrong month for every
 * run initialized at 00:00Z anywhere west of UTC.
 */
export function monthForRun(time: readonly Date[], useMonth: 0 | -1 = 0): number {
  if (time.length === 0) throw new BiasCorrectionError('forecast has no timesteps')
  const t = useMonth === 0 ? time[0] : time[time.length - 1]
  return t.getUTCMonth() + 1
}

/** Finite values of a series falling in one calendar month (UTC). */
export function monthlyValues(s: TimeSeries, month: number): number[] {
  const out: number[] = []
  for (let i = 0; i < s.time.length; i++) {
    const v = s.values[i]
    if (Number.isFinite(v) && s.time[i].getUTCMonth() + 1 === month) out.push(v)
  }
  return out
}

export function buildMonthlyMapping(
  month: number,
  simulated: TimeSeries,
  observed: TimeSeries,
): MonthlyMapping {
  const sim = monthlyValues(simulated, month)
  const obs = monthlyValues(observed, month)
  if (sim.length === 0) {
    throw new BiasCorrectionError(`no simulated data for month ${month}`)
  }
  if (obs.length === 0) {
    throw new BiasCorrectionError(`no observed data for month ${month}`)
  }
  return { month, simulated: buildMonthlyCdf(sim), observed: buildMonthlyCdf(obs) }
}

/** Raw mapped value, before the `update` rule and before clipping. */
export function mapValue(m: MonthlyMapping, v: number): number {
  return probabilityToFlow(m.observed, flowToProbability(m.simulated, v))
}

/**
 * Port of `geoglows.bias.correct_forecast` for one run.
 *
 * Two reference behaviours are load-bearing and easy to get wrong:
 *
 * 1. Each column is `dropna()`'d before mapping, so a raw NaN is never mapped
 *    and stays NaN.
 * 2. `DataFrame.update` does not overwrite where the incoming value is NaN.
 *    So when the mapping returns NaN, the RAW value is retained — an
 *    uncorrected number sitting in corrected output. `Infinity` is not NA and
 *    IS written. Getting this wrong yields plausible-looking numbers, which is
 *    why it has its own fixture.
 *
 * Finally the whole frame is clipped at 0 and sorted by time.
 */
export function correctForecastRun(
  run: ForecastRun,
  mapping: MonthlyMapping,
): CorrectedRun {
  const nT = run.time.length
  let positiveInfinite = 0
  let nanKeptRaw = 0
  let negativeClipped = 0
  let rawNonFinite = 0
  let zeroedBelowRange = 0
  let aboveSimRange = 0
  const simTop = mapping.simulated.cdf[mapping.simulated.cdf.length - 1]

  const corrected: number[][] = run.discharge.map((series) => {
    const out = new Array<number>(nT)
    for (let i = 0; i < nT; i++) {
      const raw = series?.[i] ?? NaN

      // (1) dropna(): a raw NaN is never mapped.
      if (!Number.isFinite(raw)) {
        rawNonFinite += 1
        out[i] = raw
        continue
      }

      // One forward evaluation, reused for the range test and the mapping, so
      // the arithmetic is bit-identical to mapValue.
      const p = flowToProbability(mapping.simulated, raw)
      if (p >= simTop) aboveSimRange += 1
      const mapped = probabilityToFlow(mapping.observed, p)

      // (2) update(): NaN does not overwrite, so the raw value survives.
      let value: number
      if (Number.isNaN(mapped)) {
        nanKeptRaw += 1
        value = raw
      } else {
        value = mapped
      }

      // clip(lower=0) — catches retained negatives and -Infinity; +Infinity stays.
      if (value < 0) {
        negativeClipped += 1
        value = 0
      }
      if (value === Infinity) positiveInfinite += 1
      // Diagnostic only, after the clip so it counts the published value: a
      // positive flow that the correction turned into nothing.
      if (value === 0 && raw > 0) zeroedBelowRange += 1

      out[i] = value
    }
    return out
  })

  // sort_index()
  const order = run.time.map((_, i) => i).sort((a, b) => run.time[a].getTime() - run.time[b].getTime())
  const isSorted = order.every((v, i) => v === i)

  return {
    time: isSorted ? run.time.slice() : order.map((i) => run.time[i]),
    discharge: isSorted ? corrected : corrected.map((s) => order.map((i) => s[i])),
    month: mapping.month,
    positiveInfinite,
    nanKeptRaw,
    zeroedBelowRange,
    aboveSimRange,
    negativeClipped,
    rawNonFinite,
  }
}

/** Full-signature convenience mirroring `correct_forecast`, used by the fixtures. */
export function correctForecastLike(
  run: ForecastRun,
  simulated: TimeSeries,
  observed: TimeSeries,
  useMonth: 0 | -1 = 0,
): CorrectedRun {
  const month = monthForRun(run.time, useMonth)
  return correctForecastRun(run, buildMonthlyMapping(month, simulated, observed))
}
