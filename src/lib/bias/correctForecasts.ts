import { maxOf } from '../arrayStats'
import type { ForecastRun, TimeSeries } from '../types'
import { detectCadence } from '../ingest/cadence'
import { aggregateSeries } from '../ingest/grid'
import { BiasCorrectionError } from './quantileMap'
import { buildMonthlyMapping, correctForecastRun, monthForRun } from './correctForecast'
import type { MonthlyMapping } from './correctForecast'

const DAY_MS = 24 * 3600 * 1000

export interface RunExclusion {
  /** Run key, YYYYMMDD. */
  date: string
  reason: string
}

export interface MonthDiagnostic {
  month: number
  nSimulated: number
  nObserved: number
  ok: boolean
  /** The reference's max == min branch fired: the mapping collapses. */
  degenerateRange: boolean
  /** Largest share of the simulated month falling in a single histogram bin. */
  simMaxBinShare: number
  /** Same for the observed month. */
  obsMaxBinShare: number
  /**
   * True when both distributions pile into one bin. Sturges' rule fixes the bin
   * COUNT and the width comes from the range, so a right-skewed record — normal
   * for streamflow — puts almost everything in the first bin. The mapping then
   * has no resolution where the data actually is and collapses to a single
   * linear scale factor rather than matching distributions.
   */
  lowResolution: boolean
  reason?: string
}

export interface BiasCorrection {
  /** Runs that survived the exclusion policy. Feed straight to reorganizeByLead. */
  forecasts: Map<string, ForecastRun>
  /**
   * The mapping actually used, per calendar month. Exposed so the diagnostic
   * plots draw the real transfer curve rather than rebuilding it and risking
   * drift from what was applied.
   */
  mappings: Map<number, MonthlyMapping>
  excluded: RunExclusion[]
  months: MonthDiagnostic[]
  /** Cadence the CDFs were built at. */
  cdfStepMs: number
  simulatedCadence: string
  observedCadence: string
  /** Member-timesteps that kept their RAW value because the mapping was NaN. */
  nanKeptRaw: number
  /**
   * Values at or above the simulated month's maximum, where the CDF is flat.
   *
   * Reported, never excluded. Every such forecast collapses onto the same
   * corrected flow regardless of how far above it sits, so those numbers are
   * real output that does not carry magnitude information. The runs that land
   * here are the ones that forecast the event.
   */
  aboveSimRange: number
  /** Of those, the ones whose inverse came back +Infinity rather than a ceiling. */
  positiveInfinite: number
  /** Positive raw values the mapping turned into exactly 0. Diagnostic only. */
  zeroedBelowRange: number
  /** Member-timesteps clipped up to zero. */
  negativeClipped: number
  /** Non-null when nothing usable came out; render this instead of numbers. */
  unavailable: string | null
  /**
   * Non-null when the surviving runs are a BIASED subset rather than a sample.
   *
   * Exclusion is triggered by forecasts exceeding the simulated monthly maximum,
   * which is exactly what the runs that predicted the event do. So exclusions
   * concentrate on the runs closest to the event, and what survives is
   * disproportionately the runs that missed it. Metrics computed on that subset
   * measure skill on the forecasts that failed, which is worse than useless
   * because it looks like a result. When this is set the corrected variant must
   * not be offered.
   */
  selectionBias: string | null
}

export interface CorrectForecastsOptions {
  /** Resolution the empirical CDFs are built at. The reference assumes daily. */
  cdfStepMs?: number
  useMonth?: 0 | -1
}

/**
 * Bias-correct every forecast run, then apply the exclusion policy.
 *
 * Correction runs on RAW forecast values, before lead-bucketing and before grid
 * aggregation, because quantile mapping is nonlinear — correcting a bin mean is
 * not the mean of corrected values.
 *
 * Exclusion is at RUN granularity, not timestep. `+Infinity` arises only for
 * forecast values above the simulated monthly maximum, i.e. the peaks, so
 * dropping just those timesteps would systematically delete the highest flows
 * and flatter every corrected score. Whole-run exclusion is also the granularity
 * skillByRun and peakByRun need, since they read this Map directly.
 *
 * `nanKeptRaw` and `negativeClipped` are reported but NOT excluded: they hit low
 * flows, so dropping runs for them would discard most runs in a dry month for no
 * gain. They must still be surfaced, because a NaN mapping means that cell holds
 * an uncorrected raw value.
 */
export function correctForecasts(
  forecasts: Map<string, ForecastRun>,
  simulated: TimeSeries,
  observed: TimeSeries,
  opts: CorrectForecastsOptions = {},
): BiasCorrection {
  const cdfStepMs = opts.cdfStepMs ?? DAY_MS
  const useMonth = opts.useMonth ?? 0

  const simCadence = detectCadence(simulated)
  const obsCadence = detectCadence(observed)

  const base: BiasCorrection = {
    forecasts: new Map(),
    mappings: new Map(),
    excluded: [],
    months: [],
    cdfStepMs,
    simulatedCadence: simCadence?.label ?? 'unknown',
    observedCadence: obsCadence?.label ?? 'unknown',
    nanKeptRaw: 0,
    aboveSimRange: 0,
    positiveInfinite: 0,
    zeroedBelowRange: 0,
    negativeClipped: 0,
    unavailable: null,
    selectionBias: null,
  }

  if (forecasts.size === 0) {
    return { ...base, unavailable: 'no forecasts downloaded' }
  }
  if (!obsCadence || observed.time.length === 0) {
    return { ...base, unavailable: 'no historical observations uploaded' }
  }
  if (!simCadence || simulated.time.length === 0) {
    return { ...base, unavailable: 'no retrospective loaded' }
  }
  // aggregateSeries only ever downsamples, so a coarser-than-daily record cannot
  // be brought onto the CDF grid. Refuse rather than mis-bin it silently.
  if (obsCadence.stepMs > cdfStepMs) {
    return {
      ...base,
      unavailable:
        `historical observations are ${obsCadence.label}; monthly quantile mapping ` +
        `needs daily or finer`,
    }
  }

  // Match both records to the CDF grid. Idempotent when already at that step.
  const simDaily = aggregateSeries(simulated, Math.max(cdfStepMs, simCadence.stepMs), 'mean')
  const obsDaily = aggregateSeries(observed, cdfStepMs, 'mean')

  const mappings = new Map<number, MonthlyMapping | null>()
  const monthDiags = new Map<number, MonthDiagnostic>()

  const corrected = new Map<string, ForecastRun>()
  const excluded: RunExclusion[] = []
  let nanKeptRaw = 0
  let aboveSimRange = 0
  let positiveInfinite = 0
  let zeroedBelowRange = 0
  let negativeClipped = 0

  for (const [date, run] of forecasts) {
    if (run.time.length === 0) {
      excluded.push({ date, reason: 'run has no timesteps' })
      continue
    }

    let month: number
    try {
      month = monthForRun(run.time, useMonth)
    } catch {
      excluded.push({ date, reason: 'run has no timesteps' })
      continue
    }

    // One mapping per calendar month, shared by every run in that month.
    if (!mappings.has(month)) {
      try {
        const m = buildMonthlyMapping(month, simDaily, obsDaily)
        mappings.set(month, m)
        const simShare = maxOf(m.simulated.counts)
        const obsShare = maxOf(m.observed.counts)
        monthDiags.set(month, {
          month,
          nSimulated: m.simulated.n,
          nObserved: m.observed.n,
          ok: true,
          degenerateRange: m.simulated.degenerateRange || m.observed.degenerateRange,
          simMaxBinShare: simShare,
          obsMaxBinShare: obsShare,
          lowResolution: simShare >= 0.5 && obsShare >= 0.5,
        })
      } catch (e) {
        const reason = e instanceof BiasCorrectionError ? e.message : String(e)
        mappings.set(month, null)
        monthDiags.set(month, {
          month,
          nSimulated: 0,
          nObserved: 0,
          ok: false,
          degenerateRange: false,
          simMaxBinShare: 0,
          obsMaxBinShare: 0,
          lowResolution: false,
          reason,
        })
      }
    }

    const mapping = mappings.get(month) ?? null
    if (!mapping) {
      excluded.push({ date, reason: monthDiags.get(month)?.reason ?? `no mapping for month ${month}` })
      continue
    }

    const res = correctForecastRun(run, mapping)
    // res.rawNonFinite is deliberately NOT accumulated; see its docblock in
    // correctForecast.ts. It counts NaN padding from the union-joined ensemble
    // as well as genuine gaps, so one total cannot distinguish them.
    nanKeptRaw += res.nanKeptRaw
    zeroedBelowRange += res.zeroedBelowRange
    negativeClipped += res.negativeClipped

    // NOT excluded, whatever the mapping returned.
    //
    // This app exists to evaluate the geoglows method, so anything it discards
    // that geoglows keeps means the metrics describe a different method. The
    // reference has no notion of a run at all — correct_forecast takes one frame
    // and returns one frame — so rejecting a run was never its behaviour to
    // begin with, in either the old form (any value came out +Infinity) or the
    // corrected form (any value at or above the simulated maximum).
    //
    // Above the simulated maximum the CDF is flat, so every such forecast
    // collapses onto one probability and then one flow: 178, 324, 810, 3239 and
    // 161,950 m³/s all map to 277.09. Whether the inverse is that ceiling or
    // +Infinity turns on last-bit agreement between two cumulative sums. Both
    // outcomes are what the reference produces, and both stay.
    //
    // Downstream they are safe: alignTimes drops a non-finite pair, so an
    // infinity removes that one timestep exactly as a gap would. A pinned finite
    // value is counted, which is the case worth reporting rather than removing —
    // it is a real number that the correction did not really produce.
    aboveSimRange += res.aboveSimRange
    positiveInfinite += res.positiveInfinite

    corrected.set(date, { time: res.time, discharge: res.discharge })
  }

  const months = [...monthDiags.values()].sort((a, b) => a.month - b.month)
  const unavailable =
    corrected.size === 0
      ? excluded.length > 0
        ? `all ${excluded.length} run${excluded.length === 1 ? '' : 's'} excluded — see reasons`
        : 'no runs could be corrected'
      : null

  // The selection-bias gate is gone with the exclusions it guarded.
  //
  // It existed because excluding above-range runs removed exactly the runs that
  // predicted the event, leaving a subset biased toward the ones that missed it.
  // Nothing is excluded for that reason now, so there is no such subset — and
  // inventing one to warn about would be the assumption this app is meant to
  // avoid making. What remains is `aboveSimRange`, reported in the banner: the
  // same information, without altering the data it describes.
  const selectionBias = null

  const usedMappings = new Map<number, MonthlyMapping>()
  for (const [m, v] of mappings) if (v) usedMappings.set(m, v)

  return {
    ...base,
    forecasts: corrected,
    mappings: usedMappings,
    excluded,
    months,
    nanKeptRaw,
    aboveSimRange,
    positiveInfinite,
    zeroedBelowRange,
    negativeClipped,
    unavailable,
    selectionBias,
  }
}
