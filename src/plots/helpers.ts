import type { RpThresholds } from '../lib/types';

/** Notebook's return-period color palette (pygeoglows _plots/format_tools.py). */
export const RP_COLORS: Record<number, string> = {
  2: 'rgba(254, 240, 1, 0.4)',
  5: 'rgba(253, 154, 1, 0.4)',
  10: 'rgba(255, 56, 5, 0.4)',
  25: 'rgba(255, 0, 0, 0.4)',
  50: 'rgba(128, 0, 106, 0.4)',
  100: 'rgba(128, 0, 246, 0.4)',
};

/** Add return-period horizontal bands as Plotly shape rectangles. */
export function rpBandShapes(rp: RpThresholds, xMin: Date, xMax: Date, yCeiling: number) {
  const ordered = [2, 5, 10, 25, 50, 100];
  const shapes: Partial<Plotly.Shape>[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const lower = rp[ordered[i]];
    const upperRp = ordered[i + 1];
    const upper = upperRp ? rp[upperRp] : Math.max(yCeiling, lower * 1.05);
    if (!Number.isFinite(lower)) continue;
    shapes.push({
      type: 'rect',
      xref: 'x',
      yref: 'y',
      x0: xMin.toISOString(),
      x1: xMax.toISOString(),
      y0: lower,
      y1: upper,
      fillcolor: RP_COLORS[ordered[i]],
      line: { width: 0 },
      layer: 'below',
    });
  }
  return shapes;
}

// Re-export Plotly namespace as a value-less alias for typing convenience.
import type * as Plotly from 'plotly.js-dist-min';
export type { Plotly };
