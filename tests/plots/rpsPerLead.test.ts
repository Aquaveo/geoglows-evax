import { describe, expect, it } from 'vitest';
import { rpsPerLeadFigure } from '../../src/plots/rpsPerLead';
import type { RpsResult } from '../../src/lib/metrics/rps';

const result = (over: Partial<RpsResult> = {}): RpsResult => ({
  leads: [0, 1, 2],
  rps: [0.6, 0.53, 0.51],
  rpsClim: [0.6, 0.54, 0.53],
  rpss: [-0.01, 0.02, 0.04],
  n: [30, 30, 30],
  climatology: [0.99, 0.01],
  skipped: [null, null, null],
  rpssSkipped: [null, null, null],
  exceedances: [3, 3, 3],
  ...over,
});

describe('rpsPerLeadFigure axis direction', () => {
  const fig = rpsPerLeadFigure(result(), { title: 'T' });

  it('captions the RPSS panel with its direction and both endpoints', () => {
    // The top panel says "lower is better"; the bottom needs its own statement
    // or the reader carries the wrong direction down.
    const cap = (fig.layout.annotations ?? []).find((a) =>
      String(a.text).includes('higher is better'),
    )!;
    expect(cap).toBeDefined();
    expect(String(cap.text)).toContain('1');
    expect(String(cap.text)).toContain('matches climatology');
  });

  it('anchors that caption to the RPSS panel, not the figure', () => {
    // A shared legend cannot say which panel an entry describes; the panel's own
    // domain can.
    const cap = (fig.layout.annotations ?? []).find((a) =>
      String(a.text).includes('higher is better'),
    )!;
    expect(cap.xref).toBe('x2 domain');
    expect(cap.yref).toBe('y2 domain');
    // Above the panel, in the gap between the two subplots.
    expect(Number(cap.y)).toBeGreaterThan(1);
  });

  it('keeps the top panel direction on its own axis', () => {
    expect(String(fig.layout.yaxis!.title!.text)).toContain('lower is better');
  });

  it('leaves the RPSS axis title bare, since the caption carries it', () => {
    expect(String(fig.layout.yaxis2!.title!.text)).toBe('RPSS');
  });

  it('adds no legend entry for a mark it never draws', () => {
    // "1 = perfect" as a legend swatch keyed nothing on the plot: the axis
    // cannot reach 1 without flattening every bar.
    // showlegend is undefined on the real series, which means shown.
    const legend = fig.data
      .filter((d) => (d as { showlegend?: boolean }).showlegend !== false)
      .map((d) => String((d as { name?: string }).name));
    expect(legend).not.toContain('1 = perfect');
    expect(legend).not.toContain('0 = climatology');
    // The real series are still there.
    expect(legend.some((n) => n.includes('RPS'))).toBe(true);
  });

  it('explains a withheld RPSS on the panel rather than leaving a gap', () => {
    const withheld = rpsPerLeadFigure(
      result({
        rpss: [Number.NaN, Number.NaN, Number.NaN],
        rpssSkipped: Array(3).fill('no observed exceedance in this window'),
        exceedances: [0, 0, 0],
      }),
      { title: 'T' },
    );
    const texts = (withheld.layout.annotations ?? []).map((a) => String(a.text));
    expect(texts.some((t) => t.includes('RPSS not shown'))).toBe(true);
    expect(String(withheld.layout.title!.text)).toContain('RPSS undefined at 3 leads');
  });
});
