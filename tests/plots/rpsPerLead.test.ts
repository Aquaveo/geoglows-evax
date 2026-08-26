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

  it('keeps the top panel direction on its own axis', () => {
    expect(String(fig.layout.yaxis!.title!.text)).toContain('lower is better');
  });

  it('states the RPSS direction on its own axis', () => {
    // Both panels name their direction, because they disagree and a single
    // labelled panel is worse than neither.
    expect(String(fig.layout.yaxis2!.title!.text)).toBe('RPSS — higher is better');
  });

  it('adds no caption or in-plot label for the scale', () => {
    // Only the withheld-RPSS notice may appear here.
    const texts = (fig.layout.annotations ?? []).map((a) => String(a.text));
    expect(texts.some((t) => t.includes('higher is better'))).toBe(false);
    expect(texts.some((t) => t.includes('climatology'))).toBe(false);
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
