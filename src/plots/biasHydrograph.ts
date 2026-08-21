import type { Data, Layout } from 'plotly.js-dist-min'
import type { ForecastRun, TimeSeries } from '../lib/types'

export interface BiasHydrographOptions {
  /** Run key, for the title. */
  label: string
  /** Ensemble statistic name shown in the subtitle. */
  statLabel?: string
  riverId?: number
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

  const data: Data[] = [
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
  ]

  const unchangedNote =
    compared > 0 && unchanged > 0
      ? `  |  ${unchanged} of ${compared} timesteps unchanged (mapping undefined there)`
      : ''

  const layout: Partial<Layout> = {
    title: {
      text:
        `Raw vs bias-corrected — run ${opts.label}` +
        `${opts.riverId != null ? `  |  River ${opts.riverId}` : ''}` +
        `<br><sup>${opts.statLabel ?? 'ensemble median'}${unchangedNote}</sup>`,
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
