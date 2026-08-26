import type { LeadBucket, LeadBuckets, TimeSeries } from '../types';
import { seasonalValues } from './season';

export interface CrpsPerLead {
  leads: number[];
  crps: number[];
  mae: number[];
  spread: number[];
  nTimesteps: number[];
  /**
   * CRPS of the climatological reference over the same timesteps as `crps`.
   * All NaN when no climatology was supplied.
   */
  refCrps: number[];
  /** CRPS skill score, 1 − crps/refCrps. NaN without a climatology. */
  crpss: number[];
}

/**
 * Climatological reference distribution, sampled from the retrospective record
 * around the event's time of year. Pre-sorted with prefix sums so that a
 * per-observation CRPS costs a binary search instead of a full pass over a
 * multi-decade sample.
 */
export interface ClimatologySample {
  /** Ascending sample values. */
  sorted: number[];
  /** prefix[k] = sum of sorted[0..k-1]. */
  prefix: number[];
  /** Spread term (1/(2N²)) ΣΣ|xᵢ − xⱼ| — constant for the sample. */
  spread: number;
  /** Calendar half-width, in days, used to select the sample. */
  windowDays: number;
}

/**
 * Build the climatological reference from the retrospective record, keeping
 * only values within ±`windowDays` of a day of year the event covers.
 *
 * Restricting by season matters: scored against the whole-record distribution,
 * any wet-season forecast looks skilful simply for predicting high flow in the
 * wet season. Returns null when too few values survive to form a distribution.
 */
export function buildClimatology(
  retro: TimeSeries,
  eventData: TimeSeries,
  windowDays = 15,
  minSample = 30,
): ClimatologySample | null {
  if (retro.time.length === 0 || eventData.time.length === 0) return null;

  const sample = seasonalValues(retro, eventData, windowDays);
  if (sample.length < minSample) return null;

  sample.sort((a, b) => a - b);

  const N = sample.length;
  const prefix = new Array<number>(N + 1).fill(0);
  for (let i = 0; i < N; i++) prefix[i + 1] = prefix[i] + sample[i];

  // Σᵢ Σⱼ |xᵢ − xⱼ| = 2 Σᵢ (2i − N + 1) xᵢ for ascending x, so the spread term
  // (1/(2N²))·ΣΣ reduces to (1/N²) Σᵢ (2i − N + 1) xᵢ. O(N) instead of O(N²).
  let weighted = 0;
  for (let i = 0; i < N; i++) weighted += (2 * i - N + 1) * sample[i];
  const spread = weighted / (N * N);

  return { sorted: sample, prefix, spread, windowDays };
}

/** CRPS of the climatological sample against a single observation. */
export function climatologyCrpsAt(c: ClimatologySample, obs: number): number {
  if (!Number.isFinite(obs)) return Number.NaN;
  const N = c.sorted.length;

  // k = count of sample values <= obs, by binary search.
  let lo = 0;
  let hi = N;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (c.sorted[mid] <= obs) lo = mid + 1;
    else hi = mid;
  }
  const k = lo;

  // mean|xᵢ − obs| = (1/N)[ obs(2k − N) − 2·prefix[k] + total ]
  const total = c.prefix[N];
  const mae = (obs * (2 * k - N) - 2 * c.prefix[k] + total) / N;
  return mae - c.spread;
}

/**
 * Per-timestep CRPS via the energy-score form (Gneiting & Raftery, 2007):
 *
 *     CRPS(t) = (1/M) Σ |X_m − obs|   −   (1/(2M²)) Σ Σ |X_m − X_m'|
 *             = MAE component         −   Spread
 *
 * Only finite members contribute; M is the count of finite members at that
 * timestep. Returns NaN when obs is missing or no members are finite.
 * Mirrors the notebook's `crps_ensemble_timestep`.
 */
export function crpsTimestep(
  members: number[],
  obs: number,
): { crps: number; mae: number; spread: number } {
  if (!Number.isFinite(obs)) {
    return { crps: Number.NaN, mae: Number.NaN, spread: Number.NaN };
  }
  const valid: number[] = [];
  for (const x of members) if (Number.isFinite(x)) valid.push(x);
  const M = valid.length;
  if (M === 0) return { crps: Number.NaN, mae: Number.NaN, spread: Number.NaN };

  let maeSum = 0;
  for (let i = 0; i < M; i++) maeSum += Math.abs(valid[i] - obs);
  const mae = maeSum / M;

  // (1/(2M²)) Σ_i Σ_j |X_i − X_j|.
  // Sum only the upper triangle (i<j) and double it — same total, half the work.
  let pairSum = 0;
  for (let i = 0; i < M; i++) {
    const xi = valid[i];
    for (let j = i + 1; j < M; j++) pairSum += Math.abs(xi - valid[j]);
  }
  const spread = pairSum / (M * M);

  return { crps: mae - spread, mae, spread };
}

/**
 * Mean CRPS, MAE component, and Spread per lead day over the temporal
 * overlap between the pooled lead bucket and the observed event series.
 * Mirrors the notebook's `compute_crps_by_lead`.
 *
 * CRPS collapses the 51 members to a single scalar at each timestep, so
 * this returns one number per lead (not a per-member distribution).
 */
export function computeCrpsByLead(
  buckets: LeadBuckets,
  eventData: TimeSeries,
  maxLead = 15,
  climatology?: ClimatologySample | null,
): CrpsPerLead {
  const out: CrpsPerLead = {
    leads: [],
    crps: [],
    mae: [],
    spread: [],
    nTimesteps: [],
    refCrps: [],
    crpss: [],
  };

  const obsMap = buildObsMap(eventData);
  const obsMin = eventData.time.length > 0 ? eventData.time[0].getTime() : Number.POSITIVE_INFINITY;
  const obsMax =
    eventData.time.length > 0
      ? eventData.time[eventData.time.length - 1].getTime()
      : Number.NEGATIVE_INFINITY;

  function pushEmpty() {
    out.crps.push(Number.NaN);
    out.mae.push(Number.NaN);
    out.spread.push(Number.NaN);
    out.nTimesteps.push(0);
    out.refCrps.push(Number.NaN);
    out.crpss.push(Number.NaN);
  }

  for (let lead = 0; lead <= maxLead; lead++) {
    out.leads.push(lead);
    const bucket = buckets[lead];
    if (!bucket || bucket.time.length === 0) {
      pushEmpty();
      continue;
    }

    // Overlap window: max(fcst.min, obs.min) → min(fcst.max, obs.max).
    const fMin = minTime(bucket);
    const fMax = maxTime(bucket);
    const start = Math.max(fMin, obsMin);
    const end = Math.min(fMax, obsMax);
    if (!(start <= end)) {
      pushEmpty();
      continue;
    }

    let crpsSum = 0;
    let maeSum = 0;
    let spreadSum = 0;
    let refSum = 0;
    let n = 0;
    for (let i = 0; i < bucket.time.length; i++) {
      const ms = bucket.time[i].getTime();
      if (ms < start || ms > end) continue;
      const obs = obsMap.get(ms);
      if (obs === undefined) continue;
      const r = crpsTimestep(bucket.members[i], obs);
      if (Number.isFinite(r.crps)) {
        crpsSum += r.crps;
        maeSum += r.mae;
        spreadSum += r.spread;
        // Reference is scored on exactly the timesteps the forecast was scored
        // on, so the ratio compares like with like.
        if (climatology) refSum += climatologyCrpsAt(climatology, obs);
        n += 1;
      }
    }

    if (n === 0) {
      pushEmpty();
    } else {
      const meanCrps = crpsSum / n;
      out.crps.push(meanCrps);
      out.mae.push(maeSum / n);
      out.spread.push(spreadSum / n);
      out.nTimesteps.push(n);
      if (climatology) {
        const ref = refSum / n;
        out.refCrps.push(ref);
        out.crpss.push(ref > 0 ? 1 - meanCrps / ref : Number.NaN);
      } else {
        out.refCrps.push(Number.NaN);
        out.crpss.push(Number.NaN);
      }
    }
  }
  return out;
}

function buildObsMap(s: TimeSeries): Map<number, number> {
  const m = new Map<number, number>();
  for (let i = 0; i < s.time.length; i++) {
    const v = s.values[i];
    if (Number.isFinite(v)) m.set(s.time[i].getTime(), v);
  }
  return m;
}

function minTime(b: LeadBucket): number {
  let m = Number.POSITIVE_INFINITY;
  for (const d of b.time) {
    const t = d.getTime();
    if (t < m) m = t;
  }
  return m;
}

function maxTime(b: LeadBucket): number {
  let m = Number.NEGATIVE_INFINITY;
  for (const d of b.time) {
    const t = d.getTime();
    if (t > m) m = t;
  }
  return m;
}
