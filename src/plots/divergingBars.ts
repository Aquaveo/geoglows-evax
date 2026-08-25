import type { Data, Layout } from 'plotly.js-dist-min';
import { maxOf } from '../lib/arrayStats';

/** One bar: a signed value against a zero baseline. */
export interface DivergingRow {
  label: string;
  /** Signed value. NaN renders as an n/a marker instead of a bar. */
  value: number;
  /** Sample size behind the value, for the hover. */
  n?: number;
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

  const data: Data[] = [
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
      customdata: scored.map((r) => [r.n ?? Number.NaN, r.detail ?? ''] as [number, string]),
      hovertemplate:
        `<b>%{y}</b><br>%{x:+.1f} ${unit}` +
        `<br>%{customdata[0]} members%{customdata[1]}<extra></extra>`,
      text: scored.map((r) => `${r.value > 0 ? '+' : ''}${r.value.toFixed(1)}`),
      textposition: 'outside',
      textfont: { size: 10, color: MUTED },
      cliponaxis: false,
    },
  ];

  // Legend-only swatches: per-bar colours produce no legend entries of their own.
  for (const [name, color] of [
    [`◀ ${opts.negativeLabel}`, COLOR_NEG],
    [`${opts.positiveLabel} ▶`, COLOR_POS],
  ] as const) {
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

  const span = maxOf(scored.map((r) => Math.abs(r.value)), 1);
  // Symmetric about zero so bar lengths are comparable across sides — an
  // asymmetric range would make a late bar look bigger than an equal early one.
  const limit = span * 1.28;

  const early = scored.filter((r) => r.value < 0).length;
  const late = scored.filter((r) => r.value > 0).length;
  const summary = `${early} ${opts.negativeLabel}, ${late} ${opts.positiveLabel}`;

  const layout: Partial<Layout> = {
    title: {
      text: `${opts.title ?? 'Signed error'}<br><sup>${
        opts.subtitle ? `${opts.subtitle}  |  ` : ''
      }${summary}</sup>`,
      x: 0.5,
    },
    margin: { l: 96, r: 56, t: 62, b: 56 },
    xaxis: {
      title: { text: opts.valueLabel },
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
      title: opts.categoryLabel ? { text: opts.categoryLabel } : undefined,
      tickfont: { color: INK },
    },
    annotations,
    bargap: 0.22,
    height: Math.max(300, 96 + display.length * 24),
    legend: { orientation: 'h', y: -0.14 },
    plot_bgcolor: '#fcfcfb',
    paper_bgcolor: '#fcfcfb',
  };

  return { data, layout };
}
