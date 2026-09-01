import type { Data, Layout } from 'plotly.js-dist-min';
import type { CrpsPerLead } from '../lib/metrics/crps';

export interface CrpsFigureOptions {
  title?: string;
  subtitle?: string;
  riverId?: number;
}

/**
 * Notebook's CRPS-per-lead figure (cell 164): three lines — MAE component,
 * Spread, CRPS — with the region between MAE and CRPS shaded to visualize
 * the spread "discount" (CRPS = MAE − Spread).
 */
export function crpsPerLeadFigure(
  r: CrpsPerLead,
  opts: CrpsFigureOptions = {},
): { data: Data[]; layout: Partial<Layout> } {
  const leadsAll = r.leads;
  const idx: number[] = [];
  for (let i = 0; i < leadsAll.length; i++) {
    if (Number.isFinite(r.crps[i])) idx.push(i);
  }
  const leads = idx.map((i) => leadsAll[i]);
  const crps = idx.map((i) => r.crps[i]);
  const mae = idx.map((i) => r.mae[i]);
  const spread = idx.map((i) => r.spread[i]);

  const data: Data[] = [];

  // Shaded region: spread contribution = area between CRPS and MAE lines.
  if (leads.length > 0) {
    data.push({
      type: 'scatter',
      x: [...leads, ...leads.slice().reverse()],
      y: [...crps, ...mae.slice().reverse()],
      fill: 'toself',
      fillcolor: 'rgba(44, 160, 44, 0.12)',
      line: { width: 0 },
      name: 'Spread contribution (shaded)',
      hoverinfo: 'skip',
      showlegend: true,
    });
  }

  data.push({
    type: 'scatter',
    mode: 'lines+markers',
    x: leads,
    y: mae,
    line: { color: '#d62728', width: 2, dash: 'dot' },
    marker: { size: 7, color: '#d62728' },
    name: 'MAE component  E|X − obs|',
    hovertemplate: '<b>Lead %{x}</b><br>MAE component: %{y:.2f} m³/s<extra></extra>',
  });

  data.push({
    type: 'scatter',
    mode: 'lines+markers',
    x: leads,
    y: spread,
    line: { color: '#2ca02c', width: 2, dash: 'dot' },
    marker: { size: 7, color: '#2ca02c' },
    name: "Spread  ½·E|X − X'|",
    hovertemplate: '<b>Lead %{x}</b><br>Spread: %{y:.2f} m³/s<extra></extra>',
  });

  data.push({
    type: 'scatter',
    mode: 'lines+markers',
    x: leads,
    y: crps,
    line: { color: '#1f77b4', width: 3 },
    marker: { size: 8, color: '#1f77b4' },
    name: 'CRPS  (MAE − Spread)',
    hovertemplate: '<b>Lead %{x}</b><br>CRPS: %{y:.2f} m³/s<extra></extra>',
  });

  const title =
    opts.title ??
    `CRPS and Components per Lead Day${opts.riverId != null ? ` — River ${opts.riverId}` : ''}`;
  const subtitle =
    opts.subtitle ??
    'Gneiting & Raftery (2007) / Hersbach (2000)  |  51 ensemble members  |  CRPS = MAE component − Spread';
  // Sample size travels with the score: the same CRPS from 4 pairs and from 40
  // are not equally trustworthy.
  const counted = r.nTimesteps.filter((n) => n > 0);
  const pairNote =
    counted.length === 0
      ? ''
      : Math.min(...counted) === Math.max(...counted)
        ? `  |  ${counted[0]} pairs per lead`
        : `  |  ${Math.min(...counted)}–${Math.max(...counted)} pairs per lead`;
  const titleText = `${title}<br><sup>${subtitle}${pairNote}</sup>`;

  const layout: Partial<Layout> = {
    title: { text: titleText, x: 0.5 },
    margin: { l: 60, r: 20, t: 70, b: 60 },
    xaxis: {
      title: { text: 'Lead Day' },
      tickmode: 'linear',
      tick0: 0,
      dtick: 1,
      range: [-0.5, 15.5],
    },
    yaxis: {
      title: { text: 'CRPS (m³/s)' },
      gridcolor: '#eee',
      rangemode: 'tozero',
      zeroline: true,
      zerolinecolor: '#888',
      zerolinewidth: 1,
    },
    height: 500,
    legend: { orientation: 'h', y: -0.2 },
    plot_bgcolor: 'white',
    paper_bgcolor: 'white',
  };

  return { data, layout };
}
