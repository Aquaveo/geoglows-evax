import type { LeadBuckets, TimeSeries } from '../types';
import { memberSeries } from '../leadBuckets';
import { countAlignedPairs } from '../alignment';
import { kge, type KgeResult } from './kge';
import type { PerLeadDistribution } from '../../plots/distributionVsLead';

/** Every member's KGE result at one lead, plus the sample facts about that lead. */
export interface LeadScores {
  lead: number;
  label: string;
  /**
   * Aligned pairs at the LEAD level — how many of this bucket's timestamps the
   * observations cover. Member-independent, because members can each be missing
   * different timesteps: `aggregateBucket` writes NaN for a member with no
   * finite value in a bin, so no single member's count describes the lead.
   *
   * Not a cadence artefact, which an earlier version of this comment claimed. A
   * run carries one `time` array shared by all 51 members, so differing member
   * cadences are not representable; a per-member gap here means the download was
   * genuinely missing that value.
   */
  pairs: number;
  /** The best-sampled member's own aligned count, for explaining an empty lead. */
  bestMemberPairs: number;
  /** One result per member, in member order. Never filtered — callers gate. */
  members: KgeResult[];
}

/**
 * Score every member at every lead ONCE.
 *
 * This exists because the app used to do it twice. `skillByLead` computed median
 * NSE and KGE' per lead for the skill bars, and `accuracyDistributions` computed
 * KGE', r, β and γ distributions for the accuracy box plots — both looping over
 * the same members at the same leads, calling the same kge() on the same series.
 * Two costs, and worse, two ANSWERS: they gated differently, so the app could
 * display two different KGE' values for one forecast.
 *
 * The gates disagreed like this:
 *
 *   skillByLead            dropped a member on its OWN aligned pair count
 *   accuracyDistributions  dropped ALL members on the lead-level count
 *
 * The per-member gate is the correct one, and skillByLead's own comment said why:
 * a member with four aligned points yields a wild-but-finite score that would
 * otherwise enter the median beside members with thirty. So that is the rule
 * kept, and it now applies to the distributions too — which drops a handful of
 * under-sampled members from the accuracy box plots that used to be in them.
 *
 * The lead-level `pairs` count survives for display: it is what tells a reader
 * why a whole lead is blank, and it is the honest denominator to show beside a
 * distribution.
 */
export function scoreMembersByLead(
  buckets: LeadBuckets,
  observed: TimeSeries,
  maxLead = 15,
): LeadScores[] {
  const out: LeadScores[] = [];
  for (let lead = 0; lead <= maxLead; lead++) {
    const bucket = buckets[lead];
    const label = `Lead ${lead}`;
    if (!bucket || bucket.time.length === 0) {
      out.push({ lead, label, pairs: 0, bestMemberPairs: 0, members: [] });
      continue;
    }
    const pairs = countAlignedPairs(bucket.time, observed);
    const memberCount = bucket.members[0]?.length ?? 0;
    const members: KgeResult[] = [];
    let bestMemberPairs = 0;
    for (let m = 0; m < memberCount; m++) {
      const res = kge(memberSeries(bucket, m), observed);
      if (res.n > bestMemberPairs) bestMemberPairs = res.n;
      members.push(res);
    }
    out.push({ lead, label, pairs, bestMemberPairs, members });
  }
  return out;
}

/** The four accuracy box-plot distributions. */
export interface AccuracyDistributions {
  kge: PerLeadDistribution;
  r: PerLeadDistribution;
  beta: PerLeadDistribution;
  gamma: PerLeadDistribution;
}

export interface DistributionGates {
  /** Pairs a member needs before r, γ and KGE' are read from it. */
  minCorrelation: number;
  /** Pairs a member needs before β is read from it. */
  minRatio: number;
  /** Reason shown on a lead blanked by the correlation gate. */
  correlationReason: string;
  /** Reason shown on a lead blanked by the ratio gate. */
  ratioReason: string;
}

/**
 * KGE' / r / β / γ distributions from already-scored members.
 *
 * Gated PER MEMBER, on each member's own aligned pair count. The previous
 * version gated on the lead-level count and then admitted every member, so a
 * lead with plenty of overlap could still put a member scored on four points
 * into the same box as members scored on forty. See scoreMembersByLead.
 *
 * β keeps its lower bar — it is a ratio of means and survives a much smaller
 * sample than the joint moments do — but that exemption is now applied to the
 * member rather than to the whole lead.
 */
export function distributionsFrom(
  scores: LeadScores[],
  gates: DistributionGates,
): AccuracyDistributions {
  const mk = (): PerLeadDistribution => ({ leads: [], values: [], pairs: [], skipped: [] });
  const out: AccuracyDistributions = { kge: mk(), r: mk(), beta: mk(), gamma: mk() };
  const all = [out.kge, out.r, out.beta, out.gamma];

  for (const lead of scores) {
    for (const d of all) {
      d.leads.push(lead.lead);
      d.pairs!.push(lead.pairs);
    }

    const kVals: number[] = [];
    const rVals: number[] = [];
    const bVals: number[] = [];
    const gVals: number[] = [];
    for (const res of lead.members) {
      if (res.n >= gates.minCorrelation) {
        if (Number.isFinite(res.kge)) kVals.push(res.kge);
        if (Number.isFinite(res.r)) rVals.push(res.r);
        if (Number.isFinite(res.gamma)) gVals.push(res.gamma);
      }
      if (res.n >= gates.minRatio && Number.isFinite(res.beta)) bVals.push(res.beta);
    }

    out.kge.values.push(kVals);
    out.r.values.push(rVals);
    out.beta.values.push(bVals);
    out.gamma.values.push(gVals);

    // A reason only where the lead is actually blank, so a populated box never
    // carries a caveat and an empty one never carries none.
    const why = (vals: number[], reason: string) => (vals.length === 0 ? reason : null);
    out.kge.skipped!.push(why(kVals, gates.correlationReason));
    out.r.skipped!.push(why(rVals, gates.correlationReason));
    out.gamma.skipped!.push(why(gVals, gates.correlationReason));
    out.beta.skipped!.push(why(bVals, gates.ratioReason));
  }
  return out;
}
