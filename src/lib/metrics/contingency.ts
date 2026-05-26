import type { TimeSeries, RpThresholds } from '../types';
import { RP_LEVELS } from '../types';

export interface ContingencyResult {
  /** K × K raw timestep counts. matrix[i][j] = (obs in category i) ∧ (forecast in category j). */
  matrix: number[][];
  /** Category labels in matrix order: [0, 2, 5, ..., eventRp]. */
  categories: number[];
  /** Display labels in matrix order: ["<2yr", "2–5yr", ..., "≥100yr"]. */
  labels: string[];
  /** Diagonal sum. */
  hits: number;
  /** Lower-triangle sum (observation in higher category than forecast). */
  underestimation: number;
  /** Upper-triangle sum (observation in lower category than forecast). */
  overestimation: number;
  /** Total counted timesteps. */
  n: number;
}

/**
 * Highest observed return period exceeded during the event.
 * Returns 0 if no observed threshold is crossed.
 */
export function determineEventReturnPeriod(event: TimeSeries, obsRp: RpThresholds): number {
  let maxFlow = -Infinity;
  for (const v of event.values) if (Number.isFinite(v) && v > maxFlow) maxFlow = v;
  let eventRp = 0;
  for (const rp of RP_LEVELS) {
    const t = obsRp[rp];
    if (Number.isFinite(t) && maxFlow >= t) eventRp = rp;
  }
  return eventRp;
}

/** Valid categories for the contingency matrix: [0, 2, 5, ..., eventRp]. */
export function validCategories(eventRp: number): number[] {
  const out: number[] = [0];
  for (const rp of RP_LEVELS) if (rp <= eventRp) out.push(rp);
  return out;
}

/** Display labels: "<2yr", "2–5yr", "5–10yr", …, "≥100yr". */
export function categoryLabels(eventRp: number): string[] {
  const cats = validCategories(eventRp);
  const labels: string[] = [];
  for (let i = 0; i < cats.length; i++) {
    const cat = cats[i];
    if (cat === 0) {
      labels.push('<2yr');
    } else if (cat === 100) {
      labels.push('≥100yr');
    } else if (i === cats.length - 1) {
      labels.push(`≥${cat}yr`);
    } else {
      const next = cats[i + 1];
      labels.push(`${cat}–${next}yr`);
    }
  }
  return labels;
}

/**
 * Classify a flow value into a return-period category using the given thresholds.
 * Mirrors the notebook's `classify_series`. Categories are bounded by eventRp;
 * values at or above thresholds[eventRp] map to eventRp (the top category).
 */
export function classifyValue(
  value: number,
  thresholds: RpThresholds,
  eventRp: number,
): number {
  if (!Number.isFinite(value)) return Number.NaN;
  const rpLevels = RP_LEVELS.filter((rp) => rp <= eventRp);
  if (rpLevels.length === 0) return 0;
  const t2 = thresholds[rpLevels[0]];
  if (!Number.isFinite(t2)) return Number.NaN;
  if (value < t2) return 0;
  for (let i = 0; i < rpLevels.length; i++) {
    const rp = rpLevels[i];
    const lo = thresholds[rp];
    if (!Number.isFinite(lo)) return Number.NaN;
    const isLast = i === rpLevels.length - 1;
    if (isLast) return rp;
    const hi = thresholds[rpLevels[i + 1]];
    if (!Number.isFinite(hi)) return Number.NaN;
    if (value >= lo && value < hi) return rp;
  }
  return Number.NaN;
}

/**
 * Build the deterministic contingency matrix for one forecast series vs. the observed event.
 * Observed values are classified against obsRp; forecast values against simRp (dual-threshold).
 *
 * Mirrors the notebook's `build_deterministic_contingency_matrix`.
 */
export function buildContingencyMatrix(
  forecast: TimeSeries,
  observed: TimeSeries,
  obsRp: RpThresholds,
  simRp: RpThresholds,
  eventRp: number,
): ContingencyResult {
  const cats = validCategories(eventRp);
  const labels = categoryLabels(eventRp);
  const K = cats.length;
  const catIndex = new Map<number, number>();
  cats.forEach((c, i) => catIndex.set(c, i));

  const matrix: number[][] = [];
  for (let i = 0; i < K; i++) matrix.push(new Array(K).fill(0));

  const empty: ContingencyResult = {
    matrix,
    categories: cats,
    labels,
    hits: 0,
    underestimation: 0,
    overestimation: 0,
    n: 0,
  };

  if (forecast.time.length === 0 || observed.time.length === 0) return empty;

  const fStart = forecast.time[0].getTime();
  const fEnd = forecast.time[forecast.time.length - 1].getTime();
  const oStart = observed.time[0].getTime();
  const oEnd = observed.time[observed.time.length - 1].getTime();
  const start = Math.max(fStart, oStart);
  const end = Math.min(fEnd, oEnd);
  if (start > end) return empty;

  const obsMap = new Map<number, number>();
  for (let i = 0; i < observed.time.length; i++) {
    const ms = observed.time[i].getTime();
    if (ms < start || ms > end) continue;
    obsMap.set(ms, observed.values[i]);
  }

  let n = 0;
  for (let i = 0; i < forecast.time.length; i++) {
    const ms = forecast.time[i].getTime();
    if (ms < start || ms > end) continue;
    const ov = obsMap.get(ms);
    if (ov === undefined) continue;
    const fv = forecast.values[i];
    if (!Number.isFinite(fv) || !Number.isFinite(ov)) continue;
    const oc = classifyValue(ov, obsRp, eventRp);
    const fc = classifyValue(fv, simRp, eventRp);
    if (!Number.isFinite(oc) || !Number.isFinite(fc)) continue;
    const oi = catIndex.get(oc);
    const fi = catIndex.get(fc);
    if (oi === undefined || fi === undefined) continue;
    matrix[oi][fi] += 1;
    n += 1;
  }

  let hits = 0;
  let under = 0;
  let over = 0;
  for (let i = 0; i < K; i++) {
    for (let j = 0; j < K; j++) {
      const v = matrix[i][j];
      if (i === j) hits += v;
      else if (i > j) under += v;
      else over += v;
    }
  }
  return { matrix, categories: cats, labels, hits, underestimation: under, overestimation: over, n };
}
