import { describe, expect, it } from 'vitest';
import { computeCsi } from '../../src/lib/metrics/csi';
import { computeMcc } from '../../src/lib/metrics/mcc';
import { computeHss } from '../../src/lib/metrics/hss';

describe('computeCsi', () => {
  it('is hits / (hits + false alarms + misses)', () => {
    // rows = observed category, cols = forecast category, threshold at 1.
    // hits 8, false alarms 4, misses 6, correct negatives 100.
    const m = [
      [100, 4],
      [6, 8],
    ];
    expect(computeCsi(m)).toBeCloseTo(8 / (8 + 4 + 6), 12);
  });

  it('does NOT move when correct negatives are added — the whole point', () => {
    // Start with FEW correct negatives: MCC converges as they grow, so a base
    // that already has hundreds is past most of the movement.
    const base = [
      [10, 4],
      [6, 8],
    ];
    const padded = [
      [10_000, 4],
      [6, 8],
    ];
    expect(computeCsi(padded)).toBeCloseTo(computeCsi(base), 12);
    // MCC and HSS both do move, which is why CSI is reported beside them.
    expect(Math.abs(computeMcc(padded) - computeMcc(base))).toBeGreaterThan(0.2);
    expect(Math.abs(computeHss(padded) - computeHss(base))).toBeGreaterThan(0.2);
  });

  it('collapses a multi-category matrix at the threshold', () => {
    // 3 categories, threshold 1: categories 1 and 2 are both "event".
    const m = [
      [50, 2, 1],
      [3, 6, 2],
      [1, 2, 5],
    ];
    const hits = 6 + 2 + 2 + 5;
    const fa = 2 + 1;
    const miss = 3 + 1;
    expect(computeCsi(m, 1)).toBeCloseTo(hits / (hits + fa + miss), 12);
  });

  it('reads 1 for a perfect forecast and 0 when every event was missed', () => {
    expect(computeCsi([[10, 0], [0, 5]])).toBe(1);
    // A REAL zero: five misses, no hits. The denominator is non-zero, so the
    // forecast genuinely earned the worst score. This must stay 0.
    expect(computeCsi([[10, 0], [5, 0]])).toBe(0);
  });

  it('returns NaN, not 0, when nothing was forecast AND nothing observed', () => {
    // hits = false alarms = misses = 0, so CSI is 0/0 — undefined, not zero.
    // Reporting 0 would mean "worst possible score" for a period in which
    // nothing happened to score, which is the opposite of the truth. Matches
    // thresholdScores, which reports this same quantity in the table.
    expect(Number.isNaN(computeCsi([[42, 0], [0, 0]]))).toBe(true);
  });

  it('separates a real zero from an undefined one', () => {
    // The distinction the two cases above turn on, stated once directly: both
    // have zero hits, and only one of them is a failure.
    expect(computeCsi([[10, 0], [5, 0]])).toBe(0); // 5 misses  -> earned a zero
    expect(Number.isNaN(computeCsi([[10, 0], [0, 0]]))).toBe(true); // nothing -> n/a
  });

  it('returns NaN for an empty matrix or an out-of-range threshold', () => {
    expect(Number.isNaN(computeCsi([]))).toBe(true);
    expect(Number.isNaN(computeCsi([[1, 0], [0, 1]], 5))).toBe(true);
  });
});
