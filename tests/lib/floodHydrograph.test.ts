import { describe, expect, it } from 'vitest';
import { medianSeries, crestOfRun, levelOf } from '../../src/lib/floodCheck';
import { floodHydrographFigure } from '../../src/plots/floodHydrograph';
import type { ForecastRun } from '../../src/lib/types';

const SIM_RP = { 2: 100, 5: 200, 10: 300, 25: 400, 50: 500, 100: 600 };

function run(startUtc: number, values: number[][]): ForecastRun {
  const time = values[0].map((_, i) => new Date(startUtc + i * 3 * 3600 * 1000));
  return { time, discharge: values };
}

describe('medianSeries / crestOfRun', () => {
  it('takes the median across members, not the mean or the max', () => {
    // One runaway member must not move the median.
    const r = run(Date.UTC(2026, 0, 1), [
      [10, 10, 10],
      [20, 20, 20],
      [30, 30, 30],
      [40, 40, 40],
      [9999, 9999, 9999],
    ]);
    expect(medianSeries(r).median).toEqual([30, 30, 30]);
  });

  it('averages the middle pair for an even member count', () => {
    const r = run(Date.UTC(2026, 0, 1), [[10], [20], [30], [50]]);
    expect(medianSeries(r).median).toEqual([25]);
  });

  it('ignores non-finite values rather than poisoning the median', () => {
    const r = run(Date.UTC(2026, 0, 1), [[10], [Number.NaN], [30]]);
    expect(medianSeries(r).median).toEqual([20]);
    // A step where every member is missing stays NaN, not 0 — a gap is not a
    // reading of zero flow.
    const empty = run(Date.UTC(2026, 0, 1), [[Number.NaN], [Number.NaN]]);
    expect(Number.isNaN(empty.discharge[0][0])).toBe(true);
    expect(Number.isNaN(medianSeries(empty).median[0])).toBe(true);
  });

  it('crests on the median, so one early member cannot move the peak day', () => {
    // Member 0 peaks at step 0; the bulk of the ensemble peaks at step 2.
    const r = run(Date.UTC(2026, 0, 1), [
      [9999, 10, 10],
      [10, 20, 300],
      [10, 20, 300],
      [10, 20, 300],
      [10, 20, 300],
    ]);
    const c = crestOfRun(r, 0, Number.MAX_SAFE_INTEGER)!;
    expect(c.value).toBe(300);
    expect(c.time.toISOString()).toBe(new Date(Date.UTC(2026, 0, 1) + 2 * 3 * 3600 * 1000).toISOString());
  });

  it('confines the crest search to the requested span', () => {
    const t0 = Date.UTC(2026, 0, 1);
    const r = run(t0, [[500, 10, 10], [500, 10, 10]]);
    // Excluding the first step leaves only the low values.
    const c = crestOfRun(r, t0 + 3 * 3600 * 1000, t0 + 9 * 3600 * 1000)!;
    expect(c.value).toBe(10);
  });

  it('returns null when nothing falls inside the span', () => {
    const r = run(Date.UTC(2026, 0, 1), [[1, 2, 3]]);
    expect(crestOfRun(r, Date.UTC(2030, 0, 1), Date.UTC(2030, 0, 2))).toBe(null);
  });
});

describe('levelOf', () => {
  it('reports the highest level reached, and null below the 2-year', () => {
    expect(levelOf(99, SIM_RP)).toBe(null);
    expect(levelOf(100, SIM_RP)).toBe(2);
    expect(levelOf(350, SIM_RP)).toBe(10);
    expect(levelOf(10_000, SIM_RP)).toBe(100);
  });

  it('skips levels the fit did not produce', () => {
    expect(levelOf(10_000, { 2: 100, 5: 200 })).toBe(5);
  });
});

describe('floodHydrographFigure', () => {
  const forecasts = new Map<string, ForecastRun>([
    ['20260101', run(Date.UTC(2026, 0, 1), Array.from({ length: 5 }, () => [10, 50, 120]))],
    ['20260102', run(Date.UTC(2026, 0, 2), Array.from({ length: 5 }, () => [20, 250, 80]))],
  ]);
  const base = {
    selectedInit: '20260102',
    eventStart: new Date(Date.UTC(2026, 0, 2)),
    eventEnd: new Date(Date.UTC(2026, 0, 3)),
    toleranceDays: 1,
  };

  /**
   * The window shading must be paper-referenced on y.
   *
   * plotly.js includes data-coordinate shapes in autorange, so a full-height
   * band given in data coordinates would hold the y-axis open at whatever
   * height it was handed — the same trap that made the return-period bands
   * traces rather than shapes elsewhere in this codebase.
   */
  it('shades the event window without joining the y-autorange', () => {
    const f = floodHydrographFigure(forecasts, SIM_RP, base);
    const shapes = f.layout.shapes ?? [];
    expect(shapes.length).toBeGreaterThan(0);
    for (const sh of shapes) {
      expect(sh.yref).toBe('paper');
      expect(sh.y0).toBe(0);
      expect(sh.y1).toBe(1);
    }
  });

  it('marks the crest of the selected run only', () => {
    const f = floodHydrographFigure(forecasts, SIM_RP, base);
    const crest = f.data.find((t) => (t as { name?: string }).name === 'forecast crest (median)') as
      | { x: Date[]; y: number[] }
      | undefined;
    expect(crest).toBeDefined();
    // 20260102's median peaks at 250 on its second step.
    expect(crest!.y[0]).toBe(250);
  });

  it('degrades to context lines when the selected run is absent', () => {
    const f = floodHydrographFigure(forecasts, SIM_RP, { ...base, selectedInit: 'nope' });
    expect(f.data.find((t) => (t as { name?: string }).name === 'forecast crest (median)')).toBeUndefined();
    // Still renders the other runs rather than throwing or emptying out.
    expect(f.data.some((t) => (t as { name?: string }).name === 'other runs (median)')).toBe(true);
  });

  it('shows one legend entry for the whole context group', () => {
    const f = floodHydrographFigure(forecasts, SIM_RP, base);
    const ctx = f.data.filter((t) => (t as { name?: string }).name === 'other runs (median)');
    expect(ctx.length).toBeGreaterThan(0);
    expect(ctx.filter((t) => (t as { showlegend?: boolean }).showlegend === true)).toHaveLength(1);
  });

  it('clips the retrospective to the plotted span', () => {
    const retro = {
      time: [new Date(Date.UTC(2020, 0, 1)), new Date(Date.UTC(2026, 0, 2)), new Date(Date.UTC(2030, 0, 1))],
      values: [7, 42, 9],
    };
    const f = floodHydrographFigure(forecasts, SIM_RP, { ...base, retro });
    const t = f.data.find((x) => String((x as { name?: string }).name).startsWith('retrospective')) as
      | { x: Date[]; y: number[] }
      | undefined;
    expect(t).toBeDefined();
    // The 2020 and 2030 points would stretch the x-axis across a decade.
    expect(t!.y).toEqual([42]);
  });
});
