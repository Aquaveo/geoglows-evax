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

/** Where a month's transform stops distinguishing between inputs. */
export interface MonthSaturation {
  /**
   * Lowest discharge whose percentile has already clipped, so every larger
   * discharge maps to exactly the same corrected value. Null if the month never
   * saturates inside its own Qrange.
   */
  fromDischarge: number | null;
  /** The single value everything above `fromDischarge` collapses onto. */
  toValue: number | null;
  /** Which end clipped: 'ceiling' is percentile 0 (the month's maximum flow). */
  end: 'ceiling' | 'floor' | null;
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
 */
export function probeMonth(fit: MonthPolyfit, steps = 4000): MonthSaturation {
  const [lo, hi] = fit.qrange;
  if (!(hi > lo)) return { fromDischarge: null, toValue: null, end: null, monotonic: true };

  let firstClip: number | null = null;
  let clipEnd: 'ceiling' | 'floor' | null = null;
  let monotonic = true;
  let prev = Number.NEGATIVE_INFINITY;

  for (let i = 0; i <= steps; i++) {
    const q = lo + ((hi - lo) * i) / steps;
    const raw = Math.exp(polyval(fit.qtop, q)) - 1;
    if (firstClip === null && (raw <= 0 || raw >= 100)) {
      firstClip = q;
      clipEnd = raw <= 0 ? 'ceiling' : 'floor';
    }
    const out = transformValue(fit, q);
    // A tolerance, not zero: floating point makes a genuinely flat saturated
    // region wobble in the last bits, which is not a monotonicity failure.
    if (out < prev - 1e-9) monotonic = false;
    prev = out;
  }

  return {
    fromDischarge: firstClip,
    // Sampled midway between the clip point and the top of the range, NOT at
    // the top itself. These are degree-7 fits, and on at least one real river
    // the percentile pops back above zero exactly at Qrange's upper endpoint,
    // so the endpoint is not representative of the saturated region below it.
    toValue: firstClip === null ? null : transformValue(fit, (firstClip + hi) / 2),
    end: clipEnd,
    monotonic,
  };
}

export interface TransformDiagnostics {
  /** Finite values transformed. */
  n: number;
  /** Inputs above the month's Qrange maximum, clipped before transforming. */
  clippedToQmax: number;
  /** Values whose percentile clamped to 0 — mapped onto the month's maximum. */
  atCeiling: number;
  /** Values whose percentile clamped to 100 — mapped onto the month's minimum. */
  atFloor: number;
  /** Negative outputs clamped to zero. Polynomial fits can undershoot slightly. */
  negativeClamped: number;
  /** Calendar months encountered. */
  months: number[];
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
  const diagnostics: TransformDiagnostics = {
    n: 0,
    clippedToQmax: 0,
    atCeiling: 0,
    atFloor: 0,
    negativeClamped: 0,
    months: [],
    saturation: {},
  };

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) {
      out[i] = v;
      continue;
    }
    const month = time[i].getUTCMonth() + 1;
    const fit = fits[month];
    if (!fit) {
      out[i] = NaN;
      continue;
    }
    months.add(month);
    diagnostics.n += 1;

    if (v > fit.qrange[1]) diagnostics.clippedToQmax += 1;
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
  for (const m of diagnostics.months) diagnostics.saturation[m] = probeMonth(fits[m]);
  return { values: out, diagnostics };
}
