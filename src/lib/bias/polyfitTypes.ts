/**
 * Shapes for the published per-river polynomial transformers.
 *
 * Deliberately separate from `polyfits.ts`, which fetches and caches them: that
 * module reaches for `fetch` and IndexedDB, and the transform maths must stay
 * usable — and testable — without dragging a browser environment along.
 */

/** Transformer coefficients for one calendar month. */
export interface MonthPolyfit {
  /** Input discharge is clipped to [min, max] before anything else. */
  qrange: [number, number];
  /** Discharge → log(1 + exceedance percentile). Descending powers, as np.poly1d. */
  qtop: number[];
  /** Exceedance percentile → log(1 + discharge). Descending powers. */
  ptoq: number[];
}

/** Coefficients for one river, keyed by calendar month 1–12. */
export type RiverPolyfits = Record<number, MonthPolyfit>;
