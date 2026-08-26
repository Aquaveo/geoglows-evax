import { describe, expect, it } from 'vitest';
import { skillBarsFigure } from '../../src/plots/skillBars';
import type { SkillRow } from '../../src/lib/metrics/skillSummary';

const row = (label: string, nse: number, kge: number, extra: Partial<SkillRow> = {}): SkillRow => ({
  label, nse, kge, pairs: 40, members: 51, ...extra,
});

const texts = (fig: ReturnType<typeof skillBarsFigure>) =>
  (fig.layout.annotations ?? []).map((a) => String(a.text));

describe('skillBarsFigure labelling', () => {
  const rows = [row('2026-06-03', -16.8, -9.2), row('2026-06-24', 0.62, 0.71)];
  const fig = skillBarsFigure(rows, { categoryLabel: 'Initialized (UTC)', title: 'T' });

  it('names both panels at the TOP, not only on the x-axis', () => {
    // The chart sizes itself from its row count, so with one row per forecast run
    // the x-axis title can sit hundreds of pixels below the first row. A reader
    // starting at the top needs the column named there.
    const top = (fig.layout.annotations ?? []).filter(
      (a) => a.yref === 'paper' && Number(a.y) > 1,
    );
    expect(top.map((a) => String(a.text))).toContain('<b>NSE</b>');
    expect(top.map((a) => String(a.text))).toContain("<b>KGE'</b>");
  });

  it('still sets the x-axis titles', () => {
    expect(fig.layout.xaxis!.title).toMatchObject({ text: 'NSE' });
    expect(fig.layout.xaxis2!.title).toMatchObject({ text: "KGE'" });
  });

  it('names the reference lines instead of leaving bare dashes', () => {
    const all = texts(fig).join(' | ');
    expect(all).toContain('no better than the observed mean');
    expect(all).toContain('observed mean (-0.41)');
    expect(all).toContain('usable (0.5)');
    // One "usable" marker per panel.
    expect(texts(fig).filter((t) => t.includes('usable (0.5)'))).toHaveLength(2);
  });

  it('labels a clamped bar with its true value, in white so it is legible', () => {
    // The bar is drawn to the floor and coloured red; a red label on it was
    // invisible against its own background.
    const clamped = (fig.layout.annotations ?? []).filter((a) =>
      String(a.text).startsWith('◄'),
    );
    expect(clamped.map((a) => String(a.text))).toEqual(
      expect.arrayContaining(['◄ -16.8', '◄ -9.2']),
    );
    expect(clamped.every((a) => a.font?.color === '#ffffff')).toBe(true);
  });

  it('says in the subtitle how many rows ran off the floor', () => {
    expect(String(fig.layout.title!.text)).toContain('1 row below -1');
  });

  it('grows with the row count so tall charts are not clipped', () => {
    const short = skillBarsFigure([row('a', 0.5, 0.5)], { categoryLabel: 'x' });
    const long = skillBarsFigure(
      Array.from({ length: 31 }, (_, i) => row(`r${i}`, 0.5, 0.5)),
      { categoryLabel: 'x' },
    );
    expect(long.layout.height!).toBeGreaterThan(short.layout.height!);
    // The container follows layout.height, so this is what stops the x-axis
    // being cut off on a 31-run chart.
    expect(long.layout.height!).toBeGreaterThan(800);
  });

  it('marks an unscored row n/a rather than drawing it at zero', () => {
    const f = skillBarsFigure(
      [row('2026-06-01', Number.NaN, Number.NaN, { pairs: 0, members: 0, skipped: 'only 0 timesteps overlapping the event' })],
      { categoryLabel: 'x' },
    );
    expect(texts(f).some((t) => t.includes('n/a'))).toBe(true);
    expect(texts(f).some((t) => t.includes('only 0 timesteps'))).toBe(true);
  });

  it('leaves room at the top for the headers it adds', () => {
    expect(Number(fig.layout.margin!.t)).toBeGreaterThanOrEqual(100);
  });
});
