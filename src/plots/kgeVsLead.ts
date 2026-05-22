import type { Data, Layout } from 'plotly.js-dist-min';

export interface PerLeadDistribution {
  leads: number[];
  median: number[];
  p25: number[];
  p75: number[];
  min: number[];
  max: number[];
}

/**
 * KGE distribution across the 51 ensemble members vs. lead day.
 * Mirrors the notebook's `mcc_distribution_stats` / `add_band` pattern.
 */
export function kgeVsLeadFigure(d: PerLeadDistribution): { data: Data[]; layout: Partial<Layout> } {
  const x = d.leads;
  const xRev = [...x].reverse();

  const data: Data[] = [
    {
      type: 'scatter',
      name: 'Min / Max',
      x: [...x, ...xRev],
      y: [...d.max, ...[...d.min].reverse()],
      fill: 'toself',
      fillcolor: 'rgba(31, 119, 180, 0.18)',
      line: { color: 'rgba(31, 119, 180, 0)' },
      hoverinfo: 'skip',
    },
    {
      type: 'scatter',
      name: 'IQR (25–75)',
      x: [...x, ...xRev],
      y: [...d.p75, ...[...d.p25].reverse()],
      fill: 'toself',
      fillcolor: 'rgba(31, 119, 180, 0.40)',
      line: { color: 'rgba(31, 119, 180, 0)' },
      hoverinfo: 'skip',
    },
    {
      type: 'scatter',
      mode: 'lines+markers',
      name: 'Median KGE',
      x,
      y: d.median,
      line: { color: '#1f77b4', width: 2 },
      marker: { size: 6 },
      hovertemplate: 'Lead %{x}<br>KGE = %{y:.4f}<extra></extra>',
    },
  ];

  const layout: Partial<Layout> = {
    title: { text: "KGE distribution across 51 members vs. lead day" },
    margin: { l: 60, r: 20, t: 40, b: 40 },
    xaxis: { title: { text: 'Lead day' }, dtick: 1 },
    yaxis: { title: { text: "KGE" } },
    legend: { orientation: 'h', y: -0.2 },
  };
  return { data, layout };
}
