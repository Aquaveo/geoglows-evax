import type { Data, Layout } from 'plotly.js-dist-min'
import type { MonthlyMapping } from '../lib/bias/correctForecast'

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
