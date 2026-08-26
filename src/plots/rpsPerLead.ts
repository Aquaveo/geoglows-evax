import type { Data, Layout } from 'plotly.js-dist-min';
import type { RpsResult } from '../lib/metrics/rps';
import { maxOf, minOf } from '../lib/arrayStats';

const FORECAST = '#2a78d6';
const CLIM = '#898781';
const SKILL = '#1baf7a';
const NOSKILL = '#e34948';
const GRID = '#e1e0d9';

export interface RpsPerLeadOptions {
  title?: string;
  subtitle?: string;
}

/**
 * RPS against its climatological reference, with the resulting RPSS below.
 *
 * The two panels rather than one axis, deliberately. RPS and RPSS run in
 * opposite directions — low RPS is good, high RPSS is good — and live on
 * different scales, so overlaying them is the dual-axis mistake: it invites the
 * reader to compare positions that have no common meaning.
 *
 * What DOES share an axis is RPS and the climatological RPS, because they are
 * the same quantity computed two ways. The vertical gap between those curves is
 * the skill, and RPSS below is that gap expressed as a fraction. Reading the two
 * panels together shows both how hard the period was and how much of that
 * difficulty the forecast overcame.
 *
 * Raw RPS falls toward zero as quiet timesteps are added, since it is a mean
 * over timesteps; the climatological curve falls with it, which is why RPSS is
 * the one to compare across events.
 */
export function rpsPerLeadFigure(
  r: RpsResult,
  opts: RpsPerLeadOptions = {},
): { data: Data[]; layout: Partial<Layout> } {
  const nul = (xs: number[]) => xs.map((v) => (Number.isFinite(v) ? v : null));

  const data: Data[] = [
    {
      type: 'scatter',
      mode: 'lines+markers',
      x: r.leads,
      y: nul(r.rpsClim),
      name: 'Climatology RPS',
      line: { color: CLIM, width: 2, dash: 'dash' },
      marker: { size: 6, color: CLIM },
      xaxis: 'x',
      yaxis: 'y',
      customdata: r.n.map((n) => [n] as [number]),
      hovertemplate: 'lead %{x}<br>climatology RPS %{y:.4f}<br>%{customdata[0]} steps<extra></extra>',
      connectgaps: false,
    },
    {
      type: 'scatter',
      mode: 'lines+markers',
      x: r.leads,
      y: nul(r.rps),
      name: 'Forecast RPS',
      line: { color: FORECAST, width: 2.4 },
      marker: { size: 7, color: FORECAST, line: { color: '#fcfcfb', width: 1.4 } },
      // Fills to the trace above — the climatology curve — so the shaded gap is
      // literally the skill the lower panel reports.
      fill: 'tonexty',
      fillcolor: 'rgba(42,120,214,0.10)',
      xaxis: 'x',
      yaxis: 'y',
      customdata: r.rpss.map((s, i) => [r.n[i], s] as [number, number]),
      hovertemplate:
        'lead %{x}<br>forecast RPS %{y:.4f}' +
        '<br>RPSS %{customdata[1]:.3f}<br>%{customdata[0]} steps<extra></extra>',
      connectgaps: false,
    },
    {
      type: 'bar',
      x: r.leads,
      y: nul(r.rpss),
      name: 'RPSS',
      marker: {
        color: r.rpss.map((v) => (Number.isFinite(v) && v >= 0 ? SKILL : NOSKILL)),
        line: { color: '#fcfcfb', width: 1 },
      },
      xaxis: 'x2',
      yaxis: 'y2',
      showlegend: false,
      customdata: r.n.map((n) => [n] as [number]),
      hovertemplate: 'lead %{x}<br>RPSS %{y:.3f}<br>%{customdata[0]} steps<extra></extra>',
    },
  ];

  const skillVals = r.rpss.filter(Number.isFinite);
  const lo = Math.min(0, minOf(skillVals, 0));
  const hi = Math.max(0.2, maxOf(skillVals, 0.2));

  const unscored = r.skipped.filter(Boolean).length;
  // A lead whose RPS scored but whose RPSS is undefined is a different outcome
  // from an unscored lead, and it needs saying: otherwise the RPSS panel just
  // has a gap and the reader assumes a bug rather than a reference that was
  // never contested.
  const noRef = (r.rpssSkipped ?? []).filter(Boolean).length;
  const refReason = (r.rpssSkipped ?? []).find(Boolean) ?? null;
  const note =
    (unscored > 0 ? `  |  ${unscored} lead${unscored === 1 ? '' : 's'} unscored` : '') +
    (noRef > 0 ? `  |  RPSS undefined at ${noRef} lead${noRef === 1 ? '' : 's'}` : '');

  const annotations: NonNullable<Layout['annotations']> = [];
  if (noRef > 0 && refReason) {
    annotations.push({
      xref: 'paper',
      yref: 'y2 domain',
      x: 0.5,
      y: 0.5,
      text: `RPSS not shown — ${refReason}`,
      showarrow: false,
      xanchor: 'center',
      font: { size: 11, color: '#8a6d1f' },
      bgcolor: 'rgba(253,246,227,0.92)',
      bordercolor: '#e6d9ae',
      borderwidth: 1,
      borderpad: 5,
    });
  }

  const layout: Partial<Layout> = {
    annotations,
    title: {
      text:
        `${opts.title ?? 'Ranked probability score by lead day'}` +
        `<br><sup>${opts.subtitle ?? ''}${note}</sup>`,
      x: 0.5,
    },
    margin: { l: 70, r: 24, t: 66, b: 54 },
    grid: { rows: 2, columns: 1, pattern: 'independent', roworder: 'top to bottom' },
    xaxis: { domain: [0, 1], anchor: 'y', tickmode: 'linear', tick0: 0, dtick: 1, gridcolor: GRID, showticklabels: false },
    yaxis: {
      domain: [0.46, 1],
      anchor: 'x',
      title: { text: 'RPS — lower is better' },
      gridcolor: GRID,
      rangemode: 'tozero',
    },
    xaxis2: {
      domain: [0, 1],
      anchor: 'y2',
      title: { text: 'Lead Day' },
      tickmode: 'linear',
      tick0: 0,
      dtick: 1,
      gridcolor: GRID,
    },
    yaxis2: {
      domain: [0, 0.34],
      anchor: 'x2',
      title: { text: 'RPSS' },
      range: [lo - 0.05, hi + 0.05],
      gridcolor: GRID,
      zeroline: true,
      zerolinecolor: '#52514e',
      zerolinewidth: 1.5,
    },
    height: 520,
    legend: { orientation: 'h', y: -0.1 },
    hovermode: 'x unified',
    bargap: 0.3,
    plot_bgcolor: '#fcfcfb',
    paper_bgcolor: '#fcfcfb',
  };

  return { data, layout };
}
