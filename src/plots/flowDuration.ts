import type { Data, Layout } from 'plotly.js-dist-min';
import type { FdcPoint, MonthBias } from '../lib/metrics/retrospectiveEval';

const SIM = '#2a78d6';
const OBS = '#0b0b0b';
const GRID = '#e1e0d9';

/**
 * Flow duration curves for simulated and observed on one log axis.
 *
 * The standard hydrological read of *where* a model fails. Aggregate metrics
 * cannot separate a whole-range offset from a tail-only problem; two curves can.
 * Parallel curves are a constant bias; curves that converge at one end and
 * diverge at the other mean the error depends on flow magnitude, which is the
 * case a single correction factor cannot handle.
 *
 * Exceedance is log-scaled because the interesting part — floods — lives in the
 * leftmost 1% and a linear axis compresses it to nothing.
 */
export function flowDurationFigure(
  sim: FdcPoint[],
  obs: FdcPoint[],
  opts: { title?: string; subtitle?: string } = {},
): { data: Data[]; layout: Partial<Layout> } {
  const data: Data[] = [
    {
      type: 'scatter',
      mode: 'lines',
      x: obs.map((p) => p.exceedance * 100),
      y: obs.map((p) => p.value),
      name: 'Observed',
      line: { color: OBS, width: 2.2 },
      hovertemplate: 'exceeded %{x:.2f}% of days<br>observed %{y:.1f} m³/s<extra></extra>',
    },
    {
      type: 'scatter',
      mode: 'lines',
      x: sim.map((p) => p.exceedance * 100),
      y: sim.map((p) => p.value),
      name: 'Simulated (retrospective)',
      line: { color: SIM, width: 2.2 },
      hovertemplate: 'exceeded %{x:.2f}% of days<br>simulated %{y:.1f} m³/s<extra></extra>',
    },
  ];

  const layout: Partial<Layout> = {
    title: {
      text: `${opts.title ?? 'Flow duration curves'}<br><sup>${opts.subtitle ?? ''}</sup>`,
      x: 0.5,
    },
    margin: { l: 70, r: 24, t: 64, b: 60 },
    xaxis: {
      title: { text: 'Percent of days the value is exceeded' },
      type: 'log',
      gridcolor: GRID,
      autorange: 'reversed',
    },
    yaxis: { title: { text: 'Discharge (m³/s)' }, type: 'log', gridcolor: GRID },
    legend: { orientation: 'h', y: -0.2 },
    hovermode: 'x unified',
    plot_bgcolor: '#fcfcfb',
    paper_bgcolor: '#fcfcfb',
  };
  return { data, layout };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Simulated/observed mean ratio by calendar month, as diverging bars about 1.
 *
 * Directly relevant to the bias correction the app applies, which is monthly: a
 * ratio that holds steady across the year can be fixed by one factor, a ratio
 * that swings needs the monthly treatment, and a ratio crossing 1 cannot be
 * fixed multiplicatively at all.
 */
export function monthlyBiasFigure(
  rows: MonthBias[],
  opts: { title?: string; subtitle?: string } = {},
): { data: Data[]; layout: Partial<Layout> } {
  const labels = rows.map((r) => MONTHS[r.month - 1]);
  // Plotted as a deviation from 1 so the zero line is parity, not zero flow.
  const dev = rows.map((r) => r.ratio - 1);
  const data: Data[] = [
    {
      type: 'bar',
      x: labels,
      y: dev,
      marker: {
        color: dev.map((d) => (d < 0 ? SIM : '#eb6834')),
        line: { color: '#fcfcfb', width: 1 },
      },
      customdata: rows.map((r) => [r.ratio, r.meanSim, r.meanObs, r.n] as [number, number, number, number]),
      hovertemplate:
        '<b>%{x}</b><br>ratio %{customdata[0]:.3f}' +
        '<br>simulated %{customdata[1]:.1f} vs observed %{customdata[2]:.1f} m³/s' +
        '<br>%{customdata[3]} days<extra></extra>',
      showlegend: false,
      text: rows.map((r) => r.ratio.toFixed(2)),
      textposition: 'outside',
      textfont: { size: 10, color: '#898781' },
      cliponaxis: false,
    },
  ];

  const span = Math.max(0.15, ...dev.map((d) => Math.abs(d))) * 1.25;
  const layout: Partial<Layout> = {
    title: {
      text: `${opts.title ?? 'Monthly bias'}<br><sup>${opts.subtitle ?? ''}</sup>`,
      x: 0.5,
    },
    margin: { l: 70, r: 24, t: 64, b: 52 },
    xaxis: { title: { text: 'Calendar month' }, tickfont: { color: '#0b0b0b' } },
    yaxis: {
      title: { text: 'Simulated / observed − 1' },
      range: [-span, span],
      zeroline: true,
      zerolinecolor: '#52514e',
      zerolinewidth: 2,
      gridcolor: GRID,
      tickformat: '+.0%',
    },
    bargap: 0.25,
    plot_bgcolor: '#fcfcfb',
    paper_bgcolor: '#fcfcfb',
  };
  return { data, layout };
}
