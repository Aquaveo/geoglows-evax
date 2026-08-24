import type { Data, Layout } from 'plotly.js-dist-min'
import type { ForecastRun, RpThresholds, TimeSeries } from '../lib/types'
import { RP_LEVELS } from '../lib/types'
import { rpBandTraces, type RpBandGroup } from './helpers'

export interface BiasHydrographOptions {
  /** Run key, for the title. */
  label: string
  /** Ensemble statistic name shown in the subtitle. */
  statLabel?: string
  riverId?: number
  /**
   * Observed-side thresholds. These are the ones that apply to the observed
   * line AND to the corrected forecast, since correction maps onto the observed
   * distribution.
   */
  obsRp?: RpThresholds | null
  /** Simulated-side thresholds — the scale the RAW forecast lives on. */
  simRp?: RpThresholds | null
}

/** Smallest finite threshold in a set, or null. */
function lowestThreshold(rp: RpThresholds | null | undefined): number | null {
  if (!rp) return null
  for (const level of RP_LEVELS) {
    if (Number.isFinite(rp[level])) return rp[level]
  }
  return null
}

/** Per-timestep median across members, ignoring non-finite values. */
function memberMedian(run: ForecastRun): number[] {
  const nT = run.time.length
  const out = new Array<number>(nT)
  for (let i = 0; i < nT; i++) {
    const vals: number[] = []
    for (const series of run.discharge) {
      const v = series?.[i]
      if (Number.isFinite(v)) vals.push(v)
    }
    if (vals.length === 0) {
      out[i] = NaN
      continue
    }
    vals.sort((a, b) => a - b)
    const mid = vals.length / 2
    out[i] = vals.length % 2 === 1 ? vals[Math.floor(mid)] : (vals[mid - 1] + vals[mid]) / 2
  }
  return out
}

/**
 * One forecast run before and after correction, against the observations.
 *
 * The plainest possible view of what the correction did: if the corrected line
 * moves toward the black observed line, it helped; if it overshoots, the mapping
 * is over-inflating. Where raw and corrected coincide, the mapping was undefined
 * there and the raw value was kept.
 */
export function biasHydrographFigure(
  raw: ForecastRun,
  corrected: ForecastRun,
  observed: TimeSeries,
  opts: BiasHydrographOptions,
): { data: Data[]; layout: Partial<Layout> } {
  const rawMed = memberMedian(raw)
  const corMed = memberMedian(corrected)

  // Count timesteps the correction left alone — the undefined-mapping regions.
  const byTime = new Map<number, number>()
  corrected.time.forEach((t, i) => byTime.set(t.getTime(), corMed[i]))
  let unchanged = 0
  let compared = 0
  raw.time.forEach((t, i) => {
    const c = byTime.get(t.getTime())
    if (c == null || !Number.isFinite(c) || !Number.isFinite(rawMed[i])) return
    compared += 1
    if (c === rawMed[i]) unchanged += 1
  })

  // Peak of everything plotted, used to decide whether bands would swamp the axis.
  let plottedMax = 0
  for (const arr of [observed.values, rawMed, corMed]) {
    for (const v of arr) if (Number.isFinite(v) && v > plottedMax) plottedMax = v
  }

  // Return-period zones. Two sets, because the lines live on two different
  // scales: the observed and corrected lines against the OBSERVED thresholds,
  // the raw forecast against the SIMULATED ones.
  //
  // Each set starts hidden when its lowest threshold is far above everything
  // plotted — otherwise the axis stretches to the first band and squashes all
  // three lines into a sliver. The subtitle carries the number instead, so the
  // severity context is always legible even with the bands off.
  const SWAMP_RATIO = 1.5
  const bandGroups: RpBandGroup[] = []
  const obsLow = lowestThreshold(opts.obsRp)
  const simLow = lowestThreshold(opts.simRp)
  if (opts.obsRp && obsLow != null) {
    bandGroups.push({
      label: 'observed',
      rp: opts.obsRp,
      defaultVisible: obsLow <= plottedMax * SWAMP_RATIO,
    })
  }
  if (opts.simRp && simLow != null) {
    bandGroups.push({
      label: 'simulated',
      rp: opts.simRp,
      defaultVisible: false,
    })
  }

  let tMin = Number.POSITIVE_INFINITY
  let tMax = Number.NEGATIVE_INFINITY
  for (const times of [observed.time, raw.time, corrected.time]) {
    for (const t of times) {
      const ms = t.getTime()
      if (ms < tMin) tMin = ms
      if (ms > tMax) tMax = ms
    }
  }
  const span =
    Number.isFinite(tMin) && Number.isFinite(tMax)
      ? { lo: new Date(tMin), hi: new Date(tMax) }
      : null

  const data: Data[] = span && bandGroups.length > 0 ? rpBandTraces(bandGroups, span.lo, span.hi) : []

  data.push(
    {
      type: 'scatter',
      mode: 'lines',
      x: observed.time,
      y: observed.values,
      name: 'Observed',
      line: { color: '#111', width: 2.5 },
      hovertemplate: '%{x|%Y-%m-%d %H:%M}<br>observed %{y:.2f} m³/s<extra></extra>',
    },
    {
      type: 'scatter',
      mode: 'lines',
      x: raw.time,
      y: rawMed,
      name: 'Forecast — raw',
      line: { color: '#94a3b8', width: 2, dash: 'dash' },
      hovertemplate: '%{x|%Y-%m-%d %H:%M}<br>raw %{y:.2f} m³/s<extra></extra>',
    },
    {
      type: 'scatter',
      mode: 'lines',
      x: corrected.time,
      y: corMed,
      name: 'Forecast — bias-corrected',
      line: { color: '#1f77b4', width: 2.5 },
      hovertemplate: '%{x|%Y-%m-%d %H:%M}<br>corrected %{y:.2f} m³/s<extra></extra>',
    },
  )

  const unchangedNote =
    compared > 0 && unchanged > 0
      ? `  |  ${unchanged} of ${compared} timesteps unchanged (mapping undefined there)`
      : ''

  // Always state the severity context numerically, whether or not the bands are
  // drawn: "nowhere near a 2-year event" is the useful fact, and it survives the
  // bands being toggled off.
  const rpNote =
    obsLow != null && plottedMax > 0
      ? obsLow > plottedMax
        ? `  |  peak reaches ${((plottedMax / obsLow) * 100).toFixed(0)}% of the 2-year observed threshold (${obsLow.toFixed(1)} m³/s)`
        : `  |  peak exceeds the 2-year observed threshold (${obsLow.toFixed(1)} m³/s)`
      : ''

  const layout: Partial<Layout> = {
    title: {
      text:
        `Raw vs bias-corrected — run ${opts.label}` +
        `${opts.riverId != null ? `  |  River ${opts.riverId}` : ''}` +
        `<br><sup>${opts.statLabel ?? 'ensemble median'}${rpNote}${unchangedNote}</sup>`,
      x: 0.5,
    },
    margin: { l: 60, r: 20, t: 60, b: 50 },
    xaxis: { title: { text: 'Valid time (UTC)' } },
    yaxis: { title: { text: 'Discharge, m³/s' }, rangemode: 'tozero' },
    legend: { orientation: 'h', y: -0.2 },
    hovermode: 'x unified',
    plot_bgcolor: 'white',
    paper_bgcolor: 'white',
  }

  return { data, layout }
}
