import type { Data } from 'plotly.js-dist-min';
import type { RpThresholds } from '../lib/types';

const RP_ORDER = [2, 5, 10, 25, 50, 100];

/** Notebook's return-period color palette (pygeoglows _plots/format_tools.py). */
export const RP_COLORS: Record<number, string> = {
  2: 'rgba(254, 240, 1, 0.4)',
  5: 'rgba(253, 154, 1, 0.4)',
  10: 'rgba(255, 56, 5, 0.4)',
  25: 'rgba(255, 0, 0, 0.4)',
  50: 'rgba(128, 0, 106, 0.4)',
  100: 'rgba(128, 0, 246, 0.4)',
};

/**
 * Color for a lead-day trace: blue at lead 0 through red at `maxLead`, so
 * forecast degradation with lead time reads off the palette directly.
 */
export function leadColor(lead: number, maxLead: number): string {
  const t = maxLead > 0 ? Math.min(Math.max(lead / maxLead, 0), 1) : 0;
  // #2166ac (short lead) → #b2182b (long lead), linear in RGB.
  const from = [33, 102, 172];
  const to = [178, 24, 43];
  const [r, g, b] = from.map((c, i) => Math.round(c + (to[i] - c) * t));
  return `rgb(${r}, ${g}, ${b})`;
}

/** One labelled set of return-period thresholds to draw as bands. */
export interface RpBandGroup {
  /** Provenance shown in the legend, e.g. "observed" or "simulated". */
  label: string;
  rp: RpThresholds;
  /** Drawn on load; otherwise starts collapsed to a legend entry. */
  defaultVisible?: boolean;
}

/**
 * Return-period bands as filled *traces* rather than layout shapes.
 *
 * This is deliberate. plotly.js includes data-coordinate shapes in autorange
 * (verified: hiding a large trace behind a shape whose top was sized from that
 * trace's maximum leaves the y-axis pinned at the shape's top). Traces are
 * excluded from autorange once hidden, so drawing the bands this way lets the
 * y-axis actually rescale when a series is toggled off — and gives each band
 * set a legend entry naming which return periods it came from, which a shape
 * cannot have.
 *
 * The topmost band of each group is tagged `meta.rpTopBand` so `<Plot>` can
 * stretch it to the top of the visible data — it is deliberately NOT sized from
 * the data here, because a band sized off a series that later gets hidden is
 * precisely what pins the axis.
 */
export function rpBandTraces(
  groups: RpBandGroup[],
  xMin: Date,
  xMax: Date,
): Data[] {
  const traces: Data[] = [];
  const x0 = xMin.toISOString();
  const x1 = xMax.toISOString();

  for (const group of groups) {
    const visible: true | 'legendonly' = group.defaultVisible === false ? 'legendonly' : true;
    const legendgroup = `rp-${group.label}`;
    let legendShown = false;

    const levels = RP_ORDER.filter((rp) => Number.isFinite(group.rp[rp]));

    for (let i = 0; i < levels.length; i++) {
      const rpYears = levels[i];
      const lower = group.rp[rpYears];
      const isTop = i === levels.length - 1;
      // The top band is a placeholder height here; <Plot> stretches it to the
      // top of the visible data once the axis range is known.
      const upper = isTop ? lower * 1.05 : group.rp[levels[i + 1]];

      traces.push({
        type: 'scatter',
        mode: 'lines',
        x: [x0, x1, x1, x0, x0],
        y: [lower, lower, upper, upper, lower],
        fill: 'toself',
        fillcolor: RP_COLORS[rpYears],
        line: { width: 0 },
        hoverinfo: 'skip',
        name: `Return periods (${group.label})`,
        legendgroup,
        showlegend: !legendShown,
        visible,
        ...(isTop ? { meta: { rpTopBand: true, lower } } : {}),
      });
      legendShown = true;
    }
  }
  return traces;
}

// Re-export Plotly namespace as a value-less alias for typing convenience.
import type * as Plotly from 'plotly.js-dist-min';
export type { Plotly };
