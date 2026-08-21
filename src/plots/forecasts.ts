import type { Data, Layout } from 'plotly.js-dist-min';
import type { ForecastResult } from '../data/rfs';
import type { RpThresholds } from '../lib/types';
import { rpBandTraces } from './helpers';

/**
 * Per-date forecast plot. Mirrors pygeoglows _plots/plotly_forecasts.py
 * (`forecast_stats`):
 *   - filled min/max band
 *   - filled p25/p75 band
 *   - mean line
 *   - median line
 *   - RP color bands behind everything
 *
 * Stats are computed from the 51 members by the riverforecastsystem package.
 *
 * The RP bands are traces rather than layout shapes so that hiding a series
 * from the legend actually rescales the y-axis — plotly.js counts
 * data-coordinate shapes in autorange, so a band sized from the min/max
 * envelope would hold the axis at that envelope's peak even once hidden.
 */
export function forecastFigure(
  f: ForecastResult,
  simRp: RpThresholds,
  startDate: string,
): { data: Data[]; layout: Partial<Layout> } {
  const x = f.time;
  const xRev = [...x].reverse();

  // Bands first so they paint behind the envelope.
  const data: Data[] = rpBandTraces(
    [{ label: 'simulated', rp: simRp }],
    x[0],
    x[x.length - 1],
  );

  data.push(
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
  );

  const layout: Partial<Layout> = {
    title: { text: `Forecast — start ${startDate}` },
    margin: { l: 60, r: 20, t: 40, b: 40 },
    xaxis: { title: { text: 'Date (UTC)' } },
    yaxis: { title: { text: 'Streamflow (m³/s)' }, rangemode: 'tozero' },
    legend: { orientation: 'h', y: -0.15 },
  };
  return { data, layout };
}
