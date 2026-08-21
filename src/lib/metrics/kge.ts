import type { TimeSeries } from '../types';
import { alignTimes } from '../alignment';

export interface KgeResult {
  kge: number;
  r: number;
  beta: number;
  gamma: number;
  /**
   * Nash–Sutcliffe efficiency: 1 − Σ(f−o)² / Σ(o−ō)².
   *
   * The mean-squared-error skill score against the observed mean, so 0 means the
   * forecast was no better than predicting the average flow and 1 is perfect.
   * Computed here because it needs the same aligned pairs as KGE'.
   */
  nse: number;
  n: number;
}

/**
 * Kling-Gupta Efficiency (Kling et al. 2012, "KGE'"):
 *   KGE' = 1 - sqrt((r-1)² + (β-1)² + (γ-1)²)
 *
 *   r     = Pearson correlation
 *   β     = μ_f / μ_o          (bias ratio)
 *   γ     = CV_f / CV_o        (variability ratio, CV-based)
 *
 * Returns NaN components where the math is undefined (zero mean, zero stdev,
 * insufficient overlap). Matches the notebook's `compute_*` family.
 */
export function kge(forecast: TimeSeries, observed: TimeSeries): KgeResult {
  const al = alignTimes(forecast, observed);
  const n = al.time.length;
  if (n < 3) {
    return {
      kge: Number.NaN,
      r: Number.NaN,
      beta: Number.NaN,
      gamma: Number.NaN,
      nse: Number.NaN,
      n,
    };
  }
  const f = al.forecast;
  const o = al.observed;

  const muF = mean(f);
  const muO = mean(o);
  const sdF = sampleStdev(f, muF);
  const sdO = sampleStdev(o, muO);

  // NSE only needs the observed spread to be non-zero, so it is computed before
  // the KGE-specific guards and survives cases where β or γ are undefined.
  const nse = nashSutcliffe(f, o, muO);

  if (muF === 0 || muO === 0 || sdO === 0 || sdF === 0) {
    return { kge: Number.NaN, r: Number.NaN, beta: Number.NaN, gamma: Number.NaN, nse, n };
  }
  const r = pearsonR(f, o, muF, muO, sdF, sdO);
  const beta = muF / muO;
  const cvF = sdF / muF;
  const cvO = sdO / muO;
  if (cvO === 0) {
    return { kge: Number.NaN, r, beta, gamma: Number.NaN, nse, n };
  }
  const gamma = cvF / cvO;
  const kgePrime = 1 - Math.sqrt((r - 1) ** 2 + (beta - 1) ** 2 + (gamma - 1) ** 2);
  return { kge: kgePrime, r, beta, gamma, nse, n };
}

/** 1 − Σ(f−o)² / Σ(o−ō)². NaN when the observations have no variance. */
function nashSutcliffe(f: number[], o: number[], muO: number): number {
  let sse = 0;
  let sst = 0;
  for (let i = 0; i < o.length; i++) {
    sse += (f[i] - o[i]) ** 2;
    sst += (o[i] - muO) ** 2;
  }
  if (sst === 0) return Number.NaN;
  return 1 - sse / sst;
}

function mean(xs: number[]): number {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return s / xs.length;
}

/** Sample stdev (ddof=1) to match notebook's `np.std(..., ddof=1)`. */
function sampleStdev(xs: number[], mu: number): number {
  if (xs.length < 2) return 0;
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += (xs[i] - mu) ** 2;
  return Math.sqrt(s / (xs.length - 1));
}

function pearsonR(
  xs: number[],
  ys: number[],
  muX: number,
  muY: number,
  sdX: number,
  sdY: number,
): number {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += (xs[i] - muX) * (ys[i] - muY);
  const cov = s / (xs.length - 1);
  return cov / (sdX * sdY);
}
