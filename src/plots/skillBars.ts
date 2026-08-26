import type { Data, Layout } from 'plotly.js-dist-min';
import type { SkillRow } from '../lib/metrics/skillSummary';
import { maxOf, minOf } from '../lib/arrayStats';

/**
 * Performance classification, keyed to each metric's OWN no-skill benchmark.
 *
 * The categories and the KGE' boundaries are the published scheme: Good,
 * Intermediate, Poor, Very poor, Unacceptable, split at 0.75 / 0.50 / 0.00 /
 * −0.41. The bottom boundary is the point of the whole thing — KGE' = −0.41 is
 * the score of a forecast equal to the observed mean flow at every timestep, so
 * below it the model adds nothing beyond climatology.
 *
 * This previously used one pair of thresholds (0.5 and 0.3) for BOTH metrics,
 * with no source. It was wrong twice over. The 0.3 boundary appears in neither
 * metric's literature, and colouring NSE and KGE' on one scale ignores that they
 * have different origins — a KGE' of −0.2 beats the observed mean, yet it was
 * painted the same red as −50. The module already drew 0 and −41 as separate
 * benchmark lines while colouring both panels off the same numbers.
 *
 * NSE keeps the same category names and upper boundaries, but its benchmark is
 * 0, not −0.41 — NSE is already normalised by the observed variance. So NSE has
 * no "Very poor" band: at or below 0 the forecast is beaten by the observed mean
 * and is Unacceptable directly. That is a derivation from the definition of the
 * benchmark, not a published NSE scheme, and the plot note says so.
 */
export type SkillMetric = 'nse' | 'kge';

/** KGE' of a forecast equal to the observed mean — the do-nothing benchmark. */
const KGE_MEAN_BENCHMARK = -0.41;
/** NSE of that same forecast. NSE is normalised by observed variance. */
const NSE_MEAN_BENCHMARK = 0;

const COLOR_GOOD = '#125e30';
const COLOR_INTERMEDIATE = '#4fae4f';
const COLOR_POOR = '#f2b13a';
const COLOR_VERY_POOR = '#d84a3a';
const COLOR_UNACCEPTABLE = '#6e1414';

interface Band {
  /** Lower bound, exclusive. A value sits in the highest band it clears. */
  above: number;
  name: string;
  color: string;
}

/**
 * Bands per metric, highest first.
 *
 * Measured CVD separation of this ramp is ΔE 7.2 (protanopia) at its worst
 * adjacent pair, inside the 6–8 band that is permissible only alongside a
 * non-colour encoding. Five ordered categories through green–amber–red cannot do
 * better: yellow-green and amber sit ΔE 1.3–5.3 apart under protanopia whatever
 * the exact hex. The non-colour encodings here are the numeric axis, a labelled
 * line at every boundary, and the category NAME in each bar's hover.
 */
const BANDS: Record<SkillMetric, Band[]> = {
  kge: [
    { above: 0.75, name: 'Good', color: COLOR_GOOD },
    { above: 0.5, name: 'Intermediate', color: COLOR_INTERMEDIATE },
    { above: 0, name: 'Poor', color: COLOR_POOR },
    { above: KGE_MEAN_BENCHMARK, name: 'Very poor', color: COLOR_VERY_POOR },
    { above: Number.NEGATIVE_INFINITY, name: 'Unacceptable', color: COLOR_UNACCEPTABLE },
  ],
  nse: [
    { above: 0.75, name: 'Good', color: COLOR_GOOD },
    { above: 0.5, name: 'Intermediate', color: COLOR_INTERMEDIATE },
    { above: NSE_MEAN_BENCHMARK, name: 'Poor', color: COLOR_POOR },
    { above: Number.NEGATIVE_INFINITY, name: 'Unacceptable', color: COLOR_UNACCEPTABLE },
  ],
};

/** The band a value falls in, or null when it is not finite. */
export function bandOf(v: number, metric: SkillMetric): Band | null {
  if (!Number.isFinite(v)) return null;
  for (const b of BANDS[metric]) if (v > b.above) return b;
  // Exactly at the metric's benchmark, or below it.
  return BANDS[metric][BANDS[metric].length - 1];
}

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

function bandColor(v: number, metric: SkillMetric): string {
  return bandOf(v, metric)?.color ?? 'rgba(0,0,0,0.12)';
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
function barColor(v: number, floor: number, metric: SkillMetric): string {
  if (!Number.isFinite(v)) return 'rgba(0,0,0,0.12)';
  if (v >= floor) return bandColor(v, metric);
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
      marker: { color: display.map((r) => barColor(r.nse, floor, 'nse')) },
      xaxis: 'x',
      yaxis: 'y',
      showlegend: false,
      customdata: display.map(
        (r) =>
          [r.pairs, r.members, r.nse, bandOf(r.nse, 'nse')?.name ?? 'not scored'] as [
            number, number, number, string,
          ],
      ),
      hovertemplate:
        '<b>%{y}</b><br>NSE: %{customdata[2]:.3f} — <b>%{customdata[3]}</b>' +
        '<br>%{customdata[0]} pairs, %{customdata[1]} members<extra></extra>',
    },
    {
      type: 'bar',
      orientation: 'h',
      x: kge,
      y: labels,
      marker: { color: display.map((r) => barColor(r.kge, floor, 'kge')) },
      xaxis: 'x2',
      yaxis: 'y2',
      showlegend: false,
      customdata: display.map(
        (r) =>
          [r.pairs, r.members, r.kge, bandOf(r.kge, 'kge')?.name ?? 'not scored'] as [
            number, number, number, string,
          ],
      ),
      hovertemplate:
        "<b>%{y}</b><br>KGE': %{customdata[2]:.3f} — <b>%{customdata[3]}</b>" +
        '<br>%{customdata[0]} pairs, %{customdata[1]} members<extra></extra>',
    },
  ];

  // Legend-only swatches: per-bar colours cannot produce legend entries.
  //
  // Names only, no numbers. The two metrics share the category NAMES but not the
  // boundaries — NSE's benchmark is 0 and KGE''s is −0.41 — so a numeric range in
  // a legend shared by both panels would be wrong for one of them. The numbers
  // live on each panel's own boundary lines.
  const swatches: { name: string; color: string }[] = [
    { name: 'Good', color: COLOR_GOOD },
    { name: 'Intermediate', color: COLOR_INTERMEDIATE },
    { name: 'Poor', color: COLOR_POOR },
    { name: 'Very poor (KGE′ only)', color: COLOR_VERY_POOR },
    { name: 'Unacceptable — below the observed mean', color: COLOR_UNACCEPTABLE },
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
  // Every band boundary, generated from the same table that colours the bars, so
  // a line can never sit somewhere the colours do not change. The benchmark is
  // named rather than numbered: it is the fact, not the number, that matters.
  const boundaries: [('x' | 'x2'), number, string][] = [];
  for (const [axis, metric] of [
    ['x', 'nse'],
    ['x2', 'kge'],
  ] as const) {
    const benchmark = metric === 'kge' ? KGE_MEAN_BENCHMARK : NSE_MEAN_BENCHMARK;
    for (const b of BANDS[metric]) {
      if (!Number.isFinite(b.above)) continue;
      boundaries.push([
        axis,
        b.above,
        b.above === benchmark ? `observed mean (${b.above})` : String(b.above),
      ]);
    }
  }
  for (const [axis, x, label] of boundaries) {
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
    // One line per band boundary, from the same table. The metric's own
    // benchmark is dotted and the rest dashed, because that one is categorically
    // different: above it the forecast beats predicting the observed mean, below
    // it the forecast is worse than doing nothing.
    shapes: boundaries.map(([axis, x]) =>
      refLine(
        x,
        axis,
        axis === 'x' ? 'y' : 'y2',
        x === (axis === 'x2' ? KGE_MEAN_BENCHMARK : NSE_MEAN_BENCHMARK) ? 'dot' : 'dash',
      ),
    ),
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
