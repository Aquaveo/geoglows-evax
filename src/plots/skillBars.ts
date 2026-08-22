import type { Data, Layout } from 'plotly.js-dist-min';
import type { SkillRow } from '../lib/metrics/skillSummary';

/** Performance bands. Green is the pass mark, red is below usable. */
const GOOD = 0.5;
const WEAK = 0.3;
const COLOR_GOOD = '#22a145';
const COLOR_WEAK = '#f0a020';
const COLOR_POOR = '#e0483c';

/** KGE' of a forecast equal to the observed mean — the do-nothing benchmark. */
const KGE_MEAN_BENCHMARK = -0.41;

export interface SkillBarsOptions {
  /** What each row is, e.g. "Lead day" or "Forecast initialization". */
  categoryLabel: string;
  title?: string;
  subtitle?: string;
  /** Sort descending by NSE rather than keeping the natural row order. */
  sortByScore?: boolean;
  /**
   * Axis floor. Both scores are unbounded below, and a single catastrophic value
   * (NSE of -1250 is entirely possible on a badly biased reach) flattens every
   * other bar to invisibility. Below about -1 the exact number carries no extra
   * meaning — it is all "far worse than predicting the mean" — so bars are drawn
   * to this floor and annotated with their true value instead.
   */
  floor?: number;
}

function bandColor(v: number): string {
  if (!Number.isFinite(v)) return 'rgba(0,0,0,0.12)';
  if (v >= GOOD) return COLOR_GOOD;
  if (v >= WEAK) return COLOR_WEAK;
  return COLOR_POOR;
}

/**
 * Paired horizontal bar chart of NSE and KGE', one row per lead day or per
 * forecast run, coloured by performance band.
 *
 * Both panels share one row order and one set of labels, so a row can be read
 * straight across — which is the point of putting them side by side. Bars are
 * coloured by band rather than by series because the question these answer is
 * "is this good enough", and a threshold is easier to see as a colour change
 * than as a position on an axis.
 */
export function skillBarsFigure(
  rows: SkillRow[],
  opts: SkillBarsOptions,
): { data: Data[]; layout: Partial<Layout> } {
  const ordered = opts.sortByScore
    ? [...rows].sort((a, b) => (Number.isFinite(b.nse) ? b.nse : -Infinity) - (Number.isFinite(a.nse) ? a.nse : -Infinity))
    : rows;

  // Plotly draws the first category at the bottom; reverse so the natural
  // order reads top-to-bottom.
  const display = [...ordered].reverse();
  const floor = opts.floor ?? -1;
  const clampToFloor = (v: number) => (Number.isFinite(v) && v < floor ? floor : v);
  const labels = display.map((r) => r.label);
  const nse = display.map((r) => (Number.isFinite(r.nse) ? clampToFloor(r.nse) : null));
  const kge = display.map((r) => (Number.isFinite(r.kge) ? clampToFloor(r.kge) : null));

  const data: Data[] = [
    {
      type: 'bar',
      orientation: 'h',
      x: nse,
      y: labels,
      marker: { color: display.map((r) => bandColor(r.nse)) },
      xaxis: 'x',
      yaxis: 'y',
      showlegend: false,
      customdata: display.map((r) => [r.pairs, r.members, r.nse] as [number, number, number]),
      hovertemplate:
        '<b>%{y}</b><br>NSE: %{customdata[2]:.3f}<br>%{customdata[0]} pairs, %{customdata[1]} members<extra></extra>',
    },
    {
      type: 'bar',
      orientation: 'h',
      x: kge,
      y: labels,
      marker: { color: display.map((r) => bandColor(r.kge)) },
      xaxis: 'x2',
      yaxis: 'y2',
      showlegend: false,
      customdata: display.map((r) => [r.pairs, r.members, r.kge] as [number, number, number]),
      hovertemplate:
        "<b>%{y}</b><br>KGE': %{customdata[2]:.3f}<br>%{customdata[0]} pairs, %{customdata[1]} members<extra></extra>",
    },
  ];

  // Legend-only swatches: per-bar colours cannot produce legend entries.
  const swatches: { name: string; color: string }[] = [
    { name: `≥ ${GOOD} — good`, color: COLOR_GOOD },
    { name: `${WEAK}–${GOOD} — weak`, color: COLOR_WEAK },
    { name: `< ${WEAK} — poor`, color: COLOR_POOR },
  ];
  for (const s of swatches) {
    data.push({
      type: 'bar',
      orientation: 'h',
      x: [null],
      y: [labels[0] ?? ''],
      marker: { color: s.color },
      name: s.name,
      showlegend: true,
      hoverinfo: 'skip',
      xaxis: 'x',
      yaxis: 'y',
    });
  }

  // Rows that were not scored: mark them so a missing bar is never ambiguous.
  const skippedRows = display
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.skipped != null && r.skipped !== '');
  const annotations: NonNullable<Layout['annotations']> = skippedRows.map(({ r }) => ({
    x: 0,
    y: r.label,
    xref: 'x' as const,
    yref: 'y' as const,
    text: `  n/a — ${r.skipped}`,
    showarrow: false,
    xanchor: 'left' as const,
    font: { size: 10, color: '#b45309' },
  }));

  // Bars that ran off the floor: say what they actually are, on their own panel.
  for (const r of display) {
    if (Number.isFinite(r.nse) && r.nse < floor) {
      annotations.push({
        x: floor,
        y: r.label,
        xref: 'x' as const,
        yref: 'y' as const,
        text: `◄ ${r.nse.toFixed(r.nse > -100 ? 1 : 0)}`,
        showarrow: false,
        xanchor: 'left' as const,
        font: { size: 10, color: COLOR_POOR },
      });
    }
    if (Number.isFinite(r.kge) && r.kge < floor) {
      annotations.push({
        x: floor,
        y: r.label,
        xref: 'x2' as const,
        yref: 'y2' as const,
        text: `◄ ${r.kge.toFixed(r.kge > -100 ? 1 : 0)}`,
        showarrow: false,
        xanchor: 'left' as const,
        font: { size: 10, color: COLOR_POOR },
      });
    }
  }

  const refLine = (
    x: number,
    axis: 'x' | 'x2',
    yaxis: 'y' | 'y2',
    dash: 'dot' | 'dash',
  ) => ({
    type: 'line' as const,
    xref: axis,
    yref: `${yaxis} domain` as const,
    x0: x,
    x1: x,
    y0: 0,
    y1: 1,
    line: { color: 'rgba(70,70,70,0.75)', width: 1.25, dash },
  });

  const nseFinite = display.map((r) => r.nse).filter((v) => Number.isFinite(v) && v >= floor);
  const kgeFinite = display.map((r) => r.kge).filter((v) => Number.isFinite(v) && v >= floor);

  const layout: Partial<Layout> = {
    title: {
      text: (() => {
        const clamped = display.filter(
          (r) =>
            (Number.isFinite(r.nse) && r.nse < floor) || (Number.isFinite(r.kge) && r.kge < floor),
        ).length;
        const note = clamped > 0 ? `  |  ${clamped} row${clamped === 1 ? '' : 's'} clipped at ${floor}, true value labelled` : '';
        const sub = `${opts.subtitle ?? ''}${note}`;
        return sub ? `${opts.title ?? 'Skill summary'}<br><sup>${sub}</sup>` : (opts.title ?? 'Skill summary');
      })(),
      x: 0.5,
    },
    margin: { l: 130, r: 30, t: 70, b: 60 },
    // Two panels, one shared row order.
    xaxis: {
      domain: [0, 0.46],
      title: { text: 'NSE' },
      zeroline: true,
      zerolinecolor: '#444',
      range: [floor, Math.max(1, ...nseFinite)],
    },
    xaxis2: {
      domain: [0.54, 1],
      title: { text: "KGE'" },
      zeroline: true,
      zerolinecolor: '#444',
      range: [floor, Math.max(1, ...kgeFinite)],
    },
    yaxis: { type: 'category', automargin: true, title: { text: opts.categoryLabel } },
    yaxis2: { type: 'category', anchor: 'x2', matches: 'y', showticklabels: false },
    shapes: [
      // 0 is the mean-flow benchmark for NSE; -0.41 is its KGE' equivalent.
      refLine(0, 'x', 'y', 'dot'),
      refLine(GOOD, 'x', 'y', 'dash'),
      refLine(KGE_MEAN_BENCHMARK, 'x2', 'y2', 'dot'),
      refLine(GOOD, 'x2', 'y2', 'dash'),
    ],
    annotations,
    barmode: 'overlay',
    bargap: 0.25,
    height: Math.max(360, 40 + display.length * 26),
    legend: { orientation: 'h', y: -0.16 },
    plot_bgcolor: 'white',
    paper_bgcolor: 'white',
  };

  return { data, layout };
}
