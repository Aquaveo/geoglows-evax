import type { Data, Layout } from 'plotly.js-dist-min';
import type { LeadMedianRow } from '../lib/floodCheck';
import type { RpThresholds } from '../lib/types';
import { RP_LINE_COLORS } from './helpers';

const INK = '#0b0b0b';
const MUTED = '#898781';
const GRID = '#e1e0d9';
const SURFACE = '#fcfcfb';

export interface LeadMedianLevelsOptions {
  subtitle?: string;
}

/**
 * The lead-time table as a chart: how many days of the flood the ensemble
 * median put above each level, against how far ahead the forecast was issued.
 *
 * Lines rather than a heatmap, deliberately. A heatmap of the same numbers is
 * the table again with colour instead of digits, and the tab already has two of
 * them. What the table cannot show is the SHAPE — where each level falls away,
 * whether it falls smoothly or collapses, and whether a level the model lost
 * mid-range came back. That is what a reader wants from this and it is only
 * visible as a curve.
 *
 * The series are nested by construction: a median above the 50-year is above
 * every level below it, so the 2-year line can never dip below the 5-year and
 * the family reads as contours rather than as six independent series that
 * happen to cross.
 *
 * Colour is the app's return-period ramp, so a level is the same colour here as
 * in every band on every other chart — sequential in effect, since return
 * periods are ordered magnitudes rather than categories.
 */
export function leadMedianLevelsFigure(
  table: { levels: number[]; rows: LeadMedianRow[] },
  simRp: RpThresholds,
  opts: LeadMedianLevelsOptions = {},
): { data: Data[]; layout: Partial<Layout> } {
  const leads = table.rows.map((r) => r.lead);
  const covered = table.rows.map((r) => (r.daysCovered > 0 ? r.daysCovered : null));
  const anyCovered = table.rows.some((r) => r.daysCovered > 0);

  const data: Data[] = [];

  // The ceiling first, behind the series: every count is out of this, and
  // without it a line flattening near the top is indistinguishable from a line
  // flattening in the middle.
  if (anyCovered) {
    data.push({
      type: 'scatter',
      mode: 'lines',
      x: leads,
      y: covered,
      line: { color: '#b8b6ae', width: 1.5, dash: 'dot' },
      name: 'days the lead reached at all',
      hovertemplate: 'lead %{x} d<br>%{y} days of the window reached<extra></extra>',
    });
  }

  // Descending, so the widest (2-year) draws last and its markers are not
  // buried under the narrower lines sitting on top of it.
  for (const level of [...table.levels].sort((a, b) => b - a)) {
    const color = RP_LINE_COLORS[level] ?? INK;
    const thr = simRp[level];
    data.push({
      type: 'scatter',
      mode: 'lines+markers',
      x: leads,
      // null, not 0, where the lead reached no days at all: a lead with no
      // data did not report "zero days above" — it reported nothing.
      y: table.rows.map((r) => (r.daysCovered > 0 ? r.daysAbove[level] ?? 0 : null)),
      name: `${level}-year${Number.isFinite(thr) ? ` (${thr.toFixed(0)} m³/s)` : ''}`,
      line: { color, width: 2 },
      marker: { color, size: 6 },
      hovertemplate:
        `<b>${level}-year</b><br>lead %{x} d` +
        '<br>%{y} days of the flood with the median above<extra></extra>',
      connectgaps: false,
    });
  }

  const maxY = Math.max(1, ...table.rows.map((r) => r.daysCovered));

  const layout: Partial<Layout> = {
    title: {
      text: `Days of the flood the median put above each level${
        opts.subtitle ? `<br><sup>${opts.subtitle}</sup>` : ''
      }`,
      x: 0.5,
    },
    margin: { l: 64, r: 24, t: opts.subtitle ? 70 : 56, b: 56 },
    xaxis: {
      title: { text: 'lead time of the forecast (days)', standoff: 10 },
      dtick: 1,
      // Linear, not category: lead is a number and the gaps between leads are
      // real, so the decay should be read as a curve over a continuum.
      type: 'linear',
      gridcolor: GRID,
      tickfont: { color: MUTED },
      zeroline: false,
    },
    yaxis: {
      title: { text: 'days above the level', standoff: 12 },
      rangemode: 'tozero',
      range: [0, maxY + 0.6],
      dtick: maxY <= 10 ? 1 : 2,
      gridcolor: GRID,
      tickfont: { color: MUTED },
    },
    height: 400,
    legend: { orientation: 'h', y: -0.2, font: { size: 10 } },
    hovermode: 'closest',
    plot_bgcolor: SURFACE,
    paper_bgcolor: SURFACE,
  };

  return { data, layout };
}
