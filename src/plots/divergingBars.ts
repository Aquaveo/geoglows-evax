import type { Data, Layout } from 'plotly.js-dist-min';
import { maxOf } from '../lib/arrayStats';

/** One bar: a signed value against a zero baseline. */
export interface DivergingRow {
  label: string;
  /** Signed value. NaN renders as an n/a marker instead of a bar. */
  value: number;
  /** Sample size behind the value, for the hover. */
  n?: number;
  /**
   * Interquartile range across members, drawn as an error bar.
   *
   * Carrying the spread here is what lets one chart replace a bar chart plus a
   * box plot of the same numbers: the bar gives the median and its sign, the
   * error bars give member disagreement.
   */
  q1?: number;
  q3?: number;
  /**
   * Full min–max across members, drawn as a lighter, thinner whisker behind the
   * interquartile bar.
   *
   * Two levels rather than one because they answer different questions and a
   * single whisker cannot do both: the outer range shows whether ANY member got
   * the sign right, while the inner quartiles show where the bulk sat. Drawn
   * lighter so one outlying member cannot dominate the row — the failure the
   * separate box plot had, where a lone straggler crossing zero made an
   * otherwise decisive result look ambiguous.
   */
  lo?: number;
  hi?: number;
  /** Extra hover context, e.g. the spread across members. */
  detail?: string;
}

export interface DivergingBarsOptions {
  title?: string;
  subtitle?: string;
  /** Axis label, e.g. "Δt_peak (hours)". */
  valueLabel: string;
  /** What a negative value means, e.g. "early". */
  negativeLabel: string;
  /** What a positive value means, e.g. "late". */
  positiveLabel: string;
  unit?: string;
  categoryLabel?: string;
}

const COLOR_NEG = '#2a78d6';
const COLOR_POS = '#eb6834';
const INK = '#0b0b0b';
const MUTED = '#898781';
const GRID = '#e1e0d9';

/**
 * Signed values as bars either side of a zero baseline.
 *
 * For a quantity whose SIGN is the finding — early vs late, over vs under — this
 * asks nothing of the reader: the side answers the question and the length gives
 * the size. A box plot of the same numbers carries more information but makes
 * locating zero the reader's first task, and the sign is what most people came
 * for.
 *
 * Colour is redundant with position here, deliberately: the side of the axis
 * already says which way, so a colour-blind reader loses nothing.
 */
export function divergingBarsFigure(
  rows: DivergingRow[],
  opts: DivergingBarsOptions,
): { data: Data[]; layout: Partial<Layout> } {
  // Plotly puts the first category at the bottom; reverse for top-to-bottom.
  const display = [...rows].reverse();
  const scored = display.filter((r) => Number.isFinite(r.value));
  const unit = opts.unit ?? '';

  const hasRange = scored.some((r) => Number.isFinite(r.lo) && Number.isFinite(r.hi));

  const data: Data[] = [
    // Full range first, so the bars and the heavier IQR whiskers draw over it.
    ...(hasRange
      ? [
          {
            type: 'scatter' as const,
            mode: 'markers' as const,
            x: scored.map((r) => r.value),
            y: scored.map((r) => r.label),
            marker: { size: 0.1, color: 'rgba(0,0,0,0)' },
            error_x: {
              type: 'data' as const,
              symmetric: false,
              array: scored.map((r) =>
                Number.isFinite(r.hi) ? Math.max(0, (r.hi as number) - r.value) : 0,
              ),
              arrayminus: scored.map((r) =>
                Number.isFinite(r.lo) ? Math.max(0, r.value - (r.lo as number)) : 0,
              ),
              color: '#b8b6ae',
              thickness: 1,
              width: 3,
            },
            showlegend: false,
            hoverinfo: 'skip' as const,
          },
        ]
      : []),
    {
      type: 'bar',
      orientation: 'h',
      x: scored.map((r) => r.value),
      y: scored.map((r) => r.label),
      marker: {
        color: scored.map((r) => (r.value < 0 ? COLOR_NEG : COLOR_POS)),
        line: { color: '#fcfcfb', width: 1 },
      },
      showlegend: false,
      // Asymmetric error bars: the IQR is not centred on the median in general,
      // so a symmetric bar would misreport it.
      error_x: scored.some((r) => Number.isFinite(r.q1) && Number.isFinite(r.q3))
        ? {
            type: 'data' as const,
            symmetric: false,
            array: scored.map((r) =>
              Number.isFinite(r.q3) ? Math.max(0, (r.q3 as number) - r.value) : 0,
            ),
            arrayminus: scored.map((r) =>
              Number.isFinite(r.q1) ? Math.max(0, r.value - (r.q1 as number)) : 0,
            ),
            color: '#33322f',
            thickness: 2.2,
            width: 5,
          }
        : undefined,
      customdata: scored.map(
        (r) =>
          [
            r.n ?? Number.NaN,
            r.detail ?? '',
            Number.isFinite(r.q1) ? (r.q1 as number) : Number.NaN,
            Number.isFinite(r.q3) ? (r.q3 as number) : Number.NaN,
            Number.isFinite(r.lo) ? (r.lo as number) : Number.NaN,
            Number.isFinite(r.hi) ? (r.hi as number) : Number.NaN,
          ] as [number, string, number, number, number, number],
      ),
      hovertemplate:
        `<b>%{y}</b><br>median %{x:+.1f} ${unit}` +
        `<br>middle half %{customdata[2]:+.1f} to %{customdata[3]:+.1f}` +
        `<br>full range %{customdata[4]:+.1f} to %{customdata[5]:+.1f}` +
        `<br>%{customdata[0]} members%{customdata[1]}<extra></extra>`,
      cliponaxis: false,
    },
  ];

  // Legend-only swatches: per-bar colours produce no legend entries of their own.
  // Only for sides that occur — a swatch for a colour no bar uses reads as a
  // category with zero members rather than a category that cannot arise.
  const sideSwatches: [string, string][] = [];
  if (scored.some((r) => r.value < 0)) sideSwatches.push([`◀ ${opts.negativeLabel}`, COLOR_NEG]);
  if (scored.some((r) => r.value > 0)) sideSwatches.push([`${opts.positiveLabel} ▶`, COLOR_POS]);
  for (const [name, color] of sideSwatches) {
    data.push({
      type: 'bar',
      orientation: 'h',
      x: [null],
      y: [scored[0]?.label ?? ''],
      marker: { color },
      name,
      showlegend: true,
      hoverinfo: 'skip',
    });
  }

  if (hasRange) {
    for (const [name, color, w] of [
      ['middle half of members', '#33322f', 4],
      ['full range', '#b8b6ae', 2],
    ] as const) {
      data.push({
        type: 'scatter',
        mode: 'lines',
        x: [null],
        y: [scored[0]?.label ?? ''],
        line: { color, width: w },
        name,
        showlegend: true,
        hoverinfo: 'skip',
      });
    }
  }

  const unscored = display.filter((r) => !Number.isFinite(r.value));
  const annotations: NonNullable<Layout['annotations']> = unscored.map((r) => ({
    x: 0,
    y: r.label,
    xref: 'x' as const,
    yref: 'y' as const,
    text: `  n/a${r.detail ? ` — ${r.detail}` : ''}`,
    showarrow: false,
    xanchor: 'left' as const,
    font: { size: 10, color: '#b45309' },
  }));

  // Scale to the bars and their quartile whiskers — NOT the full range.
  //
  // Letting the full range set the scale is what broke this chart at 16 lead
  // days: the outer whiskers reached ±400 h while every median sat under 60 h,
  // so each bar was squeezed into a few percent of the width and the picture
  // showed its noise instead of its finding. The full range is still drawn — it
  // is clipped at the axis edge, rows that continue past it are marked with a
  // chevron, and the exact numbers stay in the hover.
  const absOf = (keys: (number | undefined)[]) =>
    keys.filter((v): v is number => Number.isFinite(v)).map(Math.abs);
  const core = maxOf(scored.flatMap((r) => absOf([r.value, r.q1, r.q3])), 1);
  const full = maxOf(scored.flatMap((r) => absOf([r.value, r.q1, r.q3, r.lo, r.hi])), 1);
  // Symmetric about zero so bar lengths are comparable across sides — an
  // asymmetric range would make a late bar look bigger than an equal early one.
  // When the full range already fits comfortably nothing is clipped.
  const limit = full <= core * 1.34 ? full * 1.1 : core * 1.34;
  const overflowing = scored.filter(
    (r) =>
      (Number.isFinite(r.hi) && (r.hi as number) > limit) ||
      (Number.isFinite(r.lo) && (r.lo as number) < -limit),
  );

  // Median values as a right-aligned column outside the plot area. Labelling
  // each bar in place collided with that bar's own quartile whisker, and a
  // number on every mark is noise besides; a column reads straight down and
  // cannot overlap anything.
  for (const r of scored) {
    annotations.push({
      xref: 'paper' as const,
      x: 1.012,
      y: r.label,
      yref: 'y' as const,
      text: `${r.value > 0 ? '+' : ''}${r.value.toFixed(0)}${unit}`,
      showarrow: false,
      xanchor: 'left' as const,
      font: { size: 11, color: MUTED },
    });
  }

  // Chevrons where a row's full range runs off the edge, so clipping is visible
  // rather than silent.
  for (const r of overflowing) {
    if (Number.isFinite(r.hi) && (r.hi as number) > limit) {
      annotations.push({
        x: limit,
        y: r.label,
        xref: 'x' as const,
        yref: 'y' as const,
        text: '›',
        showarrow: false,
        xanchor: 'right' as const,
        font: { size: 15, color: '#9d9b93' },
      });
    }
    if (Number.isFinite(r.lo) && (r.lo as number) < -limit) {
      annotations.push({
        x: -limit,
        y: r.label,
        xref: 'x' as const,
        yref: 'y' as const,
        text: '‹',
        showarrow: false,
        xanchor: 'left' as const,
        font: { size: 15, color: '#9d9b93' },
      });
    }
  }

  const early = scored.filter((r) => r.value < 0).length;
  const late = scored.filter((r) => r.value > 0).length;
  const summary =
    `${early} ${opts.negativeLabel}, ${late} ${opts.positiveLabel}` +
    (overflowing.length > 0
      ? `  |  ${overflowing.length} row${overflowing.length === 1 ? '' : 's'} range past the axis (›)`
      : '');

  const layout: Partial<Layout> = {
    title: {
      text: `${opts.title ?? 'Signed error'}<br><sup>${
        opts.subtitle ? `${opts.subtitle}  |  ` : ''
      }${summary}</sup>`,
      x: 0.5,
    },
    // Right margin holds the value gutter; left holds the category labels.
    margin: { l: 96, r: 84, t: 66, b: 56 },
    xaxis: {
      title: { text: opts.valueLabel, standoff: 12 },
      range: [-limit, limit],
      zeroline: true,
      zerolinecolor: '#52514e',
      zerolinewidth: 2,
      gridcolor: GRID,
      tickfont: { color: MUTED },
    },
    yaxis: {
      type: 'category',
      automargin: true,
      // standoff keeps the rotated axis title off the tick labels, which it
      // was overlapping at 16 rows.
      title: opts.categoryLabel ? { text: opts.categoryLabel, standoff: 16 } : undefined,
      tickfont: { color: INK },
    },
    annotations,
    bargap: 0.22,
    height: Math.max(300, 104 + display.length * 28),
    legend: { orientation: 'h', y: -0.14 },
    plot_bgcolor: '#fcfcfb',
    paper_bgcolor: '#fcfcfb',
  };

  return { data, layout };
}
