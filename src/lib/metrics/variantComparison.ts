import type { CrpsPerLead } from './crps';
import type { SkillRow } from './skillSummary';
import type { PerLeadDistribution } from '../../plots/distributionVsLead';

/**
 * One row per metric, comparing raw against each available correction.
 *
 * Built to answer the question the section's charts make you work for: switching
 * a selector back and forth and remembering what the other panel looked like.
 * Everything here is already computed by the Compute buttons, so the table costs
 * nothing beyond the summarising.
 *
 * Each cell is the MEDIAN ACROSS LEAD DAYS of that lead's own median across
 * members. Two levels of median rather than one pooled number, because the
 * per-lead medians are what every chart in the app plots — a table that
 * disagreed with the charts beside it would be worse than no table. It is a
 * summary and hides the lead structure entirely; the charts remain the record.
 */

export type VariantKey = 'raw' | 'local' | 'global';

export interface ComparisonRow {
  metric: string;
  /** What the metric's best attainable value is, for reading the direction. */
  ideal: string;
  /** true when a LOWER value is better, so the delta's sign can be interpreted. */
  lowerIsBetter: boolean;
  /** Median across leads, per variant. NaN where the variant was not computed. */
  values: Record<VariantKey, number>;
  /** Decimal places for display. */
  digits: number;
  /**
   * Which computation feeds this row, so the UI can name the button that fills
   * it rather than showing a dash and leaving the reader to guess.
   *
   * 'skill' is derived on every render and always present; 'accuracy' and 'crps'
   * each sit behind their own Compute button, which is why this table could
   * appear with one populated row and six empty ones.
   */
  needs: 'skill' | 'accuracy' | 'crps';
}

/** Median of the finite values, or NaN. */
export function median(xs: number[]): number {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return Number.NaN;
  const mid = v.length / 2;
  return v.length % 2 === 1 ? v[Math.floor(mid)] : (v[mid - 1] + v[mid]) / 2;
}

/** Median across leads of each lead's median across members. */
function acrossLeads(d: PerLeadDistribution | null | undefined): number {
  if (!d) return Number.NaN;
  return median(d.values.map((perLead) => median(perLead)));
}

/** Median across leads of a per-lead scalar series. */
function acrossLeadRows<T>(rows: T[] | null | undefined, pick: (r: T) => number): number {
  if (!rows || rows.length === 0) return Number.NaN;
  return median(rows.map(pick));
}

export interface ComparisonInputs {
  accuracy: Record<VariantKey, { kge: PerLeadDistribution; r: PerLeadDistribution; beta: PerLeadDistribution; gamma: PerLeadDistribution } | null>;
  skill: Record<VariantKey, SkillRow[] | null>;
  crps: Record<VariantKey, CrpsPerLead | null>;
}

export function variantComparison(inputs: ComparisonInputs): ComparisonRow[] {
  const keys: VariantKey[] = ['raw', 'local', 'global'];
  const per = (f: (k: VariantKey) => number): Record<VariantKey, number> =>
    Object.fromEntries(keys.map((k) => [k, f(k)])) as Record<VariantKey, number>;

  return [
    {
      metric: "KGE′",
      ideal: '1',
      lowerIsBetter: false,
      digits: 3,
      needs: 'skill',
      // From the SKILL rows, not the accuracy distributions, for two reasons.
      // It is available without pressing anything, so this row no longer sat
      // empty beside a populated NSE computed from the very same kge() call.
      // And it shares NSE's gate: skillByLead drops a member on its OWN aligned
      // count, accuracyDistributions drops all members on a lead-level count, so
      // the two can rest on different member sets. The Overview tells the reader
      // to read KGE' and NSE across a row, which is only sound when both were
      // scored over the same members.
      values: per((k) => acrossLeadRows(inputs.skill[k], (r) => r.kge)),
    },
    {
      metric: 'NSE',
      needs: 'skill',
      ideal: '1',
      lowerIsBetter: false,
      digits: 3,
      values: per((k) => acrossLeadRows(inputs.skill[k], (r) => r.nse)),
    },
    {
      metric: 'Correlation r',
      needs: 'accuracy',
      ideal: '1',
      lowerIsBetter: false,
      digits: 3,
      values: per((k) => acrossLeads(inputs.accuracy[k]?.r)),
    },
    {
      metric: 'Bias ratio β',
      needs: 'accuracy',
      ideal: '1',
      lowerIsBetter: false,
      digits: 3,
      values: per((k) => acrossLeads(inputs.accuracy[k]?.beta)),
    },
    {
      metric: 'Variability ratio γ',
      needs: 'accuracy',
      ideal: '1',
      lowerIsBetter: false,
      digits: 3,
      values: per((k) => acrossLeads(inputs.accuracy[k]?.gamma)),
    },
    {
      metric: 'CRPS (m³/s)',
      needs: 'crps',
      ideal: '0',
      lowerIsBetter: true,
      digits: 2,
      values: per((k) => acrossLeadRows(inputs.crps[k]?.crps.map((c) => c) ?? null, (c) => c)),
    },
    {
      metric: 'CRPSS',
      needs: 'crps',
      ideal: '1',
      lowerIsBetter: false,
      digits: 3,
      values: per((k) => acrossLeadRows(inputs.crps[k]?.crpss.map((c) => c) ?? null, (c) => c)),
    },
  ];
}

/**
 * Distance from the metric's ideal, so improvement can be judged for β and γ.
 *
 * β and γ are ratios whose target is 1 and which can miss in either direction, so
 * "higher is better" is wrong for them — 1.4 is worse than 1.0, and so is 0.7.
 * Comparing |value − 1| is what actually says whether a correction helped.
 */
export function improvement(row: ComparisonRow, from: number, to: number): number {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return Number.NaN;
  if (row.metric.startsWith('Bias ratio') || row.metric.startsWith('Variability')) {
    return Math.abs(from - 1) - Math.abs(to - 1);
  }
  return row.lowerIsBetter ? from - to : to - from;
}
