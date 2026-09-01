import { describe, expect, it } from 'vitest';
import { categoricalCombinedFigure } from '../../src/plots/categoricalCombined';
import type { PerLeadDistribution } from '../../src/plots/distributionVsLead';

const dist = (): PerLeadDistribution => ({
  leads: [0, 1, 2],
  values: [
    [0.1, 0.2, 0.3],
    [0.2, 0.3, 0.4],
    [0.3, 0.4, 0.5],
  ],
  pairs: [30, 30, 30],
  skipped: [null, null, null],
});

const fig = categoricalCombinedFigure(
  [
    { name: 'MCC', color: '#2a78d6', dist: dist() },
    { name: 'HSS', color: '#eb6834', dist: dist() },
  ],
  { title: 'T', subtitle: 'S', yAxisLabel: 'Score — 1 is perfect, 0 is no better than chance' },
);

describe('categoricalCombinedFigure', () => {
  it('keeps the hover to values, not scale facts', () => {
    // "0 = chance" appended after the series name read as part of the name and
    // repeated on every row. It is a property of the axis, not of a data point.
    const hovers = fig.data
      .map((d) => String((d as { hovertemplate?: string }).hovertemplate ?? ''))
      .filter(Boolean);
    expect(hovers.length).toBeGreaterThan(0);
    for (const h of hovers) {
      expect(h).not.toContain('chance');
      expect(h).not.toContain('—');
    }
  });

  it('says what zero means once, on the chart', () => {
    const texts = (fig.layout.annotations ?? []).map((a) => String(a.text));
    expect(texts).toContain('0 = no better than chance');
    const zero = (fig.layout.annotations ?? []).find((a) =>
      String(a.text).includes('no better than chance'),
    )!;
    expect(zero.y).toBe(0);
    expect(zero.yref).toBe('y');
  });

  it('carries the direction on the axis title', () => {
    const t = String(fig.layout.yaxis!.title!.text);
    expect(t).toContain('1 is perfect');
    expect(t).toContain('0 is no better than chance');
  });

  it('still names each series in its own hover', () => {
    const hovers = fig.data
      .map((d) => String((d as { hovertemplate?: string }).hovertemplate ?? ''))
      .filter(Boolean);
    expect(hovers.some((h) => h.includes('MCC'))).toBe(true);
    expect(hovers.some((h) => h.includes('HSS'))).toBe(true);
  });
});
