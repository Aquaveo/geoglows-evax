import type { Data, Layout } from 'plotly.js-dist-min';
import type { PerLeadDistribution } from './distributionVsLead';
import { maxOf, minOf } from '../lib/arrayStats';

export interface CombinedSeries {
  name: string;
  color: string;
  dist: PerLeadDistribution;
  /** Shown under the name in the hover, e.g. what 0 means for this metric. */
  note?: string;
}

export interface CategoricalCombinedOptions {
  title?: string;
  subtitle?: string;
  yAxisLabel?: string;
}

const GRID = '#e1e0d9';

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0];
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return lo === hi ? sorted[lo] : sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/**
 * Several categorical scores on one axis, as median lines over IQR bands.
 *
 * Box plots per metric answer "how much do members disagree"; this answers "do
 * these scores agree with each other", which separate panels make surprisingly
 * hard — the reader has to hold one shape in mind while looking at another.
 *
 * It also makes a redundancy visible that separate panels conceal. MCC and HSS
 * are built from the identical numerator and differ only in their denominator:
 * across thousands of synthetic contingency matrices they correlate at 0.99 and
 * never disagree on sign. Two near-identical lines is the honest picture. Two
 * panels imply two independent checks and invite agreement between them to be
 * read as corroboration.
 *
 * Full member distributions stay on the individual panels; this is deliberately
 * a summary, because sixteen leads of overlaid boxes is unreadable.
 */
export function categoricalCombinedFigure(
  series: CombinedSeries[],
  opts: CategoricalCombinedOptions = {},
): { data: Data[]; layout: Partial<Layout> } {
  const data: Data[] = [];
  const allVals: number[] = [];

  for (const s of series) {
    const leads: number[] = [];
    const med: (number | null)[] = [];
    const q1: (number | null)[] = [];
    const q3: (number | null)[] = [];
    const counts: number[] = [];

    s.dist.leads.forEach((lead, i) => {
      const vals = (s.dist.values[i] ?? []).filter(Number.isFinite).sort((a, b) => a - b);
      leads.push(lead);
      counts.push(vals.length);
      if (vals.length === 0) {
        med.push(null);
        q1.push(null);
        q3.push(null);
        return;
      }
      const m = quantile(vals, 0.5);
      const a = quantile(vals, 0.25);
      const b = quantile(vals, 0.75);
      med.push(m);
      q1.push(a);
      q3.push(b);
      allVals.push(a, b, m);
    });

    // Band first so the median line draws over it. Upper edge fills down to the
    // lower edge, so the two traces must stay adjacent.
    data.push(
      {
        type: 'scatter',
        mode: 'lines',
        x: leads,
        y: q1,
        line: { width: 0, color: s.color },
        showlegend: false,
        hoverinfo: 'skip',
        connectgaps: false,
      },
      {
        type: 'scatter',
        mode: 'lines',
        x: leads,
        y: q3,
        line: { width: 0, color: s.color },
        fill: 'tonexty',
        fillcolor: rgba(s.color, 0.16),
        showlegend: false,
        hoverinfo: 'skip',
        connectgaps: false,
      },
      {
        type: 'scatter',
        mode: 'lines+markers',
        x: leads,
        y: med,
        name: s.name,
        line: { color: s.color, width: 2.2 },
        marker: { size: 6, color: s.color, line: { color: '#fcfcfb', width: 1.4 } },
        customdata: leads.map((_, i) => [counts[i], q1[i] ?? Number.NaN, q3[i] ?? Number.NaN] as [number, number, number]),
        hovertemplate:
          `<b>${s.name}</b>${s.note ? ` — ${s.note}` : ''}` +
          '<br>lead %{x}: median %{y:.3f}' +
          '<br>IQR %{customdata[1]:.3f} to %{customdata[2]:.3f}' +
          '<br>%{customdata[0]} members<extra></extra>',
        connectgaps: false,
      },
    );
  }

  const lo = Math.min(0, minOf(allVals, 0));
  const hi = Math.max(1, maxOf(allVals, 1));
  const pad = (hi - lo) * 0.06;

  const layout: Partial<Layout> = {
    title: {
      text: `${opts.title ?? 'Categorical scores by lead day'}<br><sup>${opts.subtitle ?? ''}</sup>`,
      x: 0.5,
    },
    margin: { l: 66, r: 24, t: 64, b: 56 },
    xaxis: {
      title: { text: 'Lead Day' },
      tickmode: 'linear',
      tick0: 0,
      dtick: 1,
      gridcolor: GRID,
    },
    yaxis: {
      title: { text: opts.yAxisLabel ?? 'Score' },
      range: [lo - pad, hi + pad],
      gridcolor: GRID,
      zeroline: true,
      zerolinecolor: '#52514e',
      zerolinewidth: 1.5,
    },
    legend: { orientation: 'h', y: -0.16 },
    hovermode: 'x unified',
    plot_bgcolor: '#fcfcfb',
    paper_bgcolor: '#fcfcfb',
  };

  return { data, layout };
}
