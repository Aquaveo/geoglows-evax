import type { Data, Layout } from 'plotly.js-dist-min';
import type { ExceedanceGrid } from '../lib/floodCheck';

const INK = '#0b0b0b';
const MUTED = '#898781';
const SURFACE = '#fcfcfb';

/**
 * One hue, light to dark — the share of members crossing a level is a magnitude,
 * so it takes a sequential ramp. A diverging or categorical scale would invent a
 * midpoint or a set of classes that the quantity does not have.
 */
const RAMP: Array<[number, string]> = [
  [0, '#f4f6fa'],
  [0.15, '#d3e0ee'],
  [0.35, '#a3c4dd'],
  [0.55, '#6a9fc7'],
  [0.75, '#3b78ac'],
  [1, '#14456f'],
];

export interface ExceedanceGridOptions {
  title?: string;
  subtitle?: string;
  /** x-axis label, e.g. "forecast issued" or "lead day". */
  columnLabel: string;
  /** Hover noun for a column, e.g. "issued 2024-09-10" reads better than a date. */
  columnNoun?: string;
}

/**
 * Share of ensemble members crossing each return-period level.
 *
 * Reads as a block: a dark band that reaches up the rows is a forecast that put
 * most of its members over a high threshold, and the row it stops at is the
 * largest event the model was calling. Deliberately not converted to a
 * probability — the members are a spread, not a calibrated distribution, so a
 * percentage of them is a description of the ensemble and nothing more.
 */
export function exceedanceGridFigure(
  g: ExceedanceGrid,
  opts: ExceedanceGridOptions,
): { data: Data[]; layout: Partial<Layout> } {
  const yLabels = g.levels.map((rp) => `${rp}-year`);
  const z = g.grid.map((row) => row.map((c) => (c.total > 0 ? c.share * 100 : null)));
  // Preformatted: plotly's heatmap customdata is one Datum per cell, so a
  // two-number pair has to arrive as a string.
  const counts = g.grid.map((row) => row.map((c) => `${c.crossed} of ${c.total}`));

  const data: Data[] = [
    {
      type: 'heatmap',
      x: g.columns,
      y: yLabels,
      z,
      customdata: counts,
      colorscale: RAMP,
      zmin: 0,
      zmax: 100,
      // A gap between cells, so a run of high cells reads as several columns
      // rather than one solid mass.
      xgap: 2,
      ygap: 2,
      hovertemplate:
        `%{y} level<br>${opts.columnNoun ?? opts.columnLabel} %{x}` +
        '<br><b>%{z:.0f}%</b> of members crossed' +
        '<br>%{customdata} members<extra></extra>',
      colorbar: {
        title: { text: 'members<br>crossing', side: 'right' },
        ticksuffix: '%',
        thickness: 12,
        len: 0.8,
        outlinewidth: 0,
        tickfont: { color: MUTED, size: 10 },
      },
    },
  ];

  // Label only the cells where something crossed. A number in every cell would
  // bury the handful that carry the finding under a wall of zeros.
  const annotations: NonNullable<Layout['annotations']> = [];
  for (let r = 0; r < g.grid.length; r++) {
    for (let c = 0; c < g.grid[r].length; c++) {
      const cell = g.grid[r][c];
      if (!(cell.total > 0) || !(cell.share > 0)) continue;
      const pct = cell.share * 100;
      annotations.push({
        x: g.columns[c],
        y: yLabels[r],
        xref: 'x' as const,
        yref: 'y' as const,
        text: pct >= 1 ? `${Math.round(pct)}` : '<1',
        showarrow: false,
        font: { size: 9, color: pct >= 55 ? '#ffffff' : INK },
      });
    }
  }

  const layout: Partial<Layout> = {
    title: {
      text: `${opts.title ?? 'Members crossing each level'}${
        opts.subtitle ? `<br><sup>${opts.subtitle}</sup>` : ''
      }`,
      x: 0.5,
    },
    margin: { l: 78, r: 84, t: opts.subtitle ? 66 : 52, b: 76 },
    xaxis: {
      type: 'category',
      title: { text: opts.columnLabel, standoff: 12 },
      tickfont: { color: MUTED, size: 10 },
      tickangle: g.columns.length > 12 ? -60 : 0,
      showgrid: false,
    },
    yaxis: {
      type: 'category',
      title: { text: 'return period', standoff: 10 },
      tickfont: { color: INK, size: 11 },
      showgrid: false,
    },
    annotations,
    height: Math.max(240, 130 + g.levels.length * 34),
    plot_bgcolor: SURFACE,
    paper_bgcolor: SURFACE,
  };

  return { data, layout };
}
