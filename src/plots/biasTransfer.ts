import type { Data, Layout } from 'plotly.js-dist-min'
import type { MonthlyMapping } from '../lib/bias/correctForecast'
import { mapValue } from '../lib/bias/correctForecast'
import { maxOf } from '../lib/arrayStats'

export interface BiasTransferOptions {
  /** Actual forecast values, drawn as a rug so you can see which part is used. */
  forecastValues?: number[]
  riverId?: number
  samples?: number
}

/**
 * The correction's transfer curve: simulated flow in, corrected flow out.
 *
 * Two curves are drawn deliberately. "Mapped" is the raw quantile map, which has
 * gaps where the inverse is undefined — the flat head and tail of the observed
 * CDF. "Applied" is what the app actually does, which falls back to the raw value
 * in those gaps (the reference implementation's behaviour). Where Applied sits on
 * the 1:1 line, the correction is a no-op; where the curve runs off the top, the
 * mapping returned infinity and the whole run is excluded.
 *
 * This is the plot that makes the method's limits visible instead of described.
 */
export function biasTransferFigure(
  mapping: MonthlyMapping,
  opts: BiasTransferOptions = {},
): { data: Data[]; layout: Partial<Layout> } {
  const samples = opts.samples ?? 400
  const simEdges = mapping.simulated.binEdges
  // NOT Math.max(...forecastValues): that is every ensemble member at every
  // timestep -- 281,520 numbers for a 46-run event -- and spreading it throws
  // RangeError: Maximum call stack size exceeded.
  const xMax = Math.max(
    simEdges[simEdges.length - 1],
    maxOf(opts.forecastValues ?? [], 0),
  )

  const xs: number[] = []
  const mapped: (number | null)[] = []
  const applied: number[] = []
  let firstInfiniteAt: number | null = null
  let noOpUpTo: number | null = null

  for (let i = 0; i <= samples; i++) {
    const x = (xMax * i) / samples
    const raw = mapValue(mapping, x)
    xs.push(x)

    // Plotly breaks a line on null, which is exactly what an undefined mapping is.
    mapped.push(Number.isFinite(raw) ? raw : null)

    // What the app applies: NaN keeps the raw value, then clip at zero.
    let eff = Number.isNaN(raw) ? x : raw
    if (eff < 0) eff = 0
    applied.push(eff)

    if (raw === Infinity && firstInfiniteAt == null) firstInfiniteAt = x
    if (Number.isNaN(raw)) noOpUpTo = x
  }

  const finiteApplied = applied.filter((v) => Number.isFinite(v))
  const yMax = Math.max(xMax, ...(finiteApplied.length ? finiteApplied : [xMax]))

  const data: Data[] = [
    {
      type: 'scatter',
      mode: 'lines',
      x: [0, Math.max(xMax, yMax)],
      y: [0, Math.max(xMax, yMax)],
      name: 'No change (1:1)',
      line: { color: '#94a3b8', width: 1.5, dash: 'dash' },
      hoverinfo: 'skip',
    },
    {
      type: 'scatter',
      mode: 'lines',
      x: xs,
      y: applied,
      name: 'Applied',
      line: { color: '#1f77b4', width: 3 },
      hovertemplate: 'simulated %{x:.2f} → corrected %{y:.2f} m³/s<extra></extra>',
    },
    {
      type: 'scatter',
      mode: 'lines',
      x: xs,
      y: mapped,
      name: 'Quantile map (gaps = undefined)',
      line: { color: '#d62728', width: 1.5, dash: 'dot' },
      connectgaps: false,
      hoverinfo: 'skip',
    },
  ]

  if (opts.forecastValues && opts.forecastValues.length > 0) {
    const vals = opts.forecastValues.filter(Number.isFinite)
    data.push({
      type: 'scatter',
      mode: 'markers',
      x: vals,
      y: vals.map(() => 0),
      name: `Your forecast values (${vals.length})`,
      marker: { symbol: 'line-ns-open', size: 9, color: 'rgba(17,17,17,0.35)' },
      hovertemplate: 'forecast %{x:.2f} m³/s<extra></extra>',
    })
  }

  const notes: string[] = []
  if (noOpUpTo != null) {
    notes.push(`below ~${noOpUpTo.toFixed(1)} m³/s the mapping is undefined and raw values are kept`)
  }
  if (firstInfiniteAt != null) {
    notes.push(`above ~${firstInfiniteAt.toFixed(1)} m³/s it returns infinity and the run is excluded`)
  }

  const layout: Partial<Layout> = {
    title: {
      text:
        `Bias-correction transfer curve — month ${mapping.month}` +
        `${opts.riverId != null ? `  |  River ${opts.riverId}` : ''}` +
        (notes.length ? `<br><sup>${notes.join('; ')}</sup>` : ''),
      x: 0.5,
    },
    margin: { l: 65, r: 20, t: 60, b: 55 },
    xaxis: { title: { text: 'Simulated (RFS) discharge, m³/s' }, rangemode: 'tozero' },
    yaxis: { title: { text: 'Corrected discharge, m³/s' }, rangemode: 'tozero' },
    legend: { orientation: 'h', y: -0.2 },
    hovermode: 'closest',
    plot_bgcolor: 'white',
    paper_bgcolor: 'white',
  }

  return { data, layout }
}

/** The two empirical CDFs the mapping is composed from. */
export function biasCdfsFigure(
  mapping: MonthlyMapping,
  opts: { riverId?: number } = {},
): { data: Data[]; layout: Partial<Layout> } {
  const flat = (c: { cdf: number[] }) => {
    let n = 0
    for (let i = 1; i < c.cdf.length; i++) if (c.cdf[i] === c.cdf[i - 1]) n++
    return n
  }

  const data: Data[] = [
    {
      type: 'scatter',
      mode: 'lines',
      // hv: the CDF is a step function, and drawing it as one shows the flat
      // regions that make the inverse undefined.
      line: { shape: 'hv', color: '#1f77b4', width: 2 },
      x: mapping.simulated.binEdges,
      y: mapping.simulated.cdf,
      name: `Simulated / RFS (n=${mapping.simulated.n})`,
      hovertemplate: '%{x:.2f} m³/s → p=%{y:.4f}<extra>simulated</extra>',
    },
    {
      type: 'scatter',
      mode: 'lines',
      line: { shape: 'hv', color: '#111', width: 2 },
      x: mapping.observed.binEdges,
      y: mapping.observed.cdf,
      name: `Observed (n=${mapping.observed.n})`,
      hovertemplate: '%{x:.2f} m³/s → p=%{y:.4f}<extra>observed</extra>',
    },
  ]

  const layout: Partial<Layout> = {
    title: {
      text:
        `Monthly distributions being matched — month ${mapping.month}` +
        `${opts.riverId != null ? `  |  River ${opts.riverId}` : ''}` +
        `<br><sup>correction reads a probability off the blue curve and a flow off the black one` +
        `  |  flat segments: ${flat(mapping.simulated)} simulated, ${flat(mapping.observed)} observed</sup>`,
      x: 0.5,
    },
    margin: { l: 60, r: 20, t: 60, b: 55 },
    xaxis: { title: { text: 'Discharge, m³/s' }, rangemode: 'tozero' },
    yaxis: { title: { text: 'Cumulative probability' }, range: [0, 1.02] },
    legend: { orientation: 'h', y: -0.2 },
    plot_bgcolor: 'white',
    paper_bgcolor: 'white',
  }

  return { data, layout }
}
