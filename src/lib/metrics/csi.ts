/**
 * Critical Success Index, also called the threat score.
 *
 *   CSI = hits / (hits + false alarms + misses)
 *
 * The point is the term that is ABSENT: correct negatives never enter it. That
 * makes it exactly invariant to how long a window the user uploaded — padding an
 * event with quiet days, where nothing was forecast and nothing happened, adds
 * only correct negatives and cannot move the score.
 *
 * MCC and HSS both move. Holding forecast performance fixed and adding quiet
 * days, a forecast that is systematically one category low goes from -0.50 to
 * +0.35 on MCC, reversing the verdict. CSI does not budge, which is the whole
 * reason to report it beside them.
 *
 * It is NOT a skill score: 0 means "never scored a hit", not "no better than
 * chance", and there is no chance correction. Read it as a proportion, not as
 * skill relative to a reference.
 */

/**
 * CSI from a multi-category contingency matrix, collapsed to binary at a
 * threshold category.
 *
 * CSI is defined for a two-by-two table, so a K-category matrix has to be
 * reduced. Everything at or above `atOrAbove` counts as "event forecast" or
 * "event observed"; everything below counts as no event. Category 0 is the
 * below-lowest-return-period class, so the default of 1 asks the operational
 * question: did the forecast call an exceedance when one happened?
 *
 * Returns NaN when the matrix is empty, and also when nothing was forecast and
 * nothing observed at or above the threshold.
 *
 * That second case is genuinely undefined — hits, false alarms and misses are
 * all zero, so the ratio is 0/0 — and it must not be reported as 0, because 0
 * is the WORST attainable CSI. "Nothing happened and nothing was predicted" and
 * "every event was missed" are opposite outcomes, and collapsing them onto the
 * same number tells the reader a quiet period was a total failure.
 *
 * A real 0 is preserved: misses with no hits scores 0, because there the
 * denominator is non-zero and the forecast genuinely earned it.
 *
 * This matches thresholdScores, which reports the same quantity in the
 * per-threshold table, and it is what lets the by-lead panel draw a GAP rather
 * than a line dropping to the floor at thresholds an individual lead never saw.
 */
export function computeCsi(matrix: number[][], atOrAbove = 1): number {
  const K = matrix.length;
  if (K === 0) return Number.NaN;
  if (atOrAbove >= K) return Number.NaN;

  let hits = 0;
  let falseAlarms = 0;
  let misses = 0;
  let n = 0;

  for (let i = 0; i < K; i++) {
    for (let j = 0; j < K; j++) {
      const v = matrix[i][j];
      if (!Number.isFinite(v) || v === 0) {
        n += Number.isFinite(v) ? v : 0;
        continue;
      }
      n += v;
      // i is the observed category, j the forecast category.
      const obsEvent = i >= atOrAbove;
      const fcstEvent = j >= atOrAbove;
      if (obsEvent && fcstEvent) hits += v;
      else if (!obsEvent && fcstEvent) falseAlarms += v;
      else if (obsEvent && !fcstEvent) misses += v;
      // Neither: a correct negative, deliberately not counted.
    }
  }

  if (n === 0) return Number.NaN;
  const denom = hits + falseAlarms + misses;
  return denom === 0 ? Number.NaN : hits / denom;
}
