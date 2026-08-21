import type { Data, Layout } from 'plotly.js-dist-min';

export interface PerLeadDistribution {
  /** Ordered lead days (e.g. 0..15). */
  leads: number[];
  /** values[i] = ensemble-member values at leads[i] (NaNs filtered out). */
  values: number[][];
  /**
   * Forecast/observation pairs behind each lead. A metric computed from four
   * pairs is not comparable to one computed from forty, so this travels with the
   * values rather than being inferred from them.
   */
  pairs?: number[];
  /**
   * Per-lead reason the metric was not computed, index-aligned with `leads`.
   * A non-null entry means the lead is deliberately blank, and the reason is
   * rendered on the plot — a gap with no explanation reads as a bug.
   */
  skipped?: (string | null)[];
}

export interface DistributionFigureOptions {
  /** Short label used in hover and legends (e.g. "MCC", "HSS", "KGE"). */
  metricLabel: string;
  /** Full title; defaults to `${metricLabel} Distribution per Lead Day`. */
  title?: string;
  /** Italic-style subtitle line below the title (rendered in <sup>). */
  subtitle?: string;
  /** Y-axis title. Defaults to metricLabel. */
  yAxisLabel?: string;
  /** X-axis title. Defaults to "Lead Day". */
  xAxisLabel?: string;
  /**
   * Replaces the numeric x tick and hover labels, index-aligned with `leads`.
   * `leads` still supplies the positions, so ranges and reference lines keep
   * working — only the labelling changes.
   */
  xTickText?: string[];
  /** d3 number format for value tooltips. Default ".4f". */
  valueFormat?: string;
  /** Draw a horizontal y = 0 dashed reference line. */
  zeroLine?: boolean;
  /** Additional horizontal reference lines (e.g. y = 1 "perfect" for KGE/r/β/γ). */
  referenceLines?: Array<{
    y: number;
    label: string;
    color?: string;
    dash?: 'solid' | 'dot' | 'dash' | 'dashdot' | 'longdash' | 'longdashdot';
  }>;
  /** Base color as "r, g, b" — used for boxes and points. */
  rgb?: string;
  /** Legend name for the box-trace group. */
  membersLabel?: string;
}

// Notebook's COLOR_51 (#e07b39) — used for the 51-member range. The app only
// has 51 members at every lead (no high-res ensemble_52), so we use this color
// throughout.
const DEFAULT_RGB = '224, 123, 57';

/**
 * Per-lead-day box plot of a metric across ensemble members, with median line
 * and Q25/Q75 dotted overlays + grey IQR fill — matches the notebook's
 * `fig_boxplot` style. Min/Max trace lines are included as toggleable legend
 * entries (hidden by default).
 */
export function distributionVsLeadFigure(
  d: PerLeadDistribution,
  opts: DistributionFigureOptions,
): { data: Data[]; layout: Partial<Layout> } {
  const fmt = opts.valueFormat ?? '.4f';
  const rgb = opts.rgb ?? DEFAULT_RGB;
  const lineColor = `rgb(${rgb})`;
  const boxFill = `rgba(${rgb}, 0.7)`;

  const data: Data[] = [];

  // Label for point i on the x-axis, and the prefix used in hover text.
  const xLab = (i: number) => opts.xTickText?.[i] ?? String(d.leads[i]);
  const xPrefix = opts.xTickText ? '' : 'Lead ';

  // 1) One Box trace per lead — single shared legend entry for the group.
  let legendShown = false;
  for (let i = 0; i < d.leads.length; i++) {
    const lead = d.leads[i];
    const vals = d.values[i];
    if (!vals || vals.length === 0) continue;
    data.push({
      type: 'box',
      x: vals.map(() => lead),
      y: vals,
      boxpoints: 'all',
      jitter: 0.35,
      pointpos: 0,
      marker: { size: 3, opacity: 0.5, color: lineColor },
      line: { color: lineColor },
      fillcolor: boxFill,
      opacity: 0.7,
      name: opts.membersLabel ?? '51 members (leads 0–15)',
      legendgroup: 'members',
      showlegend: !legendShown,
      hovertemplate:
        `<b>${xPrefix}${xLab(i)}</b>` +
        (d.pairs?.[i] != null ? ` · ${d.pairs[i]} pairs` : '') +
        `<br>${opts.metricLabel}: %{y:${fmt}}<extra></extra>`,
    });
    legendShown = true;
  }

  // Hover labels for the overlay line traces, index-aligned with allLeads.
  const xLabels = d.leads.map((_, i) => xLab(i));

  // 2) Summary stats per lead for the overlays.
  const medians: number[] = [];
  const q25s: number[] = [];
  const q75s: number[] = [];
  const mins: number[] = [];
  const maxs: number[] = [];
  for (let i = 0; i < d.leads.length; i++) {
    const vals = d.values[i];
    if (!vals || vals.length === 0) {
      medians.push(NaN);
      q25s.push(NaN);
      q75s.push(NaN);
      mins.push(NaN);
      maxs.push(NaN);
      continue;
    }
    const sorted = [...vals].sort((a, b) => a - b);
    medians.push(quantile(sorted, 0.5));
    q25s.push(quantile(sorted, 0.25));
    q75s.push(quantile(sorted, 0.75));
    mins.push(sorted[0]);
    maxs.push(sorted[sorted.length - 1]);
  }

  const allLeads = d.leads;

  // 3) Median (black, solid, markers).
  data.push({
    type: 'scatter',
    mode: 'lines+markers',
    x: allLeads,
    y: medians,
    line: { color: 'black', width: 2 },
    marker: { size: 6, color: 'black' },
    name: 'Median',
    customdata: xLabels,
    hovertemplate: `<b>${xPrefix}%{customdata}</b><br>Median: %{y:${fmt}}<extra></extra>`,
  });

  // 4) Q75 (dotted black).
  data.push({
    type: 'scatter',
    mode: 'lines',
    x: allLeads,
    y: q75s,
    line: { color: 'black', width: 1, dash: 'dot' },
    name: 'Q75',
    customdata: xLabels,
    hovertemplate: `<b>${xPrefix}%{customdata}</b><br>Q75: %{y:${fmt}}<extra></extra>`,
  });

  // 5) IQR fill between Q25 and Q75 (light grey, no line).
  data.push({
    type: 'scatter',
    x: [...allLeads, ...[...allLeads].reverse()],
    y: [...q75s, ...[...q25s].reverse()],
    fill: 'toself',
    fillcolor: 'rgba(0, 0, 0, 0.10)',
    line: { width: 0 },
    name: 'IQR',
    showlegend: true,
    hoverinfo: 'skip',
  });

  // 6) Q25 (dotted black).
  data.push({
    type: 'scatter',
    mode: 'lines',
    x: allLeads,
    y: q25s,
    line: { color: 'black', width: 1, dash: 'dot' },
    name: 'Q25',
    customdata: xLabels,
    hovertemplate: `<b>${xPrefix}%{customdata}</b><br>Q25: %{y:${fmt}}<extra></extra>`,
  });

  // 7) Max — hidden by default, toggle via legend.
  data.push({
    type: 'scatter',
    mode: 'lines',
    x: allLeads,
    y: maxs,
    line: { color: 'dimgray', width: 1, dash: 'dash' },
    name: 'Max',
    visible: 'legendonly',
    customdata: xLabels,
    hovertemplate: `<b>${xPrefix}%{customdata}</b><br>Max: %{y:${fmt}}<extra></extra>`,
  });

  // 8) Min — hidden by default, toggle via legend.
  data.push({
    type: 'scatter',
    mode: 'lines',
    x: allLeads,
    y: mins,
    line: { color: 'dimgray', width: 1, dash: 'dashdot' },
    name: 'Min',
    visible: 'legendonly',
    customdata: xLabels,
    hovertemplate: `<b>${xPrefix}%{customdata}</b><br>Min: %{y:${fmt}}<extra></extra>`,
  });

  // 9) Optional zero reference (dashed grey).
  const xMin = allLeads.length > 0 ? Math.min(...allLeads) - 0.5 : -0.5;
  const xMax = allLeads.length > 0 ? Math.max(...allLeads) + 0.5 : 15.5;
  if (opts.zeroLine) {
    data.push({
      type: 'scatter',
      mode: 'lines',
      x: [xMin, xMax],
      y: [0, 0],
      line: { color: 'gray', dash: 'dash', width: 1.5 },
      name: `${opts.metricLabel} = 0`,
      hoverinfo: 'skip',
    });
  }
  if (opts.referenceLines) {
    for (const ref of opts.referenceLines) {
      data.push({
        type: 'scatter',
        mode: 'lines',
        x: [xMin, xMax],
        y: [ref.y, ref.y],
        line: { color: ref.color ?? 'green', dash: ref.dash ?? 'dash', width: 1.5 },
        name: ref.label,
        hoverinfo: 'skip',
      });
    }
  }

  // Step 4: pair counts belong on the plot, not in the reader's head.
  const finitePairs = (d.pairs ?? []).filter((p) => Number.isFinite(p) && p > 0);
  const pairNote =
    finitePairs.length === 0
      ? ''
      : Math.min(...finitePairs) === Math.max(...finitePairs)
        ? `  |  ${finitePairs[0]} pairs per lead`
        : `  |  ${Math.min(...finitePairs)}–${Math.max(...finitePairs)} pairs per lead`;

  // Step 5: never leave a gap unexplained.
  const skippedIdx = (d.skipped ?? [])
    .map((reason, i) => (reason ? i : -1))
    .filter((i) => i >= 0);
  const skipReasons = [...new Set(skippedIdx.map((i) => d.skipped![i]!))];
  const skipNote =
    skippedIdx.length === 0
      ? ''
      : `  |  not computed at ${skippedIdx.length === 1 ? 'lead' : 'leads'} ` +
        skippedIdx.map((i) => xLab(i)).join(', ') +
        ` — ${skipReasons.join('; ')}`;

  const baseTitle = opts.title ?? `${opts.metricLabel} Distribution per Lead Day`;
  const subtitleText = `${opts.subtitle ?? ''}${pairNote}${skipNote}`.replace(/^ {2}\|\s*/, '');
  const titleText = subtitleText ? `${baseTitle}<br><sup>${subtitleText}</sup>` : baseTitle;

  // "n/a" marks sit above each skipped lead so the gap is legible at a glance.
  const skipAnnotations = skippedIdx.map((i) => ({
    x: d.leads[i],
    y: 1.02,
    xref: 'x' as const,
    yref: 'paper' as const,
    text: 'n/a',
    showarrow: false,
    font: { size: 10, color: '#b45309' },
  }));

  const layout: Partial<Layout> = {
    title: { text: titleText, x: 0.5 },
    margin: { l: 60, r: 20, t: 60, b: 50 },
    xaxis: {
      title: { text: opts.xAxisLabel ?? 'Lead Day' },
      // Positions stay numeric so ranges and reference lines work; only the
      // labels change when xTickText is supplied.
      ...(opts.xTickText
        ? { tickmode: 'array' as const, tickvals: allLeads, ticktext: opts.xTickText }
        : { tickmode: 'linear' as const, tick0: 0, dtick: 1 }),
      range: [xMin, xMax],
    },
    yaxis: {
      title: { text: opts.yAxisLabel ?? opts.metricLabel },
      gridcolor: '#eee',
      zeroline: false,
    },
    annotations: skipAnnotations,
    boxmode: 'overlay',
    height: 500,
    legend: { groupclick: 'toggleitem' },
    plot_bgcolor: 'white',
    paper_bgcolor: 'white',
  };

  return { data, layout };
}

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
