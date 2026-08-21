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
  /** Member-timesteps clipped up to zero. */
  negativeClipped: number
  /** Non-null when nothing usable came out; render this instead of numbers. */
  unavailable: string | null
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
    negativeClipped: 0,
    unavailable: null,
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
        monthDiags.set(month, {
          month,
          nSimulated: m.simulated.n,
          nObserved: m.observed.n,
          ok: true,
          degenerateRange: m.simulated.degenerateRange || m.observed.degenerateRange,
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
    nanKeptRaw += res.nanKeptRaw
    negativeClipped += res.negativeClipped

    if (res.positiveInfinite > 0) {
      excluded.push({
        date,
        reason:
          `${res.positiveInfinite} value${res.positiveInfinite === 1 ? '' : 's'} mapped to ` +
          `infinity (forecast above the simulated month-${month} maximum)`,
      })
      continue
    }

    corrected.set(date, { time: res.time, discharge: res.discharge })
  }

  const months = [...monthDiags.values()].sort((a, b) => a.month - b.month)
  const unavailable =
    corrected.size === 0
      ? excluded.length > 0
        ? `all ${excluded.length} run${excluded.length === 1 ? '' : 's'} excluded — see reasons`
        : 'no runs could be corrected'
      : null

  const usedMappings = new Map<number, MonthlyMapping>()
  for (const [m, v] of mappings) if (v) usedMappings.set(m, v)

  return {
    ...base,
    forecasts: corrected,
    mappings: usedMappings,
    excluded,
    months,
    nanKeptRaw,
    negativeClipped,
    unavailable,
  }
}
