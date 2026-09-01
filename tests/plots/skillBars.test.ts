import { describe, expect, it } from 'vitest';
import { skillBarsFigure } from '../../src/plots/skillBars';
import type { SkillRow } from '../../src/lib/metrics/skillSummary';

const row = (label: string, nse: number, kge: number, extra: Partial<SkillRow> = {}): SkillRow => ({
  label, nse, kge, pairs: 40, members: 51, nseMembers: 51, kgeMembers: 51, ...extra,
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

  it('names each metric\'s own benchmark, at its own value', () => {
    const all = texts(fig).join(' | ');
    // NSE is normalised by observed variance, so its mean-flow benchmark is 0;
    // KGE' is not, so its is -0.41. Colouring both off one number was the bug.
    expect(all).toContain('observed mean (0)');
    expect(all).toContain('observed mean (-0.41)');
  });

  it('draws a line at every band boundary, per panel', () => {
    const shapes = fig.layout.shapes ?? [];
    const nse = shapes.filter((sh) => sh.xref === 'x').map((sh) => Number(sh.x0)).sort((a, b) => a - b);
    const kge = shapes.filter((sh) => sh.xref === 'x2').map((sh) => Number(sh.x0)).sort((a, b) => a - b);
    expect(nse).toEqual([0, 0.5, 0.75]);
    expect(kge).toEqual([-0.41, 0, 0.5, 0.75]);
  });

  it('dots the benchmark and dashes the rest, per panel', () => {
    const shapes = fig.layout.shapes ?? [];
    const dashOf = (xref: string, x: number) =>
      shapes.find((sh) => sh.xref === xref && Number(sh.x0) === x)?.line?.dash;
    expect(dashOf('x', 0)).toBe('dot');
    expect(dashOf('x', 0.5)).toBe('dash');
    expect(dashOf('x2', -0.41)).toBe('dot');
    expect(dashOf('x2', 0)).toBe('dash');
  });

  it('colours each metric against its own bands', () => {
    // A KGE' of -0.2 beats the observed mean and must NOT read the same as an
    // NSE of -0.2, which does not. One shared scale was the defect.
    const f = skillBarsFigure([row('r', -0.2, -0.2)], { categoryLabel: 'x' });
    const bars = f.data.filter((d) => (d as { type?: string }).type === 'bar');
    const nseColor = (bars[0] as { marker: { color: string[] } }).marker.color[0];
    const kgeColor = (bars[1] as { marker: { color: string[] } }).marker.color[0];
    expect(nseColor).not.toBe(kgeColor);
  });

  it('names the category in the hover, since the colours are not CVD-safe', () => {
    const bars = fig.data.filter((d) => (d as { type?: string }).type === 'bar');
    for (const b of bars.slice(0, 2)) {
      expect(String((b as { hovertemplate?: string }).hovertemplate)).toContain('customdata[3]');
    }
    const cd = (bars[1] as { customdata: unknown[][] }).customdata;
    expect(cd.some((row) => row[3] === 'Unacceptable')).toBe(true);
  });

  it('splits the legend per metric and titles each group', () => {
    const entries = fig.data.filter((d) => (d as { showlegend?: boolean }).showlegend) as {
      name?: string; legendgroup?: string; legendgrouptitle?: { text?: string };
    }[];
    const groups = new Set(entries.map((e) => e.legendgroup));
    expect(groups).toEqual(new Set(['nse', 'kge']));
    const titles = entries.map((e) => String(e.legendgrouptitle?.text));
    expect(titles.some((t) => t.includes('NSE') && t.includes('0'))).toBe(true);
    expect(titles.some((t) => t.includes('KGE') && t.includes('-0.41'))).toBe(true);
  });

  it('prints each metric OWN ranges, which one shared legend could not', () => {
    const nameOf = (group: string) =>
      fig.data
        .filter((d) => (d as { legendgroup?: string }).legendgroup === group)
        .map((d) => String((d as { name?: string }).name));
    const nse = nameOf('nse').join(' | ');
    const kge = nameOf('kge').join(' | ');
    // NSE bottoms out at its own benchmark, 0, with no Very poor band.
    expect(nse).toContain('Unacceptable');
    expect(nse).toContain('≤ 0.00');
    expect(nse).not.toContain('Very poor');
    // KGE' has the extra band down to -0.41.
    expect(kge).toContain('Very poor');
    expect(kge).toContain('≤ -0.41');
    // Shared upper boundaries still read the same on both.
    expect(nse).toContain('> 0.75');
    expect(kge).toContain('> 0.75');
  });

  it('uses a different hue family per metric, so a colour cannot be misread across panels', () => {
    const colorsOf = (group: string) =>
      fig.data
        .filter((d) => (d as { legendgroup?: string }).legendgroup === group)
        .map((d) => (d as { marker: { color: string } }).marker.color);
    const nse = new Set(colorsOf('nse'));
    const kge = new Set(colorsOf('kge'));
    expect(nse.size).toBe(4);
    expect(kge.size).toBe(5);
    // No colour appears in both classifications.
    for (const c of nse) expect(kge.has(c)).toBe(false);
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
