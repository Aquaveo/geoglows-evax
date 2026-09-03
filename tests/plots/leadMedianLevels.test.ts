import { describe, expect, it } from 'vitest';
import { leadMedianLevelsFigure } from '../../src/plots/leadMedianLevels';
import { RP_LINE_COLORS, RP_COLORS } from '../../src/plots/helpers';
import type { LeadMedianRow } from '../../src/lib/floodCheck';

const LEVELS = [2, 5, 10, 25, 50, 100];
const SIM_RP = { 2: 511, 5: 1344, 10: 1895, 25: 2592, 50: 3109, 100: 3622 };

function table(rows: Array<[number, number, number[]]>): { levels: number[]; rows: LeadMedianRow[] } {
  return {
    levels: LEVELS,
    rows: rows.map(([lead, daysCovered, above]) => ({
      lead,
      daysCovered,
      maxLevel: null,
      maxMedian: 1,
      daysAbove: Object.fromEntries(LEVELS.map((l, i) => [l, above[i]])),
    })),
  };
}

const FULL = table([
  [0, 14, [9, 7, 5, 4, 3, 1]],
  [1, 14, [9, 8, 7, 5, 4, 1]],
  [2, 14, [11, 8, 7, 4, 3, 0]],
]);

const named = (f: ReturnType<typeof leadMedianLevelsFigure>, s: string) =>
  f.data.find((t) => String((t as { name?: string }).name).startsWith(s)) as
    | { y: (number | null)[]; line?: { color?: string }; mode?: string }
    | undefined;

describe('leadMedianLevelsFigure', () => {
  it('gives every level a line plus a coverage ceiling', () => {
    const f = leadMedianLevelsFigure(FULL, SIM_RP);
    expect(f.data).toHaveLength(LEVELS.length + 1);
    for (const l of LEVELS) expect(named(f, `${l}-year`)).toBeDefined();
    expect(named(f, 'days the lead reached')).toBeDefined();
  });

  it('names each level with its threshold, so the legend needs no lookup', () => {
    const f = leadMedianLevelsFigure(FULL, SIM_RP);
    const names = f.data.map((t) => (t as { name?: string }).name);
    expect(names).toContain('100-year (3622 m³/s)');
    expect(names).toContain('2-year (511 m³/s)');
  });

  /**
   * A lead that reached no days of the window reported nothing, not zero days
   * above. Emitting 0 would draw the line down to the axis and read as "the
   * median was below every level at this lead", which is a different claim.
   */
  it('emits null for an uncovered lead, not zero', () => {
    const f = leadMedianLevelsFigure(
      table([
        [0, 14, [9, 7, 5, 4, 3, 1]],
        [1, 0, [0, 0, 0, 0, 0, 0]],
      ]),
      SIM_RP,
    );
    expect(named(f, '2-year')!.y).toEqual([9, null]);
    // And the gap must not be bridged, or the chart implies data it lacks.
    const two = f.data.find((t) => String((t as { name?: string }).name).startsWith('2-year')) as
      { connectgaps?: boolean };
    expect(two.connectgaps).toBe(false);
  });

  it('distinguishes a covered lead where nothing crossed from an uncovered one', () => {
    const f = leadMedianLevelsFigure(
      table([
        [0, 14, [0, 0, 0, 0, 0, 0]],
        [1, 0, [0, 0, 0, 0, 0, 0]],
      ]),
      SIM_RP,
    );
    expect(named(f, '2-year')!.y).toEqual([0, null]);
  });

  it('drops the ceiling trace when no lead reached anything', () => {
    const f = leadMedianLevelsFigure(table([[0, 0, [0, 0, 0, 0, 0, 0]]]), SIM_RP);
    expect(named(f, 'days the lead reached')).toBeUndefined();
    expect(f.data).toHaveLength(LEVELS.length);
  });

  /**
   * Descending level order, so the 2-year — always the widest series, since the
   * counts are nested — is drawn last and its markers sit on top rather than
   * under the narrower lines.
   */
  it('draws the levels widest-last', () => {
    const f = leadMedianLevelsFigure(FULL, SIM_RP);
    const order = f.data
      .map((t) => String((t as { name?: string }).name).match(/^(\d+)-year/)?.[1])
      .filter(Boolean)
      .map(Number);
    expect(order).toEqual([100, 50, 25, 10, 5, 2]);
  });

  it('uses the line palette, not the 40%-alpha band palette', () => {
    const f = leadMedianLevelsFigure(FULL, SIM_RP);
    for (const l of LEVELS) {
      const c = named(f, `${l}-year`)!.line?.color;
      expect(c).toBe(RP_LINE_COLORS[l]);
      // A band fill drawn as a 2px stroke is what this guards against: the
      // 2-year band is pure yellow at alpha 0.4, invisible on the surface.
      expect(c).not.toBe(RP_COLORS[l]);
      expect(String(c)).not.toContain('rgba');
    }
  });

  it('scales y to the coverage ceiling, not to the highest count', () => {
    const f = leadMedianLevelsFigure(table([[0, 14, [3, 2, 1, 0, 0, 0]]]), SIM_RP);
    const y = f.layout.yaxis as { range?: number[] };
    // Without this the chart would rescale to 3 and a 3-of-14 day count would
    // fill the panel, reading as though the median was above the level
    // throughout the flood.
    expect(y.range![1]).toBeGreaterThan(14);
  });

  it('keeps lead on a numeric axis so the decay reads as a curve', () => {
    const x = leadMedianLevelsFigure(FULL, SIM_RP).layout.xaxis as { type?: string; dtick?: number };
    expect(x.type).toBe('linear');
    expect(x.dtick).toBe(1);
  });
});
