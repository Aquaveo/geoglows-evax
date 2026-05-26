/**
 * Multi-category Heidke Skill Score.
 *
 *   HSS = (N·c − Σ tₖ·pₖ) / (N² − Σ tₖ·pₖ)
 *
 * Shares the same numerator as MCC; only the denominator differs.
 * Returns NaN when N = 0, and 0 when the denominator is zero
 * (matches the notebook's `compute_hss`).
 */
export function computeHss(matrix: number[][]): number {
  const K = matrix.length;
  if (K === 0) return Number.NaN;
  let N = 0;
  let c = 0;
  const t = new Array(K).fill(0);
  const p = new Array(K).fill(0);
  for (let i = 0; i < K; i++) {
    for (let j = 0; j < K; j++) {
      const v = matrix[i][j];
      N += v;
      if (i === j) c += v;
      t[i] += v;
      p[j] += v;
    }
  }
  if (N === 0) return Number.NaN;

  let dotTp = 0;
  for (let k = 0; k < K; k++) dotTp += t[k] * p[k];
  const num = c * N - dotTp;
  const den = N * N - dotTp;
  if (den === 0) return 0;
  return num / den;
}
