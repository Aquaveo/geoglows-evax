import type { Data, Layout } from 'plotly.js-dist-min';
import type { CrpsPerLead } from '../lib/metrics/crps';

export interface CrpssFigureOptions {
  riverId?: number;
  /** Calendar half-width in days used to sample the climatology. */
  windowDays?: number;
}

/**
 * CRPS skill score per lead day: 1 − CRPS_forecast / CRPS_climatology.
 *
 * 1 is a perfect forecast, 0 means the ensemble did no better than the
 * climatological distribution for this time of year, and negative means it did
 * worse. The zero line is the one that matters — it is the point where the
 * forecast stops being worth more than the long-term record.
 */
export function crpssPerLeadFigure(
  r: CrpsPerLead,
  opts: CrpssFigureOptions = {},
): { data: Data[]; layout: Partial<Layout> } {
  const leads = r.leads;
  const finite = r.crpss.filter((v) => Number.isFinite(v));
  // Floor of the "worse than climatology" shading; the axis itself autoranges.
  const yMin = finite.length > 0 ? Math.min(0, ...finite) : 0;

  const xLo = leads.length > 0 ? Math.min(...leads) - 0.5 : -0.5;
  const xHi = leads.length > 0 ? Math.max(...leads) + 0.5 : 15.5;

  const data: Data[] = [
    // Shade "worse than climatology" so the sign is readable at a glance.
    {
      type: 'scatter',
      mode: 'lines',
      x: [xLo, xHi, xHi, xLo, xLo],
      y: [0, 0, yMin, yMin, 0],
      fill: 'toself',
      fillcolor: 'rgba(214, 39, 40, 0.07)',
      line: { width: 0 },
      hoverinfo: 'skip',
      name: 'Worse than climatology',
    },
    {
      type: 'scatter',
      mode: 'lines+markers',
      x: leads,
      y: r.crpss,
      name: 'CRPSS',
      line: { color: '#1f77b4', width: 2 },
      marker: { size: 6, color: '#1f77b4' },
      hovertemplate: '<b>Lead %{x}</b><br>CRPSS: %{y:.3f}<extra></extra>',
    },
    {
      type: 'scatter',
      mode: 'lines',
      x: [xLo, xHi],
      y: [0, 0],
      line: { color: '#d62728', width: 1.5, dash: 'dash' },
      name: 'CRPSS = 0 (climatology)',
      hoverinfo: 'skip',
    },
    {
      type: 'scatter',
      mode: 'lines',
      x: [xLo, xHi],
      y: [1, 1],
      line: { color: 'green', width: 1.5, dash: 'dot' },
      name: 'CRPSS = 1 (perfect)',
      hoverinfo: 'skip',
    },
  ];

  const seasonNote =
    opts.windowDays != null
      ? `Climatology = retrospective values within ±${opts.windowDays} days of the event's time of year`
      : 'Climatology sampled from the retrospective record';
  const counted = r.nTimesteps.filter((n) => n > 0);
  const pairNote =
    counted.length === 0
      ? ''
      : Math.min(...counted) === Math.max(...counted)
        ? `  |  ${counted[0]} pairs per lead`
        : `  |  ${Math.min(...counted)}–${Math.max(...counted)} pairs per lead`;
  const title =
    `CRPS Skill Score per Lead Day${opts.riverId != null ? `  |  River ${opts.riverId}` : ''}` +
    `<br><sup>1 − CRPS/CRPS_clim  |  ${seasonNote}${pairNote}</sup>`;

  const layout: Partial<Layout> = {
    title: { text: title, x: 0.5 },
    margin: { l: 60, r: 20, t: 70, b: 60 },
    xaxis: {
      title: { text: 'Lead Day' },
      tickmode: 'linear',
      tick0: 0,
      dtick: 1,
      range: [xLo, xHi],
    },
    yaxis: { title: { text: 'CRPSS' }, gridcolor: '#eee', zeroline: false },
    height: 460,
    legend: { orientation: 'h', y: -0.2 },
    plot_bgcolor: 'white',
    paper_bgcolor: 'white',
  };

  return { data, layout };
}
