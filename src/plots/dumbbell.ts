import type { Data, Layout } from 'plotly.js-dist-min';
import { maxOf, minOf } from '../lib/arrayStats';

/** One row: the same metric before and after correction. */
export interface DumbbellRow {
  label: string;
  /** Uncorrected value. NaN renders the row as unscored. */
  before: number;
  /** Corrected value. NaN renders the row as unscored. */
  after: number;
  /** Pairs behind the row, for the hover. */
  pairs?: number;
}

export interface DumbbellOptions {
  title?: string;
  subtitle?: string;
  metricLabel: string;
  beforeLabel?: string;
  afterLabel?: string;
  /** Where the metric is heading — decides which direction is coloured as a gain. */
  higherIsBetter?: boolean;
}

const COLOR_BEFORE = '#898781';
const COLOR_AFTER = '#eb6834';
const COLOR_GAIN = '#1baf7a';
const COLOR_LOSS = '#e34948';
const INK = '#0b0b0b';
const MUTED = '#898781';
const GRID = '#e1e0d9';

/**
 * Before/after per row as a connected pair of dots.
 *
 * Two overlaid line series force the reader to match colours across every
 * crossing to answer "did this get better". A dumbbell makes each change one
 * mark whose length is the size of the change and whose direction is the sign,
 * so the answer is read rather than reconstructed.
 *
 * The connector is drawn per row as its own trace: a single trace with null
 * separators would work, but then hover cannot report the individual delta.
 */
export function dumbbellFigure(
  rows: DumbbellRow[],
  opts: DumbbellOptions,
): { data: Data[]; layout: Partial<Layout> } {
  // Plotly stacks the first category at the bottom; reverse so row order reads
  // top-to-bottom like the table it replaces.
  const display = [...rows].reverse();
  const scored = display.filter((r) => Number.isFinite(r.before) && Number.isFinite(r.after));
  const higherIsBetter = opts.higherIsBetter ?? true;

  const data: Data[] = [];

  for (const r of scored) {
    const gain = higherIsBetter ? r.after - r.before : r.before - r.after;
    data.push({
      type: 'scatter',
      mode: 'lines',
      x: [r.before, r.after],
      y: [r.label, r.label],
      line: { color: gain >= 0 ? COLOR_GAIN : COLOR_LOSS, width: 3 },
      opacity: 0.45,
      showlegend: false,
      hoverinfo: 'skip',
    });
  }

  // Endpoints after the connectors so the dots sit on top, each with a surface
  // ring so overlapping marks stay separable.
  const endpoint = (
    key: 'before' | 'after',
    color: string,
    name: string,
  ): Data => ({
    type: 'scatter',
    mode: 'markers',
    x: scored.map((r) => r[key]),
    y: scored.map((r) => r.label),
    marker: { size: 11, color, line: { color: '#fcfcfb', width: 2 } },
    name,
    customdata: scored.map((r) => [
      r.pairs ?? Number.NaN,
      higherIsBetter ? r.after - r.before : r.before - r.after,
    ] as [number, number]),
    hovertemplate:
      `<b>%{y}</b><br>${name}: %{x:.3f}` +
      `<br>change: %{customdata[1]:+.3f}` +
      `<br>%{customdata[0]} pairs<extra></extra>`,
  });
  data.push(endpoint('before', COLOR_BEFORE, opts.beforeLabel ?? 'Raw'));
  data.push(endpoint('after', COLOR_AFTER, opts.afterLabel ?? 'Corrected'));

  // Rows that could not be compared are stated, not silently dropped.
  const unscored = display.filter(
    (r) => !Number.isFinite(r.before) || !Number.isFinite(r.after),
  );
  const annotations: NonNullable<Layout['annotations']> = unscored.map((r) => ({
    x: 0,
    y: r.label,
    xref: 'x' as const,
    yref: 'y' as const,
    text: !Number.isFinite(r.before) && !Number.isFinite(r.after)
      ? '  n/a — neither variant scored'
      : !Number.isFinite(r.after)
        ? '  n/a — corrected not available'
        : '  n/a — raw not scored',
    showarrow: false,
    xanchor: 'left' as const,
    font: { size: 10, color: '#b45309' },
  }));

  const vals = scored.flatMap((r) => [r.before, r.after]);
  const lo = minOf(vals, 0);
  const hi = maxOf(vals, 1);
  const pad = (hi - lo) * 0.12 || 0.1;

  const improved = scored.filter((r) =>
    higherIsBetter ? r.after > r.before : r.after < r.before,
  ).length;
  const summary =
    scored.length > 0
      ? `${improved} of ${scored.length} rows improved`
      : 'nothing comparable to score';

  const layout: Partial<Layout> = {
    title: {
      text: `${opts.title ?? 'Before and after correction'}<br><sup>${
        opts.subtitle ? `${opts.subtitle}  |  ` : ''
      }${summary}</sup>`,
      x: 0.5,
    },
    margin: { l: 96, r: 40, t: 62, b: 56 },
    xaxis: {
      title: { text: opts.metricLabel },
      range: [lo - pad, hi + pad],
      gridcolor: GRID,
      zeroline: true,
      zerolinecolor: '#c3c2b7',
      tickfont: { color: MUTED },
    },
    yaxis: {
      type: 'category',
      automargin: true,
      tickfont: { color: INK },
      gridcolor: GRID,
    },
    annotations,
    height: Math.max(300, 96 + display.length * 26),
    legend: { orientation: 'h', y: -0.14 },
    hovermode: 'closest',
    plot_bgcolor: '#fcfcfb',
    paper_bgcolor: '#fcfcfb',
  };

  return { data, layout };
}
