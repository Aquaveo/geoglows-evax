import type { LeadBucket, LeadBuckets, TimeSeries } from '../types';

export interface CrpsPerLead {
  leads: number[];
  crps: number[];
  mae: number[];
  spread: number[];
  nTimesteps: number[];
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
): CrpsPerLead {
  const out: CrpsPerLead = {
    leads: [],
    crps: [],
    mae: [],
    spread: [],
    nTimesteps: [],
  };

  const obsMap = buildObsMap(eventData);
  const obsMin = eventData.time.length > 0 ? eventData.time[0].getTime() : Number.POSITIVE_INFINITY;
  const obsMax =
    eventData.time.length > 0
      ? eventData.time[eventData.time.length - 1].getTime()
      : Number.NEGATIVE_INFINITY;

  for (let lead = 0; lead <= maxLead; lead++) {
    out.leads.push(lead);
    const bucket = buckets[lead];
    if (!bucket || bucket.time.length === 0) {
      out.crps.push(Number.NaN);
      out.mae.push(Number.NaN);
      out.spread.push(Number.NaN);
      out.nTimesteps.push(0);
      continue;
    }

    // Overlap window: max(fcst.min, obs.min) → min(fcst.max, obs.max).
    const fMin = minTime(bucket);
    const fMax = maxTime(bucket);
    const start = Math.max(fMin, obsMin);
    const end = Math.min(fMax, obsMax);
    if (!(start <= end)) {
      out.crps.push(Number.NaN);
      out.mae.push(Number.NaN);
      out.spread.push(Number.NaN);
      out.nTimesteps.push(0);
      continue;
    }

    let crpsSum = 0;
    let maeSum = 0;
    let spreadSum = 0;
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
        n += 1;
      }
    }

    if (n === 0) {
      out.crps.push(Number.NaN);
      out.mae.push(Number.NaN);
      out.spread.push(Number.NaN);
      out.nTimesteps.push(0);
    } else {
      out.crps.push(crpsSum / n);
      out.mae.push(maeSum / n);
      out.spread.push(spreadSum / n);
      out.nTimesteps.push(n);
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
