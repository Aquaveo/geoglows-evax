import { describe, expect, it } from 'vitest';
import { exceedanceGridFigure } from '../../src/plots/exceedanceGrid';
import type { ExceedanceGrid } from '../../src/lib/floodCheck';

const LEVELS = [2, 5, 10, 25, 50, 100];

/** A grid whose column keys are YYYYMMDD — the shape that broke rendering. */
function gridWithDateKeys(n: number): ExceedanceGrid {
  const columns = Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2025, 11, 28) + i * 86400000);
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(
      d.getUTCDate(),
    ).padStart(2, '0')}`;
  });
  return {
    levels: LEVELS,
    columns,
    grid: LEVELS.map((_, r) =>
      columns.map((_, c) => ({ share: Math.min(100, c * 5 + r) / 100, crossed: 1, total: 51 })),
    ),
  };
}

describe('exceedanceGridFigure', () => {
  /**
   * Annotation coordinates must be category INDICES, never category names.
   *
   * Plotly coerces a numeric-looking annotation coordinate to a number even when
   * that exact string is a registered category. With x: "20251228" the x-axis
   * autorange came back [-0.5, 20315172.67] instead of [-0.5, 21.5], one tick
   * label was drawn instead of 22, and the heatmap raster was never emitted —
   * a blank panel. Measured in jsdom against plotly.js-dist-min.
   *
   * The y-axis never showed it because "2-year" cannot be coerced, and the
   * by-lead grid escaped it by accident because its keys ("0".."15") already
   * equal their own indices. Only the by-initialisation grid broke, which is
   * why a spec-shape test is worth having: nothing about the numbers looks
   * wrong, and the failure is entirely in how plotly reads them.
   */
  it('positions annotations by index, so numeric column keys cannot blow up the axis', () => {
    const g = gridWithDateKeys(22);
    const fig = exceedanceGridFigure(g, { columnLabel: 'issued' });
    const ann = fig.layout.annotations ?? [];
    expect(ann.length).toBeGreaterThan(0);
    for (const a of ann) {
      expect(typeof a.x).toBe('number');
      expect(typeof a.y).toBe('number');
      expect(a.x as number).toBeGreaterThanOrEqual(0);
      expect(a.x as number).toBeLessThan(g.columns.length);
      expect(a.y as number).toBeGreaterThanOrEqual(0);
      expect(a.y as number).toBeLessThan(g.levels.length);
    }
  });

  it('labels every column rather than letting plotly thin the ticks', () => {
    const g = gridWithDateKeys(22);
    const x = fig(g).layout.xaxis as { tickmode?: string; tickvals?: number[]; ticktext?: string[] };
    expect(x.tickmode).toBe('array');
    expect(x.tickvals).toEqual(Array.from({ length: 22 }, (_, i) => i));
    expect(x.ticktext).toEqual(g.columns);
  });

  it('applies formatColumn to the axis labels and the trace, together', () => {
    const g = gridWithDateKeys(3);
    const pretty = (k: string) => `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`;
    const f = exceedanceGridFigure(g, { columnLabel: 'issued', formatColumn: pretty });
    const trace = f.data[0] as unknown as { x: string[] };
    const x = f.layout.xaxis as { ticktext?: string[] };
    // Both must be the formatted labels: the trace defines the categories, so a
    // mismatch would register two sets and put the ticks on the wrong cells.
    expect(trace.x).toEqual(['2025-12-28', '2025-12-29', '2025-12-30']);
    expect(x.ticktext).toEqual(trace.x);
  });

  it('emits null, not NaN, for a column with no data', () => {
    const g = gridWithDateKeys(2);
    g.grid = g.levels.map(() => [
      { share: Number.NaN, crossed: 0, total: 0 },
      { share: 0.5, crossed: 25, total: 51 },
    ]);
    const z = (exceedanceGridFigure(g, { columnLabel: 'issued' }).data[0] as unknown as {
      z: (number | null)[][];
    }).z;
    // NaN reaching plotly renders as a filled cell at the scale minimum, which
    // would read as "no members crossed" instead of "no forecast here".
    expect(z.every((row) => row[0] === null)).toBe(true);
    expect(z.every((row) => row[1] === 50)).toBe(true);
  });
});

function fig(g: ExceedanceGrid) {
  return exceedanceGridFigure(g, { columnLabel: 'issued' });
}
