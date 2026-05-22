import type { Data, Layout } from 'plotly.js-dist-min';
import type { ForecastResult } from '../data/rfs';
import type { RpThresholds } from '../lib/types';
import { rpBandShapes } from './helpers';

/**
 * Per-init forecast plot. Mirrors pygeoglows _plots/plotly_forecasts.py
 * (`forecast_stats`):
 *   - filled min/max band
 *   - filled p25/p75 band
 *   - mean line
 *   - median line
 *   - RP color bands behind everything
 *
 * Stats are computed from the 51 members by the riverforecastsystem package.
 */
export function forecastFigure(
  f: ForecastResult,
  rp: RpThresholds,
  initDate: string,
): { data: Data[]; layout: Partial<Layout> } {
  const x = f.time;
  const xRev = [...x].reverse();

  const data: Data[] = [
    {
      type: 'scatter',
      name: 'Maximum / Minimum',
      x: [...x, ...xRev],
      y: [...f.stats.max, ...[...f.stats.min].reverse()],
      fill: 'toself',
      fillcolor: 'rgba(31, 119, 180, 0.15)',
      line: { color: 'rgba(31, 119, 180, 0)' },
      hoverinfo: 'skip',
      showlegend: true,
    },
    {
      type: 'scatter',
      name: '25–75 percentile',
      x: [...x, ...xRev],
      y: [...f.stats.p75, ...[...f.stats.p25].reverse()],
      fill: 'toself',
      fillcolor: 'rgba(31, 119, 180, 0.35)',
      line: { color: 'rgba(31, 119, 180, 0)' },
      hoverinfo: 'skip',
      showlegend: true,
    },
    {
      type: 'scatter',
      mode: 'lines',
      name: 'Mean',
      x,
      y: f.stats.average,
      line: { color: '#1f77b4', width: 2 },
    },
    {
      type: 'scatter',
      mode: 'lines',
      name: 'Median',
      x,
      y: f.stats.median,
      line: { color: '#d62728', width: 2, dash: 'dash' },
    },
  ];

  const yCeiling = Math.max(...f.stats.max.filter(Number.isFinite));

  const layout: Partial<Layout> = {
    title: { text: `Forecast — init ${initDate}` },
    margin: { l: 60, r: 20, t: 40, b: 40 },
    xaxis: { title: { text: 'Date (UTC)' } },
    yaxis: { title: { text: 'Streamflow (m³/s)' }, rangemode: 'tozero' },
    shapes: rpBandShapes(rp, x[0], x[x.length - 1], yCeiling),
    legend: { orientation: 'h', y: -0.15 },
  };
  return { data, layout };
}
