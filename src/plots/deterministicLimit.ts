import type { Data, Layout } from 'plotly.js-dist-min';

export interface DeterministicLimitInput {
  /** Ordered lead days, e.g. 0..15. */
  leads: number[];
  /** Diagonal sum of the contingency matrix at each lead. */
  hits: number[];
  /** Off-diagonal sum (under + over) at each lead. */
  misses: number[];
  /** Last lead where hits > misses; -1 if never reached. */
  detLimit: number;
  /** Display label for the selected forecast series, e.g. "Ensemble median". */
  seriesLabel: string;
  /** Optional river id for the title. */
  riverId?: number;
}

/**
 * Notebook's "Contingency Matrix — Deterministic Limit" plot (cell 108):
 *   green Hits line, red "Misses + False Alarms" line, vertical dashed
 *   line at the deterministic limit with an annotation.
 *
 * Deterministic limit follows Hewson (2007): the last lead day where
 * hits > misses + false alarms.
 */
export function deterministicLimitFigure(
  inp: DeterministicLimitInput,
): { data: Data[]; layout: Partial<Layout> } {
  const { leads, hits, misses, detLimit, seriesLabel, riverId } = inp;

  const data: Data[] = [
    {
      type: 'scatter',
      mode: 'lines+markers',
      x: leads,
      y: hits,
      name: 'Hits',
      line: { color: 'green', width: 2 },
      marker: { size: 6, color: 'green' },
      hovertemplate: '<b>Lead %{x}</b><br>Hits: %{y}<extra></extra>',
    },
    {
      type: 'scatter',
      mode: 'lines+markers',
      x: leads,
      y: misses,
      name: 'Misses + False Alarms',
      line: { color: 'red', width: 2 },
      marker: { size: 6, color: 'red' },
      hovertemplate: '<b>Lead %{x}</b><br>Misses + False Alarms: %{y}<extra></extra>',
    },
  ];

  const baseTitle = `Deterministic Limit — ${seriesLabel}${
    riverId != null ? `  |  River ${riverId}` : ''
  }`;
  const detLimitText =
    detLimit >= 0
      ? `Vertical line = deterministic limit (${detLimit} day${detLimit === 1 ? '' : 's'})`
      : 'Hits never exceed misses — no deterministic limit reached';
  const titleText = `${baseTitle}<br><sup>${detLimitText}</sup>`;

  const xMin = leads.length > 0 ? Math.min(...leads) - 0.5 : -0.5;
  const xMax = leads.length > 0 ? Math.max(...leads) + 0.5 : 15.5;

  const layout: Partial<Layout> = {
    title: { text: titleText, x: 0.5 },
    margin: { l: 60, r: 20, t: 60, b: 50 },
    xaxis: {
      title: { text: 'Lead Day' },
      tickmode: 'linear',
      tick0: 0,
      dtick: 1,
      range: [xMin, xMax],
    },
    yaxis: {
      title: { text: 'Timestep count' },
      gridcolor: '#eee',
      rangemode: 'tozero',
    },
    height: 460,
    legend: { orientation: 'h', y: -0.18 },
    plot_bgcolor: 'white',
    paper_bgcolor: 'white',
    shapes:
      detLimit >= 0
        ? [
            {
              type: 'line',
              x0: detLimit,
              x1: detLimit,
              y0: 0,
              y1: 1,
              xref: 'x',
              yref: 'paper',
              line: { color: 'gray', dash: 'dash', width: 1.5 },
            },
          ]
        : [],
    annotations:
      detLimit >= 0
        ? [
            {
              x: detLimit,
              y: 1,
              xref: 'x',
              yref: 'paper',
              text: `DL = ${detLimit} d`,
              showarrow: false,
              xanchor: 'left',
              yanchor: 'top',
              xshift: 4,
              font: { color: 'gray', size: 12 },
            },
          ]
        : [],
  };

  return { data, layout };
}
