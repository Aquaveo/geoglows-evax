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
    expect(String(fig.layout.yaxis2!.title!.text)).toContain('higher is better');
  });

  it('keeps the RPSS axis title short enough for a third-height panel', () => {
    // A rotated title has only ~175px here; the endpoints live in the legend.
    const t = String(fig.layout.yaxis2!.title!.text);
    expect(t.length).toBeLessThan(26);
    expect(t).not.toContain('perfect');
  });

  it('names both scale endpoints in the legend instead', () => {
    const legend = fig.data
      .filter((d) => (d as { showlegend?: boolean }).showlegend)
      .map((d) => String((d as { name?: string }).name));
    expect(legend).toContain('1 = perfect');
    expect(legend).toContain('0 = climatology');
  });

  it('anchors the legend entries to the RPSS panel and plots no data for them', () => {
    for (const name of ['1 = perfect', '0 = climatology']) {
      const t = fig.data.find((d) => (d as { name?: string }).name === name) as {
        yaxis?: string; x?: unknown[]; hoverinfo?: string;
      };
      expect(t.yaxis).toBe('y2');
      // Nothing is drawn at 1 — extending the axis to reach it would flatten
      // every bar, since single-event RPSS lives near zero.
      expect(t.x).toEqual([null]);
      expect(t.hoverinfo).toBe('skip');
    }
  });

  it('does not also label the zero line inside the plot', () => {
    // At this panel height an in-plot label sat on the leftmost bars.
    const texts = (fig.layout.annotations ?? []).map((a) => String(a.text));
    expect(texts.some((t) => t.includes('climatology'))).toBe(false);
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
