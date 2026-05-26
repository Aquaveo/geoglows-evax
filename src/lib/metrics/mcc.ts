/**
 * Multi-category Matthews Correlation Coefficient (Gorodkin 2004; Jurman et al. 2012).
 *
 *   MCC = (N·c − Σ tₖ·pₖ) / √[(N² − Σ pₖ²)(N² − Σ tₖ²)]
 *
 * where C is a K × K contingency matrix of raw integer counts and
 *   N    = ΣC      (total timesteps)
 *   c    = trace(C) (hits)
 *   tₖ   = row sum k (observed marginal)
 *   pₖ   = column sum k (forecast marginal)
 *
 * Returns NaN when the matrix is empty (N = 0), and 0 when the denominator
 * is zero (matches the notebook's `compute_mcc`).
 */
export function computeMcc(matrix: number[][]): number {
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
  let sumT2 = 0;
  let sumP2 = 0;
  for (let k = 0; k < K; k++) {
    dotTp += t[k] * p[k];
    sumT2 += t[k] * t[k];
    sumP2 += p[k] * p[k];
  }
  const N2 = N * N;
  const num = c * N - dotTp;
  const left = N2 - sumP2;
  const right = N2 - sumT2;
  if (left <= 0 || right <= 0) return 0;
  const den = Math.sqrt(left * right);
  if (den === 0) return 0;
  return num / den;
}
