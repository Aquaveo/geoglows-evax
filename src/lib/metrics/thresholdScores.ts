/**
 * The window-invariant categorical scores, per exceedance threshold.
 *
 * Each is computed from a 2×2 table formed by dichotomising the K-category
 * contingency matrix at one threshold: "at or above category k" against "below".
 * A K-category matrix therefore yields K−1 rows, and the row-to-row trend is the
 * point — skill decaying as the threshold rises is the flood-relevant story that
 * any single collapsed number hides.
 *
 * None of these four touch the correct-negative cell, so none can be moved by
 * uploading a longer window. Verified: adding 100,000 quiet timesteps leaves
 * every value identical, while MCC and HSS drift substantially.
 */

export interface ThresholdScores {
  /** Index of the threshold category, 1-based against the matrix. */
  category: number;
  label: string;
  hits: number;
  falseAlarms: number;
  misses: number;
  correctNegatives: number;
  /** a/(a+c). Fraction of observed events that were forecast. */
  pod: number;
  /** b/(a+b). Fraction of forecast events that did not occur. */
  far: number;
  /** a/(a+b+c). Correct negatives excluded — the invariant scalar. */
  csi: number;
  /**
   * (a+b)/(a+c). Forecast count over observed count.
   *
   * NOT a skill score: 1.0 means the right NUMBER of exceedances was forecast,
   * whether or not they were on the right days. Its value is diagnostic — a
   * forecast that is systematically low reads below 1 at every threshold and
   * decays to 0 at the top, which is a direct fingerprint of under-prediction
   * on a quantity no window length can change.
   */
  frequencyBias: number;
}

export function thresholdScores(matrix: number[][], labels: string[]): ThresholdScores[] {
  const K = matrix.length;
  const out: ThresholdScores[] = [];
  for (let k = 1; k < K; k++) {
    let a = 0;
    let b = 0;
    let c = 0;
    let d = 0;
    for (let i = 0; i < K; i++) {
      for (let j = 0; j < K; j++) {
        const v = matrix[i][j];
        if (!Number.isFinite(v)) continue;
        const obsEvent = i >= k;
        const fcstEvent = j >= k;
        if (obsEvent && fcstEvent) a += v;
        else if (!obsEvent && fcstEvent) b += v;
        else if (obsEvent && !fcstEvent) c += v;
        else d += v;
      }
    }
    out.push({
      category: k,
      label: labels[k] ?? `cat ${k}`,
      hits: a,
      falseAlarms: b,
      misses: c,
      correctNegatives: d,
      pod: a + c === 0 ? Number.NaN : a / (a + c),
      far: a + b === 0 ? Number.NaN : b / (a + b),
      csi: a + b + c === 0 ? Number.NaN : a / (a + b + c),
      frequencyBias: a + c === 0 ? Number.NaN : (a + b) / (a + c),
    });
  }
  return out;
}
