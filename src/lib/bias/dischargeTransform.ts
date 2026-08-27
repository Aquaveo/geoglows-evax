import type { MonthPolyfit, RiverPolyfits } from './polyfitTypes';

/**
 * Horner evaluation of a polynomial given in DESCENDING powers, matching
 * `np.poly1d`: coefficients[0] multiplies the highest power.
 */
export function polyval(coefficients: number[], x: number): number {
  let acc = coefficients[0];
  for (let i = 1; i < coefficients.length; i++) acc = acc * x + coefficients[i];
  return acc;
}

/**
 * Transform one discharge value through a month's fitted pair of polynomials.
 *
 * Reproduces geoglows.bias.discharge_transform exactly, including its use of
 * `exp(x) - 1` rather than `expm1(x)` — they differ in the last bits for small
 * x, and matching the reference matters more than the extra precision.
 */
export function transformValue(fit: MonthPolyfit, value: number): number {
  const q = Math.min(Math.max(value, fit.qrange[0]), fit.qrange[1]);
  const p = Math.min(Math.max(Math.exp(polyval(fit.qtop, q)) - 1, 0), 100);
  return Math.exp(polyval(fit.ptoq, p)) - 1;
}

/** One end of a month's transform where it stops distinguishing between inputs. */
export interface SaturatedRegion {
  /** Discharge at the region's inner edge — the last input still told apart. */
  atDischarge: number;
  /** The single corrected value every discharge in the region collapses onto. */
  toValue: number;
}

/** Where a month's transform stops distinguishing between inputs. */
export interface MonthSaturation {
  /**
   * Low-flow saturation: every discharge at or BELOW `atDischarge` maps to
   * `toValue`, because the exceedance percentile has clamped to 100.
   */
  floor: SaturatedRegion | null;
  /**
   * High-flow saturation: every discharge at or ABOVE `atDischarge` maps to
   * `toValue`, because the percentile has clamped to 0.
   *
   * This is the end that matters for flood verification: it is where two
   * forecasts of very different magnitude come out as the same corrected number.
   */
  ceiling: SaturatedRegion | null;
  /** False when a larger input can produce a smaller output. */
  monotonic: boolean;
}

/**
 * Probe a month's transform across its own valid range.
 *
 * Worth doing before trusting any corrected number, because these transforms are
 * degree-7 polynomial fits: they are smooth and finite everywhere — which is why
 * they cannot produce the infinities the empirical-CDF method does — but they
 * are not guaranteed monotonic, and the percentile clamp at [0, 100] gives them
 * a hard ceiling and floor.
 *
 * BOTH ends are reported, separately. This used to return a single
 * `fromDischarge`/`toValue`/`end` triple, found by walking discharge upward and
 * stopping at the first clamped sample. Since low discharge carries HIGH
 * exceedance percentile, that walk meets the floor first — so a month clamping
 * at both ends always reported the floor and never mentioned the ceiling, which
 * is the end that flattens floods. Measured on the published coefficients, 6.1%
 * of river-months clamp at both.
 *
 * Each region's representative value is sampled INSIDE that region, which the
 * single-triple version also got wrong: it took the midpoint between the clip
 * point and the top of the range, so on a floor-clamped month it sampled the
 * middle of the healthy range and reported a value nothing collapsed onto. On a
 * both-ends fit it claimed "everything above 0.0 maps to 44.08" where inputs of
 * 0.5, 50 and 100 give 1.72, 44.08 and 53.60 — 44.08 being simply the value at
 * the midpoint it happened to sample.
 *
 * The midpoint of each region rather than its outer endpoint, because on at
 * least one real river the percentile pops back above zero exactly at Qrange's
 * upper endpoint, so the endpoint is not representative of the region below it.
 */
export function probeMonth(fit: MonthPolyfit, steps = 4000): MonthSaturation {
  const [lo, hi] = fit.qrange;
  if (!(hi > lo)) return { floor: null, ceiling: null, monotonic: true };

  // Floor: the LAST ascending sample still clamped at 100, so the region is
  // [lo, floorEdge]. Ceiling: the FIRST clamped at 0, so it is [ceilEdge, hi].
  // Taking the outermost floor edge and the innermost ceiling edge is the
  // conservative reading when the percentile fit is not monotonic.
  let floorEdge: number | null = null;
  let ceilEdge: number | null = null;
  let monotonic = true;
  let prev = Number.NEGATIVE_INFINITY;

  for (let i = 0; i <= steps; i++) {
    const q = lo + ((hi - lo) * i) / steps;
    const raw = Math.exp(polyval(fit.qtop, q)) - 1;
    if (raw >= 100) floorEdge = q;
    if (raw <= 0 && ceilEdge === null) ceilEdge = q;
    const out = transformValue(fit, q);
    // A tolerance, not zero: floating point makes a genuinely flat saturated
    // region wobble in the last bits, which is not a monotonicity failure.
    if (out < prev - 1e-9) monotonic = false;
    prev = out;
  }

  // Clamped the way transformSeries clamps its output, so the value quoted in a
  // banner is the value a forecast actually receives. Without this the probe
  // could report a negative corrected discharge that no series would ever show.
  const atMid = (a: number, b: number) => Math.max(transformValue(fit, (a + b) / 2), 0);

  return {
    floor: floorEdge === null ? null : { atDischarge: floorEdge, toValue: atMid(lo, floorEdge) },
    ceiling: ceilEdge === null ? null : { atDischarge: ceilEdge, toValue: atMid(ceilEdge, hi) },
    monotonic,
  };
}

const probeCache = new WeakMap<MonthPolyfit, MonthSaturation>();

/** probeMonth, memoised on the fit object. */
function cachedProbe(fit: MonthPolyfit): MonthSaturation {
  let v = probeCache.get(fit);
  if (!v) {
    v = probeMonth(fit);
    probeCache.set(fit, v);
  }
  return v;
}

/**
 * Whether a month's published coefficients can actually be applied.
 *
 * Rivers exist in the store with NaN coefficients — present, but without a
 * fitted transform. Applying one silently produces NaN for every value while
 * every diagnostic counter stays at zero, so this has to be an explicit
 * inspection rather than something inferred from the results.
 */
export function isUsableFit(fit: MonthPolyfit): boolean {
  if (!Number.isFinite(fit.qrange?.[0]) || !Number.isFinite(fit.qrange?.[1])) return false;
  if (!fit.qtop?.length || !fit.ptoq?.length) return false;
  return fit.qtop.every(Number.isFinite) && fit.ptoq.every(Number.isFinite);
}

export interface TransformDiagnostics {
  /** Finite values transformed. */
  n: number;
  /** Inputs above the month's Qrange maximum, clipped before transforming. */
  clippedToQmax: number;
  /**
   * Inputs BELOW the month's Qrange minimum, clipped up before transforming.
   *
   * The mirror of clippedToQmax, which existed alone — so a forecast clipped up
   * to the fitted minimum was indistinguishable from one that fell inside the
   * range. Rarer than the top end on flood work, but it is the same loss of
   * information and the banner should not report one silently while naming the
   * other.
   */
  clippedToQmin: number;
  /** Values whose percentile clamped to 0 — mapped onto the month's maximum. */
  atCeiling: number;
  /** Values whose percentile clamped to 100 — mapped onto the month's minimum. */
  atFloor: number;
  /** Negative outputs clamped to zero. Polynomial fits can undershoot slightly. */
  negativeClamped: number;
  /** Calendar months encountered. */
  months: number[];
  /**
   * Months whose published coefficients are not usable, and the values that fell
   * in them.
   *
   * A river can be present in the store and still carry NaN coefficients for
   * some months. Nothing downstream notices on its own, because every guard here
   * is a comparison and every comparison against NaN is false: `v > qrange[1]`,
   * `raw <= 0`, `raw >= 100` and `result < 0` all return false, so no counter
   * fires and the caller's saturation share reads 0 out of a full `n`. The
   * result is an all-NaN "corrected" series reported as healthy — under a banner
   * whose whole claim is that this variant cannot fail.
   *
   * Recorded per month rather than per river: a forecast that never touches a
   * bad month is unaffected, and discarding a working transform over a month
   * outside the event would be throwing away a usable correction.
   */
  unusableMonths: number[];
  /** Values that fell in a month with unusable coefficients. */
  skippedNoFit: number;
  /** Saturation probe per month encountered. */
  saturation: Record<number, MonthSaturation>;
}

export interface TransformResult {
  values: number[];
  diagnostics: TransformDiagnostics;
}

/**
 * Apply the global transform to a discharge series, one month at a time.
 *
 * Unlike the empirical-CDF correction this needs no observed record at all — the
 * coefficients are fitted centrally per river — so it cannot inherit a short
 * gauge history's empty histogram bins, and every forecast run survives instead
 * of the flood-magnitude ones being excluded.
 */
export function transformSeries(
  time: Date[],
  values: number[],
  fits: RiverPolyfits,
): TransformResult {
  const out = new Array<number>(values.length);
  const months = new Set<number>();
  const badMonths = new Set<number>();
  const diagnostics: TransformDiagnostics = {
    n: 0,
    clippedToQmax: 0,
    clippedToQmin: 0,
    atCeiling: 0,
    atFloor: 0,
    negativeClamped: 0,
    months: [],
    saturation: {},
    unusableMonths: [],
    skippedNoFit: 0,
  };

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) {
      out[i] = v;
      continue;
    }
    const month = time[i].getUTCMonth() + 1;
    const fit = fits[month];
    // A month with no fit, or one whose published coefficients are not finite,
    // has no usable transform. Detected up front by inspection rather than left
    // to the guards below, none of which can see a NaN: every one of them is a
    // comparison, and a comparison against NaN is false.
    if (!fit || !isUsableFit(fit)) {
      if (fit) badMonths.add(month);
      diagnostics.skippedNoFit += 1;
      out[i] = NaN;
      continue;
    }
    months.add(month);
    diagnostics.n += 1;

    if (v > fit.qrange[1]) diagnostics.clippedToQmax += 1;
    else if (v < fit.qrange[0]) diagnostics.clippedToQmin += 1;
    const q = Math.min(Math.max(v, fit.qrange[0]), fit.qrange[1]);
    const raw = Math.exp(polyval(fit.qtop, q)) - 1;
    if (raw <= 0) diagnostics.atCeiling += 1;
    else if (raw >= 100) diagnostics.atFloor += 1;

    let result = Math.exp(polyval(fit.ptoq, Math.min(Math.max(raw, 0), 100))) - 1;
    if (result < 0) {
      diagnostics.negativeClamped += 1;
      result = 0;
    }
    out[i] = result;
  }

  diagnostics.months = [...months].sort((a, b) => a - b);
  diagnostics.unusableMonths = [...badMonths].sort((a, b) => a - b);
  // Saturation is a property of the fitted polynomials, not of this series, so
  // it is memoised per month object rather than recomputed. transformSeries runs
  // once per ensemble member per run -- thousands of times for a full event --
  // and each probe walks 4000 steps of two degree-7 polynomials.
  for (const m of diagnostics.months) diagnostics.saturation[m] = cachedProbe(fits[m]);
  return { values: out, diagnostics };
}
