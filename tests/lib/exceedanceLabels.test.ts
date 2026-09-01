import { describe, expect, it } from 'vitest';
import { categoryLabels, exceedanceLabels } from '../../src/lib/metrics/contingency';

describe('exceedanceLabels', () => {
  it('names the dichotomisation, not the band', () => {
    // The distinction the audit caught: row k of the per-threshold table is
    // "at or above level k", which INCLUDES every band above k. Labelling it
    // "2–5yr" claims it excludes the 100-year days, which it does not.
    expect(exceedanceLabels(100)).toEqual([
      '<2yr', '≥2yr', '≥5yr', '≥10yr', '≥25yr', '≥50yr', '≥100yr',
    ]);
    expect(categoryLabels(100)).toEqual([
      '<2yr', '2–5yr', '5–10yr', '10–25yr', '25–50yr', '50–100yr', '≥100yr',
    ]);
  });

  it('stays in step with the category ladder at every eventRp', () => {
    for (const rp of [0, 2, 5, 10, 25, 50, 100]) {
      expect(exceedanceLabels(rp)).toHaveLength(categoryLabels(rp).length);
    }
  });

  it('agrees with the band label only at the top, where the two coincide', () => {
    const ex = exceedanceLabels(10);
    const band = categoryLabels(10);
    expect(ex).toEqual(['<2yr', '≥2yr', '≥5yr', '≥10yr']);
    // Last row is the same set either way; the middle rows are where band
    // labels were naming the wrong thing.
    expect(ex[ex.length - 1]).toBe(band[band.length - 1]);
    expect(ex[1]).not.toBe(band[1]);
  });

  it('survives the UI strip that assumes an exceedance label', () => {
    // MetricsTab renders `at or above {label.replace('≥','')}`, which was a
    // no-op on a band label and produced "at or above 2–5yr".
    expect(exceedanceLabels(25).slice(1).map((l) => `at or above ${l.replace('≥', '')}`)).toEqual([
      'at or above 2yr', 'at or above 5yr', 'at or above 10yr', 'at or above 25yr',
    ]);
  });
});
