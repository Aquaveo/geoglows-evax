import type { Data, Layout } from 'plotly.js-dist-min';
import type { ConditionalBin } from '../lib/metrics/retrospectiveEval';
import { maxOf } from '../lib/arrayStats';

export interface ConditionalBiasOptions {
  title?: string;
  subtitle?: string;
  /** Mean of all observations — the baseline resolution is measured against. */
  obsMean: number;
  slope?: number;
  xLabel?: string;
  yLabel?: string;
}

const ADDS = '#2a78d6';
const SUBS = '#e34948';
const GRID = '#e1e0d9';
const MUTED = '#898781';

/**
 * E[observed | simulated] against the 1:1 line — the conditional-bias curve.
 *
 * Where aggregate metrics give one number for the whole record, this shows where
 * in the flow range the model fails. Distance from the diagonal is calibration
 * error at that magnitude; the slope of the curve is whether the model's spread
 * is scaled correctly. A curve parallel to but above the diagonal is a constant
 * offset a single multiplier could fix; a curve that fans or bends is not.
 *
 * Marker area is proportional to bin count, because equal-count bins on a skewed
 * record still differ in how much flow range they span.
 */
export function conditionalBiasFigure(
  bins: ConditionalBin[],
  opts: ConditionalBiasOptions,
): { data: Data[]; layout: Partial<Layout> } {
  const hi = Math.max(
    maxOf(bins.map((b) => b.sim), 1),
    maxOf(bins.map((b) => b.obs), 1),
    opts.obsMean,
  ) * 1.05;
  const nMax = maxOf(bins.map((b) => b.n), 1);

  const data: Data[] = [
    {
      type: 'scatter',
      mode: 'lines',
      x: [0, hi],
      y: [0, hi],
      line: { color: '#52514e', width: 1.4, dash: 'dash' },
      name: '1:1 — perfect',
      hoverinfo: 'skip',
    },
    {
      type: 'scatter',
      mode: 'lines',
      x: [0, hi],
      y: [opts.obsMean, opts.obsMean],
      line: { color: MUTED, width: 1.1, dash: 'dot' },
      name: `mean observed (${opts.obsMean.toFixed(0)})`,
      hoverinfo: 'skip',
    },
    {
      type: 'scatter',
      mode: 'lines+markers',
      x: bins.map((b) => b.sim),
      y: bins.map((b) => b.obs),
      line: { color: ADDS, width: 2 },
      marker: {
        size: bins.map((b) => 6 + 12 * Math.sqrt(b.n / nMax)),
        color: ADDS,
        opacity: 0.8,
        line: { color: '#fcfcfb', width: 1.6 },
      },
      name: 'E[observed | simulated]',
      customdata: bins.map((b) => [b.n, b.obs - b.sim, b.lo, b.hi] as [number, number, number, number]),
      hovertemplate:
        'simulated %{x:.1f} m³/s<br>observed %{y:.1f} m³/s' +
        '<br>gap %{customdata[1]:+.1f}' +
        '<br>bin %{customdata[2]:.1f}–%{customdata[3]:.1f}, n=%{customdata[0]}<extra></extra>',
    },
  ];

  // A dropline per bin down to the 1:1 line, so the calibration gap is a mark
  // rather than something the eye has to measure against a diagonal.
  for (const b of bins) {
    data.push({
      type: 'scatter',
      mode: 'lines',
      x: [b.sim, b.sim],
      y: [b.sim, b.obs],
      line: { color: SUBS, width: 1 },
      opacity: 0.5,
      showlegend: false,
      hoverinfo: 'skip',
    });
  }

  const slopeNote =
    opts.slope != null && Number.isFinite(opts.slope)
      ? `  |  slope ${opts.slope.toFixed(2)}${
          Math.abs(opts.slope - 1) < 0.08
            ? ' (spread about right)'
            : opts.slope > 1
              ? ' (model compresses the range)'
              : ' (model exaggerates the range)'
        }`
      : '';

  const layout: Partial<Layout> = {
    title: {
      text: `${opts.title ?? 'Conditional bias'}<br><sup>${opts.subtitle ?? ''}${slopeNote}</sup>`,
      x: 0.5,
    },
    margin: { l: 70, r: 24, t: 64, b: 56 },
    xaxis: {
      title: { text: opts.xLabel ?? 'Simulated discharge (m³/s)' },
      gridcolor: GRID,
      zeroline: false,
      range: [0, hi],
    },
    yaxis: {
      title: { text: opts.yLabel ?? 'Observed discharge (m³/s)' },
      gridcolor: GRID,
      zeroline: false,
      range: [0, hi],
    },
    legend: { orientation: 'h', y: -0.16 },
    hovermode: 'closest',
    plot_bgcolor: '#fcfcfb',
    paper_bgcolor: '#fcfcfb',
  };

  return { data, layout };
}
