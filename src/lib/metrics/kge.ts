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
  /** Aligned pairs behind every value here. */
  n: number;
}

/**
 * True when every finite value is bit-identical.
 *
 * Tested on the VALUES, not on the computed standard deviation, because the two
 * disagree. sd is formed as sqrt(Σ(v−mu)²/(n−1)) with mu = sum/n, and sum/n does
 * not round-trip to the constant: a member flat at 31.4159 yields sd = 1.4e-14,
 * not 0. A `sd === 0` guard therefore catches some constants and not others,
 * purely on the bit pattern of the constant — and the ones it misses go on to
 * produce r from rounding residue, around 2e-16, which propagates into KGE'.
 * Measured, the plotted median swung 1.38 between a member flat at 32.0 and one
 * flat at 31.4159.
 *
 * This is live rather than hypothetical: transform saturation maps every larger
 * discharge to one value, and the negative clamp maps to exactly 0, so constant
 * members are what the corrected variants produce.
 */
function isConstant(xs: number[]): boolean {
  if (xs.length === 0) return true;
  const first = xs[0];
  for (let i = 1; i < xs.length; i++) if (xs[i] !== first) return false;
  return true;
}

/**
 * Whether a spread is real or numerical residue.
 *
 * The exact test above catches the documented cause. This is the backstop for a
 * series that is nearly but not exactly constant, where sd is genuine and still
 * far too small to carry meaning — relative to the series' own scale, since an
 * absolute epsilon would be wrong at both ends of the discharge range.
 */
function spreadIsMeaningless(sd: number, mu: number): boolean {
  return sd <= 1e-12 * Math.abs(mu);
}

/**
 * Kling-Gupta Efficiency (Kling et al. 2012, "KGE'"):
 *   KGE' = 1 - sqrt((r-1)² + (β-1)² + (γ-1)²)
 *
 *   r     = Pearson correlation
 *   β     = μ_f / μ_o          (bias ratio)
 *   γ     = CV_f / CV_o        (variability ratio, CV-based)
 *
 * Each component is guarded on what IT needs rather than on one shared test, so
 * a flat forecast still reports β and γ — the case the variability panel exists
 * to show — while r and KGE' correctly go NaN. See the guards inline.
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

  // One guard per output, on what that output actually needs.
  //
  // This was a single all-or-nothing test — muF === 0 || muO === 0 || sdO === 0
  // || sdF === 0 — which was wrong in both directions at once. It let a
  // near-constant member through to publish a KGE' built from rounding residue,
  // and it suppressed β and γ for members where both are perfectly well defined.
  // Tightening it alone would have made the second problem worse, so the two are
  // fixed together.
  //
  //   r      needs real spread on BOTH sides; for a flat forecast it is 0/0
  //   β      needs only μ_o ≠ 0 — it is a ratio of means
  //   γ      needs μ_f ≠ 0 and real observed spread; for a flat forecast it is
  //          0, which is the informative answer, not an undefined one
  //   KGE'   needs all three, so it is the strictest
  //
  // Reporting γ = 0 for a saturated member matters: that is exactly when the
  // variability panel has something to say, and it was the case being hidden.
  const flatF = isConstant(f) || spreadIsMeaningless(sdF, muF);
  const flatO = isConstant(o) || spreadIsMeaningless(sdO, muO);

  const beta = muO === 0 ? Number.NaN : muF / muO;
  const gamma = flatO || muF === 0 || muO === 0 ? Number.NaN : (flatF ? 0 : sdF / muF) / (sdO / muO);
  const r = flatF || flatO ? Number.NaN : pearsonR(f, o, muF, muO, sdF, sdO);

  const kgePrime =
    Number.isFinite(r) && Number.isFinite(beta) && Number.isFinite(gamma)
      ? 1 - Math.sqrt((r - 1) ** 2 + (beta - 1) ** 2 + (gamma - 1) ** 2)
      : Number.NaN;
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
