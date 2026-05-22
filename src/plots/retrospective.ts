import type { Data, Layout } from 'plotly.js-dist-min';
import type { TimeSeries } from '../lib/types';

/**
 * Retrospective daily discharge plot. Mirrors pygeoglows
 * _plots/plotly_retrospective.py at a basic level — single line, RP bands
 * deferred to v2.
 */
export function retrospectiveFigure(s: TimeSeries): { data: Data[]; layout: Partial<Layout> } {
  const data: Data[] = [
    {
      type: 'scatter',
      mode: 'lines',
      name: 'Retrospective discharge',
      x: s.time,
      y: s.values,
      line: { color: '#1f77b4', width: 1 },
      hovertemplate: '%{x|%Y-%m-%d}<br>%{y:.2f} m³/s<extra></extra>',
    },
  ];
  const layout: Partial<Layout> = {
    title: { text: 'Retrospective Daily Discharge' },
    margin: { l: 60, r: 20, t: 40, b: 40 },
    xaxis: { title: { text: 'Date' } },
    yaxis: { title: { text: 'Streamflow (m³/s)' }, rangemode: 'tozero' },
    showlegend: false,
  };
  return { data, layout };
}
