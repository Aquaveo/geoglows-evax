import type { Data, Layout } from 'plotly.js-dist-min';
import type { SkillRow } from '../lib/metrics/skillSummary';
import { maxOf, minOf } from '../lib/arrayStats';

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
 * Colour for one bar, shading progressively darker below the axis floor.
 *
 * Band colour alone answers "is this usable", which is the right question until
 * every row lands in the same band. When scores run far below the floor, every
 * bar is drawn at the same clipped length AND the same red, so the chart carries
 * no information at all — which is exactly what happens on a reach whose event
 * exceeds the model's simulated range.
 *
 * So below the floor the red darkens with the magnitude of the true value, on a
 * log scale because these run to -1000 and beyond. Rows still readable as "all
 * poor", but now distinguishable within that.
 */
function barColor(v: number, floor: number): string {
  if (!Number.isFinite(v)) return 'rgba(0,0,0,0.12)';
  if (v >= floor) return bandColor(v);
  // How many decades below the floor, capped so the ramp does not saturate on
  // the first outlier: 1 decade -> slightly darker, 3+ -> darkest.
  const decades = Math.min(Math.log10(Math.max(1 + (floor - v), 1)) / 3, 1);
  // #e0483c -> a deep maroon, interpolated in sRGB.
  const from = [224, 72, 60];
  const to = [92, 16, 20];
  const c = from.map((a, i) => Math.round(a + (to[i] - a) * decades));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
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
  /**
   * Width of the compressed strip drawn below the floor, in axis units.
   *
   * Clamping every sub-floor score to exactly `floor` draws them all at the same
   * length, so a run at -1.2 is indistinguishable from one at -1250 and the
   * ordering is lost. Instead the sub-floor range is compressed logarithmically
   * into this strip: bars stay visually "off the scale" but keep their order.
   * The true value is still labelled on every one of them, so nothing is hidden.
   */
  const UNDERFLOW = 0.28;
  const subFloor = display
    .flatMap((r) => [r.nse, r.kge])
    .filter((v) => Number.isFinite(v) && v < floor);
  const deepest = subFloor.length > 0 ? minOf(subFloor, floor) : floor;
  const maxDepth = Math.log10(Math.max(1 + (floor - deepest), 1)) || 1;
  const clampToFloor = (v: number) => {
    if (!Number.isFinite(v) || v >= floor) return v;
    const depth = Math.log10(Math.max(1 + (floor - v), 1)) / maxDepth;
    return floor - UNDERFLOW * depth;
  };
  const axisFloor = subFloor.length > 0 ? floor - UNDERFLOW * 1.08 : floor;
  const labels = display.map((r) => r.label);
  const nse = display.map((r) => (Number.isFinite(r.nse) ? clampToFloor(r.nse) : null));
  const kge = display.map((r) => (Number.isFinite(r.kge) ? clampToFloor(r.kge) : null));

  const data: Data[] = [
    {
      type: 'bar',
      orientation: 'h',
      x: nse,
      y: labels,
      marker: { color: display.map((r) => barColor(r.nse, floor)) },
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
      marker: { color: display.map((r) => barColor(r.kge, floor)) },
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

  // Rows that were not scored. When many share one reason, repeating it on every
  // row is noise that buries the bars — state it once and mark the rows compactly.
  const skippedRows = display.filter((r) => r.skipped != null && r.skipped !== '');
  const byReason = new Map<string, string[]>();
  for (const r of skippedRows) {
    const list = byReason.get(r.skipped!) ?? [];
    list.push(r.label);
    byReason.set(r.skipped!, list);
  }
  const REPEAT_LIMIT = 2;
  const groupedReasons: string[] = [];
  for (const [reason, labels] of byReason) {
    if (labels.length > REPEAT_LIMIT) {
      groupedReasons.push(
        `${labels.length} rows n/a (${labels[0]}–${labels[labels.length - 1]}): ${reason}`,
      );
    }
  }
  const inlineReasonRows = new Set(
    [...byReason.entries()]
      .filter(([, labels]) => labels.length <= REPEAT_LIMIT)
      .flatMap(([, labels]) => labels),
  );

  const annotations: NonNullable<Layout['annotations']> = skippedRows.map((r) => ({
    x: 0,
    y: r.label,
    xref: 'x' as const,
    yref: 'y' as const,
    text: inlineReasonRows.has(r.label) ? `  n/a — ${r.skipped}` : '  n/a',
    showarrow: false,
    xanchor: 'left' as const,
    font: { size: 10, color: '#b45309' },
  }));

  // Bars that ran off the floor: say what they actually are, on their own panel.
  for (const r of display) {
    if (Number.isFinite(r.nse) && r.nse < floor) {
      annotations.push({
        x: clampToFloor(r.nse),
        y: r.label,
        xref: 'x' as const,
        yref: 'y' as const,
        text: `◄ ${r.nse.toFixed(r.nse > -100 ? 1 : 0)}`,
        showarrow: false,
        xanchor: 'left' as const,
        // White, not COLOR_POOR: this label sits ON the clamped bar, which is
        // that same red, so it was illegible against its own background.
        font: { size: 10, color: '#ffffff' },
      });
    }
    if (Number.isFinite(r.kge) && r.kge < floor) {
      annotations.push({
        x: clampToFloor(r.kge),
        y: r.label,
        xref: 'x2' as const,
        yref: 'y2' as const,
        text: `◄ ${r.kge.toFixed(r.kge > -100 ? 1 : 0)}`,
        showarrow: false,
        xanchor: 'left' as const,
        font: { size: 10, color: '#ffffff' },
      });
    }
  }

  // Column headers, and names on the reference lines, both anchored to the top of
  // the panel.
  //
  // The x-axis titles alone are not enough on this chart: it sizes itself from
  // its row count, so with one row per forecast run the axis can sit 800px below
  // the first row. A reader starting at the top had no way to tell which panel
  // was which, and the two dashed verticals were unexplained.
  for (const [axis, name] of [
    ['x', 'NSE'],
    ['x2', "KGE'"],
  ] as const) {
    annotations.push({
      xref: `${axis} domain` as const,
      yref: 'paper' as const,
      x: 0.5,
      y: 1.008,
      text: `<b>${name}</b>`,
      showarrow: false,
      xanchor: 'center' as const,
      yanchor: 'bottom' as const,
      font: { size: 13, color: '#0b0b0b' },
    });
  }
  for (const [axis, x, label] of [
    ['x', 0, 'no better than the observed mean'],
    ['x', GOOD, `usable (${GOOD})`],
    ['x2', KGE_MEAN_BENCHMARK, `observed mean (${KGE_MEAN_BENCHMARK})`],
    ['x2', GOOD, `usable (${GOOD})`],
  ] as const) {
    annotations.push({
      xref: axis,
      yref: 'paper' as const,
      x,
      y: 1.002,
      text: label,
      showarrow: false,
      xanchor: 'left' as const,
      yanchor: 'bottom' as const,
      font: { size: 9, color: '#6b6a65' },
    });
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
        const note =
          clamped > 0
            ? `  |  ${clamped} row${clamped === 1 ? '' : 's'} below ${floor}, drawn compressed below the axis and labelled with the true value`
            : '';
        const skipNote = groupedReasons.length > 0 ? `<br>${groupedReasons.join('  |  ')}` : '';
        const sub = `${opts.subtitle ?? ''}${note}${skipNote}`;
        return sub ? `${opts.title ?? 'Skill summary'}<br><sup>${sub}</sup>` : (opts.title ?? 'Skill summary');
      })(),
      x: 0.5,
    },
    margin: { l: 130, r: 30, t: 104, b: 62 },
    // Two panels, one shared row order.
    xaxis: {
      domain: [0, 0.46],
      title: { text: 'NSE' },
      zeroline: true,
      zerolinecolor: '#444',
      range: [axisFloor, Math.max(1, maxOf(nseFinite, 1))],
    },
    xaxis2: {
      domain: [0.54, 1],
      title: { text: "KGE'" },
      zeroline: true,
      zerolinecolor: '#444',
      range: [axisFloor, Math.max(1, maxOf(kgeFinite, 1))],
    },
    yaxis: {
      type: 'category',
      automargin: true,
      title: { text: opts.categoryLabel, standoff: 16 },
    },
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
    height: Math.max(360, 74 + display.length * 26),
    legend: { orientation: 'h', y: -0.16 },
    plot_bgcolor: 'white',
    paper_bgcolor: 'white',
  };

  return { data, layout };
}
