import type { Data, Layout } from 'plotly.js-dist-min'
import type { TimeSeries } from '../lib/types'

/**
 * Design tokens carried over verbatim from the reference matplotlib figure, so
 * the in-app plot and the user's own script are visually the same chart.
 */
const SURFACE = '#fcfcfb'
const INK = '#0b0b0b'
const INK_MUTED = '#52514e'
const GRID = '#e5e4e0'
const ORIGINAL = '#2a78d6'
const CORRECTED = '#eb6834'
/** Band opacity from the reference figure's `alpha=0.13`. */
const BAND_ALPHA = 0.13
const DAY_MS = 24 * 3600 * 1000

/** One forecast run reduced to a median and an uncertainty envelope. */
export interface SummaryBand {
  time: Date[]
  /** Ensemble median — `flow_median` in the reference script. */
  median: number[]
  /** Lower envelope, conventionally the 20th percentile. */
  lower: number[]
  /** Upper envelope, conventionally the 80th percentile. */
  upper: number[]
}

export interface BiasSummaryOptions {
  /** Run label for the title, e.g. "2024-10-29". */
  label: string
  riverId?: number
  /** Percentile range the band spans, for the subtitle. */
  bandLabel?: string
  /**
   * Observations to overlay. Absent from the reference figure, but this is a
   * verification tool: without them the plot shows that correction changed the
   * forecast, not whether it changed it in the right direction.
   */
  observed?: TimeSeries | null
}

const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

/** plotly renders null as a gap; non-finite values must not become 0. */
const clean = (xs: number[]) => xs.map((v) => (Number.isFinite(v) ? v : null))

/** Last index with a finite value, for the direct end label. */
function lastFinite(xs: number[]): number {
  for (let i = xs.length - 1; i >= 0; i--) if (Number.isFinite(xs[i])) return i
  return -1
}

/**
 * Original vs bias-corrected forecast: median lines over shaded uncertainty
 * bands, with the series named at its own right-hand end rather than only in a
 * legend.
 *
 * Direct labels are the reason this reads at a glance — the eye does not have to
 * travel to a legend and back to learn which line is which. The colour carries
 * identity in the dot; the text stays in ink so two labels never compete on
 * saturation.
 */
export function biasSummaryHydrographFigure(
  original: SummaryBand,
  corrected: SummaryBand,
  opts: BiasSummaryOptions,
): { data: Data[]; layout: Partial<Layout> } {
  const data: Data[] = []

  // Bands first so they paint behind every line. Each is two traces: an
  // invisible lower edge, then an upper edge filling down to it. They must stay
  // adjacent in this array — `tonexty` fills to the immediately preceding trace.
  for (const [band, color, name] of [
    [original, ORIGINAL, 'Original'],
    [corrected, CORRECTED, 'Bias corrected'],
  ] as const) {
    data.push(
      {
        type: 'scatter',
        mode: 'lines',
        x: band.time,
        y: clean(band.lower),
        line: { width: 0, color },
        showlegend: false,
        hoverinfo: 'skip',
      },
      {
        type: 'scatter',
        mode: 'lines',
        x: band.time,
        y: clean(band.upper),
        line: { width: 0, color },
        fill: 'tonexty',
        fillcolor: rgba(color, BAND_ALPHA),
        showlegend: false,
        hoverinfo: 'skip',
        name: `${name} range`,
      },
    )
  }

  if (opts.observed && opts.observed.time.length > 0) {
    data.push({
      type: 'scatter',
      mode: 'lines',
      x: opts.observed.time,
      y: clean(opts.observed.values),
      name: 'Observed',
      line: { color: INK, width: 1.75 },
      hovertemplate: '%{x|%Y-%m-%d %H:%M}<br>observed %{y:.2f} m³/s<extra></extra>',
    })
  }

  for (const [band, color, name] of [
    [original, ORIGINAL, 'Original'],
    [corrected, CORRECTED, 'Bias corrected'],
  ] as const) {
    data.push({
      type: 'scatter',
      mode: 'lines',
      x: band.time,
      y: clean(band.median),
      name,
      line: { color, width: 2 },
      hovertemplate: `%{x|%Y-%m-%d %H:%M}<br>${name.toLowerCase()} %{y:.2f} m³/s<extra></extra>`,
    })
  }

  // Direct end labels: a coloured dot plus ink text just past the last point.
  const annotations: NonNullable<Layout['annotations']> = []
  for (const [band, color, name] of [
    [original, ORIGINAL, 'Original'],
    [corrected, CORRECTED, 'Bias corrected'],
  ] as const) {
    const i = lastFinite(band.median)
    if (i < 0) continue
    data.push({
      type: 'scatter',
      mode: 'markers',
      x: [band.time[i]],
      y: [band.median[i]],
      marker: { size: 9, color, line: { color: SURFACE, width: 2 } },
      showlegend: false,
      hoverinfo: 'skip',
    })
    annotations.push({
      // ISO string, not a Date: plotly's annotation x is typed string | number
      // and a date axis parses the string.
      x: band.time[i].toISOString(),
      y: band.median[i],
      xref: 'x',
      yref: 'y',
      text: `${name}  ${band.median[i].toLocaleString(undefined, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })}`,
      showarrow: false,
      xanchor: 'left',
      yanchor: 'middle',
      xshift: 12,
      font: { size: 11, color: INK },
    })
  }

  // Room on the right for those labels, mirroring the reference figure's
  // `xlim(..., last + 14 * spacing)`.
  const times = original.time.length > 0 ? original.time : corrected.time
  // Plotly's axis range takes date *strings*, not Date objects.
  let xRange: [string, string] | undefined
  if (times.length >= 2) {
    const last = times[times.length - 1].getTime()
    const spacing = last - times[times.length - 2].getTime()
    xRange = [times[0].toISOString(), new Date(last + spacing * 14).toISOString()]
  }

  const river = opts.riverId != null ? `, river ${opts.riverId}` : ''
  const band = opts.bandLabel ?? '20–80%'

  const layout: Partial<Layout> = {
    title: {
      text:
        `Forecast discharge — ${opts.label}${river}` +
        `<br><sup style="color:${INK_MUTED}">Ensemble median, shaded ${band} range</sup>`,
      x: 0,
      xanchor: 'left',
      font: { size: 15, color: INK },
    },
    margin: { l: 62, r: 150, t: 74, b: 64 },
    xaxis: {
      tickformat: '%b %d',
      dtick: 2 * DAY_MS,
      showgrid: false,
      showline: true,
      linecolor: GRID,
      ticks: '',
      tickfont: { size: 10, color: INK_MUTED },
      range: xRange,
    },
    yaxis: {
      title: { text: 'Discharge (m³/s)', font: { size: 10, color: INK_MUTED } },
      gridcolor: GRID,
      gridwidth: 1,
      showline: true,
      linecolor: GRID,
      zeroline: false,
      ticks: '',
      tickfont: { size: 10, color: INK_MUTED },
    },
    annotations,
    legend: { orientation: 'h', y: -0.16, x: 0, font: { size: 10, color: INK } },
    plot_bgcolor: SURFACE,
    paper_bgcolor: SURFACE,
    hovermode: 'x unified',
  }

  return { data, layout }
}

/** Median and a percentile envelope across ensemble members at each timestep. */
export function summaryFromMembers(
  time: Date[],
  members: number[][],
  loPct = 20,
  hiPct = 80,
): SummaryBand {
  const n = time.length
  const median = new Array<number>(n)
  const lower = new Array<number>(n)
  const upper = new Array<number>(n)
  for (let t = 0; t < n; t++) {
    const col: number[] = []
    for (const m of members) {
      const v = m?.[t]
      if (Number.isFinite(v)) col.push(v)
    }
    if (col.length === 0) {
      median[t] = NaN
      lower[t] = NaN
      upper[t] = NaN
      continue
    }
    col.sort((a, b) => a - b)
    median[t] = quantile(col, 50)
    lower[t] = quantile(col, loPct)
    upper[t] = quantile(col, hiPct)
  }
  return { time, median, lower, upper }
}

/** Linear-interpolated percentile of an already-sorted array. */
function quantile(sorted: number[], pct: number): number {
  if (sorted.length === 1) return sorted[0]
  const h = ((sorted.length - 1) * pct) / 100
  const lo = Math.floor(h)
  const hi = Math.ceil(h)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo])
}
