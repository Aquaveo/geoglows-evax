import type { TimeSeries } from '../types';
import { maxOf } from '../arrayStats';

/** Simulated/observed pairs on a shared daily grid. */
export interface PairedRecord {
  /** Day key (YYYY-MM-DD) per pair, kept so seasonal splits need no re-alignment. */
  days: string[];
  sim: number[];
  obs: number[];
  /** Days present in one series but not the other. */
  simOnly: number;
  obsOnly: number;
}

/** UTC day key. The retrospective and an uploaded record rarely share a cadence. */
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Daily means of both series, inner-joined on the day.
 *
 * Both sides are reduced to daily means rather than one being interpolated onto
 * the other: the retrospective is hourly and an uploaded record is usually daily,
 * so the common grid is the coarser of the two. This is the same rule the event
 * path uses, applied to a multi-decade record.
 */
export function pairDaily(sim: TimeSeries, obs: TimeSeries): PairedRecord {
  const bucket = (s: TimeSeries) => {
    const sums = new Map<string, { total: number; n: number }>();
    for (let i = 0; i < s.time.length; i++) {
      const v = s.values[i];
      if (!Number.isFinite(v)) continue;
      const k = dayKey(s.time[i]);
      const cur = sums.get(k);
      if (cur) {
        cur.total += v;
        cur.n += 1;
      } else {
        sums.set(k, { total: v, n: 1 });
      }
    }
    const out = new Map<string, number>();
    for (const [k, v] of sums) out.set(k, v.total / v.n);
    return out;
  };

  const S = bucket(sim);
  const O = bucket(obs);
  const days: string[] = [];
  const simV: number[] = [];
  const obsV: number[] = [];
  for (const [k, v] of S) {
    const o = O.get(k);
    if (o === undefined) continue;
    days.push(k);
    simV.push(v);
    obsV.push(o);
  }
  // Chronological, so seasonal and rolling views need no further sorting.
  const idx = days.map((_, i) => i).sort((a, b) => (days[a] < days[b] ? -1 : 1));
  return {
    days: idx.map((i) => days[i]),
    sim: idx.map((i) => simV[i]),
    obs: idx.map((i) => obsV[i]),
    simOnly: S.size - days.length,
    obsOnly: O.size - days.length,
  };
}

export interface ConditionalBin {
  /** Mean simulated value in the bin — the x position. */
  sim: number;
  /** Mean observed value given that simulated range — E[obs | sim]. */
  obs: number;
  /** Bin bounds on the simulated value. */
  lo: number;
  hi: number;
  n: number;
}

export interface MurphyDecomposition {
  /** Type-I conditional bias. Adds to MSE; zero is perfect calibration. */
  rel: number;
  /** Resolution. Subtracts from MSE; larger means the model discriminates. */
  res: number;
  /** var(observed) — the MSE of always predicting the observed mean. */
  unc: number;
  mse: number;
  /**
   * How far REL − RES + var(obs) misses MSE, as a percentage.
   *
   * The decomposition is exact only for discrete forecasts. With continuous
   * discharge the within-bin spread is discarded, and that residual is this
   * number. It shrinks as bins are added, so it is reported rather than hidden —
   * a large value means the bin count is too low to trust the split.
   */
  closurePct: number;
  bins: ConditionalBin[];
  /** Least-squares slope of E[obs|sim]. 1 means correctly scaled spread. */
  slope: number;
  n: number;
  /**
   * Bins actually used, which is at most the number requested. Tied simulated
   * values collapse quantile edges, so a record with a flat baseflow yields
   * fewer usable bins than asked for.
   */
  binsUsed: number;
}

/**
 * Murphy's (1973) calibration–refinement split of MSE, on a long record.
 *
 * MSE = REL − RES + var(obs), where REL is how far the conditional mean of the
 * observations departs from what was simulated, and RES is how far that
 * conditional mean moves away from the overall observed mean. A model can order
 * events correctly (high RES) and still lose to climatology if its magnitudes
 * are wrong (higher REL) — which one number cannot tell you.
 *
 * Requires a large sample. Under a null of zero true resolution the apparent RES
 * is roughly (K−1)·var(obs)/n, so a few hundred pairs across ten bins produces
 * substantial resolution from noise alone. Intended for multi-decade records,
 * not for a single event.
 */
export function murphyDecomposition(
  sim: number[],
  obs: number[],
  binCount = 50,
): MurphyDecomposition | null {
  const n = sim.length;
  if (n < binCount * 4) return null;

  const sorted = [...sim].sort((a, b) => a - b);

  // Bin lower bounds on the simulated value.
  //
  // A discharge record is full of ties — a flat baseflow, repeated zeros — and
  // tied values collapse adjacent quantile edges. Two cases, because they need
  // opposite treatment:
  //
  //  - few DISTINCT values (at most the bin count): use those values as the
  //    bounds. Every bin then holds one value, there is no within-bin spread,
  //    and the decomposition closes exactly.
  //  - many distinct values: quantile bounds, deduplicated so a run of ties
  //    cannot swallow several bins into one.
  //
  // Either way the effective count can be lower than requested, which
  // `binsUsed` reports rather than hides.
  const distinct: number[] = [];
  for (const v of sorted) if (distinct.length === 0 || v > distinct[distinct.length - 1]) distinct.push(v);

  let lowerBounds: number[];
  if (distinct.length <= binCount) {
    lowerBounds = distinct;
  } else {
    const raw: number[] = [];
    for (let i = 0; i < binCount; i++) {
      raw.push(sorted[Math.min(Math.floor((i / binCount) * (n - 1)), n - 1)]);
    }
    lowerBounds = raw.filter((v, i) => i === 0 || v > raw[i - 1]);
  }
  const binsUsed = lowerBounds.length;
  if (binsUsed < 2) return null;
  // Upper sentinel past the maximum, so the top bin is inclusive.
  const top = maxOf(sim, lowerBounds[binsUsed - 1]);
  const edges = [...lowerBounds, top + Math.abs(top) * 1e-12 + 1e-9];

  const assign = (v: number) => {
    let lo = 0;
    let hi = binsUsed - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (v >= edges[mid]) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  const idx = sim.map(assign);
  const obsMean = obs.reduce((a, b) => a + b, 0) / n;

  const bins: ConditionalBin[] = [];
  const condObs = new Array<number>(binsUsed).fill(Number.NaN);
  for (let k = 0; k < binsUsed; k++) {
    let sS = 0;
    let sO = 0;
    let c = 0;
    for (let i = 0; i < n; i++) {
      if (idx[i] !== k) continue;
      sS += sim[i];
      sO += obs[i];
      c += 1;
    }
    if (c === 0) continue;
    condObs[k] = sO / c;
    bins.push({ sim: sS / c, obs: sO / c, lo: edges[k], hi: edges[k + 1], n: c });
  }

  let rel = 0;
  let mse = 0;
  for (let i = 0; i < n; i++) {
    const target = condObs[idx[i]];
    // Each point's OWN simulated value against its bin's conditional mean. Using
    // the bin's mean simulated value instead inflates the closure error.
    if (Number.isFinite(target)) rel += (sim[i] - target) ** 2;
    mse += (sim[i] - obs[i]) ** 2;
  }
  rel /= n;
  mse /= n;

  let res = 0;
  for (const b of bins) res += (b.n / n) * (b.obs - obsMean) ** 2;
  const unc = obs.reduce((a, v) => a + (v - obsMean) ** 2, 0) / n;

  // Least-squares slope through the conditional means, weighted by bin count.
  let wx = 0;
  let wy = 0;
  let wt = 0;
  for (const b of bins) {
    wx += b.n * b.sim;
    wy += b.n * b.obs;
    wt += b.n;
  }
  const mx = wx / wt;
  const my = wy / wt;
  let num = 0;
  let den = 0;
  for (const b of bins) {
    num += b.n * (b.sim - mx) * (b.obs - my);
    den += b.n * (b.sim - mx) ** 2;
  }

  return {
    rel,
    res,
    unc,
    mse,
    closurePct: mse === 0 ? 0 : ((rel - res + unc - mse) / mse) * 100,
    bins,
    binsUsed,
    slope: den === 0 ? Number.NaN : num / den,
    n,
  };
}

export interface MonthBias {
  /** Calendar month, 1–12. */
  month: number;
  meanSim: number;
  meanObs: number;
  /** meanSim / meanObs. Below 1 means the model runs low that month. */
  ratio: number;
  n: number;
}

/**
 * Mean simulated over mean observed, per calendar month.
 *
 * Worth its own view because the bias correction the app applies is monthly: a
 * ratio that swings across the year means one global correction cannot work, and
 * a ratio that changes sign means even a monthly multiplicative one will not.
 */
export function monthlyBias(rec: PairedRecord): MonthBias[] {
  const acc = new Map<number, { s: number; o: number; n: number }>();
  for (let i = 0; i < rec.days.length; i++) {
    const m = Number(rec.days[i].slice(5, 7));
    const cur = acc.get(m) ?? { s: 0, o: 0, n: 0 };
    cur.s += rec.sim[i];
    cur.o += rec.obs[i];
    cur.n += 1;
    acc.set(m, cur);
  }
  const out: MonthBias[] = [];
  for (let m = 1; m <= 12; m++) {
    const a = acc.get(m);
    if (!a || a.n === 0) continue;
    out.push({
      month: m,
      meanSim: a.s / a.n,
      meanObs: a.o / a.n,
      ratio: a.o === 0 ? Number.NaN : a.s / a.o,
      n: a.n,
    });
  }
  return out;
}

export interface FdcPoint {
  /** Fraction of time this value is equalled or exceeded, 0–1. */
  exceedance: number;
  value: number;
}

/**
 * Flow duration curve: value against exceedance probability.
 *
 * The standard hydrological view of where in the flow range a model fails.
 * Two curves on one axis separate a whole-range offset from a tail-only problem,
 * which the aggregate metrics cannot.
 */
export function flowDurationCurve(values: number[], points = 200): FdcPoint[] {
  const v = values.filter(Number.isFinite).sort((a, b) => b - a);
  if (v.length === 0) return [];
  const out: FdcPoint[] = [];
  for (let i = 0; i < points; i++) {
    // Log-spaced in exceedance so the tail, where floods live, keeps detail.
    const p = Math.pow(10, -3 + (3 * i) / (points - 1));
    const idx = Math.min(Math.floor(p * v.length), v.length - 1);
    out.push({ exceedance: p, value: v[idx] });
  }
  return out;
}

/** Headline agreement statistics over the paired record. */
export interface RecordSummary {
  n: number;
  years: number;
  nse: number;
  /** Pearson correlation. */
  r: number;
  /** meanSim / meanObs. */
  beta: number;
  /** CV ratio: (sdSim/meanSim) / (sdObs/meanObs). */
  gamma: number;
  kge: number;
  rmse: number;
  pbias: number;
  simMax: number;
  obsMax: number;
}

export function summarise(rec: PairedRecord): RecordSummary | null {
  const n = rec.sim.length;
  if (n < 2) return null;
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const ms = mean(rec.sim);
  const mo = mean(rec.obs);
  let sse = 0;
  let sso = 0;
  let cov = 0;
  let vs = 0;
  let vo = 0;
  for (let i = 0; i < n; i++) {
    sse += (rec.sim[i] - rec.obs[i]) ** 2;
    sso += (rec.obs[i] - mo) ** 2;
    cov += (rec.sim[i] - ms) * (rec.obs[i] - mo);
    vs += (rec.sim[i] - ms) ** 2;
    vo += (rec.obs[i] - mo) ** 2;
  }
  const sdS = Math.sqrt(vs / n);
  const sdO = Math.sqrt(vo / n);
  const r = sdS === 0 || sdO === 0 ? Number.NaN : cov / n / (sdS * sdO);
  const beta = mo === 0 ? Number.NaN : ms / mo;
  const gamma = ms === 0 || sdO === 0 || mo === 0 ? Number.NaN : sdS / ms / (sdO / mo);
  const kge =
    Number.isFinite(r) && Number.isFinite(beta) && Number.isFinite(gamma)
      ? 1 - Math.sqrt((r - 1) ** 2 + (beta - 1) ** 2 + (gamma - 1) ** 2)
      : Number.NaN;
  const first = rec.days[0];
  const last = rec.days[rec.days.length - 1];
  const years =
    (new Date(last).getTime() - new Date(first).getTime()) / (365.25 * 24 * 3600 * 1000);
  return {
    n,
    years,
    nse: sso === 0 ? Number.NaN : 1 - sse / sso,
    r,
    beta,
    gamma,
    kge,
    rmse: Math.sqrt(sse / n),
    pbias: mo === 0 ? Number.NaN : ((ms - mo) / mo) * 100,
    simMax: maxOf(rec.sim, Number.NaN),
    obsMax: maxOf(rec.obs, Number.NaN),
  };
}

/** Expected apparent resolution when the true value is zero — the noise floor. */
export function noiseFloorRes(unc: number, binCount: number, n: number): number {
  // Under zero true resolution the apparent value is about (K−1)·var/n. Verified
  // by simulation against the published bias formulae.
  return ((binCount - 1) * unc) / n;
}
