import type { ForecastRun, LeadBuckets, TimeSeries } from '../types';
import { memberSeries } from '../leadBuckets';
import { countAlignedPairs } from '../alignment';
import { kge } from './kge';

/** One bar row: a lead day or a forecast run, scored on NSE and KGE'. */
export interface SkillRow {
  /** Axis label, e.g. "Lead 3" or "2024-06-08". */
  label: string;
  /** Median NSE across ensemble members. NaN when the sample is too small. */
  nse: number;
  /** Median KGE' across ensemble members. NaN when the sample is too small. */
  kge: number;
  /** Forecast/observation pairs behind the row. */
  pairs: number;
  /** Members that produced a finite score. */
  members: number;
  /**
   * Members behind each median separately.
   *
   * `members` above is max(nse, kge), which is what the hover used to print for
   * BOTH bars. The two counts diverge whenever one metric is defined for a
   * member and the other is not — a flat forecast has a real β and γ but no r,
   * so it scores NSE and not KGE' — and the hover then overstated the evidence
   * behind whichever median had fewer.
   */
  nseMembers: number;
  kgeMembers: number;
  /** Set when the row was not scored, and why. */
  skipped?: string;
}

export interface SkillSummaryOptions {
  /** Minimum pairs before a row is scored at all. */
  minPairs?: number;
  maxLead?: number;
}

/**
 * NSE and KGE' per lead day, taken as the median across ensemble members.
 *
 * The median rather than the ensemble-median *series*: it matches the black
 * median line on the box plots above, so a bar and its box tell the same story.
 */
export function skillByLead(
  buckets: LeadBuckets,
  observed: TimeSeries,
  opts: SkillSummaryOptions = {},
): SkillRow[] {
  const minPairs = opts.minPairs ?? 10;
  const maxLead = opts.maxLead ?? 15;
  const rows: SkillRow[] = [];

  for (let lead = 0; lead <= maxLead; lead++) {
    const bucket = buckets[lead];
    const label = `Lead ${lead}`;
    if (!bucket || bucket.time.length === 0) {
      rows.push({
        label, nse: NaN, kge: NaN, pairs: 0,
        members: 0, nseMembers: 0, kgeMembers: 0,
        skipped: 'no forecast data',
      });
      continue;
    }

    const memberCount = bucket.members[0]?.length ?? 0;
    const nseVals: number[] = [];
    const kgeVals: number[] = [];
    // Member-independent: individual members can each be missing different
    // timesteps (the fetched ensemble is union-joined across cadences and padded
    // with NaN), so no single member's count describes the lead.
    const pairs = countAlignedPairs(bucket.time, observed);
    let bestMemberPairs = 0;

    for (let m = 0; m < memberCount; m++) {
      const res = kge(memberSeries(bucket, m), observed);
      if (res.n > bestMemberPairs) bestMemberPairs = res.n;
      // Score only members with their own adequate sample. A member with four
      // aligned points yields a wild-but-finite score that would otherwise enter
      // the median beside members with thirty.
      if (res.n < minPairs) continue;
      if (Number.isFinite(res.nse)) nseVals.push(res.nse);
      if (Number.isFinite(res.kge)) kgeVals.push(res.kge);
    }

    const scored = Math.max(nseVals.length, kgeVals.length);
    if (scored === 0) {
      rows.push({
        label,
        nse: NaN,
        kge: NaN,
        pairs,
        members: 0,
        nseMembers: 0,
        kgeMembers: 0,
        skipped:
          pairs < minPairs
            ? `only ${pairs} overlapping timestep${pairs === 1 ? '' : 's'}`
            : `no member had ${minPairs} usable pairs (best ${bestMemberPairs})`,
      });
      continue;
    }
    rows.push({
      label,
      nse: median(nseVals),
      kge: median(kgeVals),
      pairs,
      members: scored,
      nseMembers: nseVals.length,
      kgeMembers: kgeVals.length,
    });
  }
  return rows;
}

/**
 * NSE and KGE' per forecast run, each scored over its own horizon.
 *
 * Unlike the per-lead view this involves no stitching: every row is one model
 * run compared against the observations it overlaps, so the 51 members really
 * are a single ensemble.
 */
export function skillByRun(
  forecasts: Map<string, ForecastRun>,
  observed: TimeSeries,
  opts: SkillSummaryOptions = {},
): SkillRow[] {
  const minPairs = opts.minPairs ?? 10;
  const rows: SkillRow[] = [];

  for (const [dateStr, run] of forecasts) {
    const label =
      /^\d{8}$/.test(dateStr)
        ? `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`
        : dateStr;
    if (run.time.length === 0) {
      rows.push({
        label, nse: NaN, kge: NaN, pairs: 0,
        members: 0, nseMembers: 0, kgeMembers: 0,
        skipped: 'no forecast data',
      });
      continue;
    }

    const nseVals: number[] = [];
    const kgeVals: number[] = [];
    const pairs = countAlignedPairs(run.time, observed);
    let bestMemberPairs = 0;

    for (let m = 0; m < run.discharge.length; m++) {
      const series = run.discharge[m];
      if (!series) continue;
      const res = kge({ time: run.time, values: series }, observed);
      if (res.n > bestMemberPairs) bestMemberPairs = res.n;
      if (res.n < minPairs) continue;
      if (Number.isFinite(res.nse)) nseVals.push(res.nse);
      if (Number.isFinite(res.kge)) kgeVals.push(res.kge);
    }

    const scored = Math.max(nseVals.length, kgeVals.length);
    if (scored === 0) {
      rows.push({
        label,
        nse: NaN,
        kge: NaN,
        pairs,
        members: 0,
        nseMembers: 0,
        kgeMembers: 0,
        skipped:
          pairs < minPairs
            ? `only ${pairs} timestep${pairs === 1 ? '' : 's'} overlapping the event`
            : `no member had ${minPairs} usable pairs (best ${bestMemberPairs})`,
      });
      continue;
    }
    rows.push({
      label,
      nse: median(nseVals),
      kge: median(kgeVals),
      pairs,
      members: scored,
      nseMembers: nseVals.length,
      kgeMembers: kgeVals.length,
    });
  }

  rows.sort((a, b) => a.label.localeCompare(b.label));
  return rows;
}

function median(xs: number[]): number {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length / 2;
  return s.length % 2 === 1 ? s[Math.floor(mid)] : (s[mid - 1] + s[mid]) / 2;
}
