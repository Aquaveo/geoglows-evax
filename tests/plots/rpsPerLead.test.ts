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

  it('states the direction on BOTH axes, since they disagree', () => {
    // The top panel saying "lower is better" while the bottom said only "RPSS"
    // made the lower panel read as if lower were better there too.
    expect(String(fig.layout.yaxis!.title!.text)).toContain('lower is better');
    const rpss = String(fig.layout.yaxis2!.title!.text);
    expect(rpss).toContain('higher is better');
    expect(rpss).toContain('1 = perfect');
  });

  it('names the RPSS zero line, which is the panel\'s whole reference point', () => {
    const texts = (fig.layout.annotations ?? []).map((a) => String(a.text));
    expect(texts.some((t) => t.includes('no better than climatology'))).toBe(true);
  });

  it('anchors that label to the RPSS panel at zero', () => {
    const zero = (fig.layout.annotations ?? []).find((a) =>
      String(a.text).includes('no better than climatology'),
    )!;
    expect(zero.yref).toBe('y2');
    expect(zero.y).toBe(0);
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
