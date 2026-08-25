import { describe, expect, it } from 'vitest';
import { dumbbellFigure } from '../../src/plots/dumbbell';
import { divergingBarsFigure } from '../../src/plots/divergingBars';

describe('dumbbellFigure', () => {
  const rows = [
    { label: 'Lead 1', before: -0.38, after: -0.15, pairs: 27 },
    { label: 'Lead 2', before: -0.49, after: -0.16, pairs: 27 },
    { label: 'Lead 3', before: -0.20, after: -0.55, pairs: 27 },
    { label: 'Lead 4', before: Number.NaN, after: -0.24, pairs: 0 },
  ];
  const fig = dumbbellFigure(rows, { metricLabel: "KGE'" });

  it('colours the connector by whether the change helped', () => {
    const lines = fig.data.filter((d) => (d as { mode?: string }).mode === 'lines');
    expect(lines).toHaveLength(3); // the NaN row gets no connector
    // Keyed by label, not index: the figure reverses row order so the chart
    // reads top-to-bottom, which is the opposite of the input order.
    const byLabel = new Map(
      lines.map((d) => {
        const t = d as { y: string[]; line: { color: string } };
        return [t.y[0], t.line.color];
      }),
    );
    expect(byLabel.get('Lead 1')).toBe('#1baf7a'); // -0.38 -> -0.15, improved
    expect(byLabel.get('Lead 3')).toBe('#e34948'); // -0.20 -> -0.55, got worse
  });

  it('respects higherIsBetter when deciding gain direction', () => {
    const lower = dumbbellFigure([{ label: 'a', before: 5, after: 2 }], {
      metricLabel: 'MAE',
      higherIsBetter: false,
    });
    const line = lower.data.find((d) => (d as { mode?: string }).mode === 'lines');
    // 5 -> 2 is an improvement when lower is better.
    expect((line as { line: { color: string } }).line.color).toBe('#1baf7a');
  });

  it('draws connectors before the endpoint markers so dots sit on top', () => {
    const firstMarker = fig.data.findIndex((d) => (d as { mode?: string }).mode === 'markers');
    const lastLine = fig.data.reduce(
      (acc, d, i) => ((d as { mode?: string }).mode === 'lines' ? i : acc),
      -1,
    );
    expect(firstMarker).toBeGreaterThan(lastLine);
  });

  it('states rows it could not compare instead of dropping them', () => {
    const texts = (fig.layout.annotations ?? []).map((a) => String(a.text));
    expect(texts.some((t) => t.includes('raw not scored'))).toBe(true);
  });

  it('counts improvements in the subtitle', () => {
    expect(String(fig.layout.title!.text)).toContain('2 of 3 rows improved');
  });
});

describe('divergingBarsFigure', () => {
  const rows = [
    { label: '06-05', value: -52, n: 51 },
    { label: '06-10', value: 10, n: 51 },
    { label: '06-15', value: 43, n: 50 },
    { label: '06-20', value: Number.NaN, n: 0, detail: 'no member timed a peak' },
  ];
  const fig = divergingBarsFigure(rows, {
    valueLabel: 'Δt_peak (h)',
    negativeLabel: 'early',
    positiveLabel: 'late',
    unit: 'h',
  });

  it('colours by sign', () => {
    const bar = fig.data[0] as { marker: { color: string[] } };
    expect(bar.marker.color).toEqual(['#eb6834', '#eb6834', '#2a78d6']);
  });

  it('keeps the x range symmetric so both sides are comparable', () => {
    const [lo, hi] = fig.layout.xaxis!.range as [number, number];
    // An asymmetric range would make an equal-magnitude late bar look longer
    // than an early one.
    expect(lo).toBeCloseTo(-hi, 10);
    expect(hi).toBeGreaterThan(52);
  });

  it('summarises the split by sign', () => {
    expect(String(fig.layout.title!.text)).toContain('1 early, 2 late');
  });

  it('marks unscored rows rather than plotting them at zero', () => {
    const bar = fig.data[0] as { x: number[] };
    expect(bar.x).toHaveLength(3);
    const texts = (fig.layout.annotations ?? []).map((a) => String(a.text));
    expect(texts.some((t) => t.includes('no member timed a peak'))).toBe(true);
  });
});
