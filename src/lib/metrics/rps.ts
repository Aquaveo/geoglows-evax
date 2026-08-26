import type { LeadBucket, RpThresholds, TimeSeries } from '../types';
import { RP_LEVELS } from '../types';

/**
 * Ranked probability score for ordered categories.
 *
 * RPS = Σₖ (CDFforecast(k) − CDFobserved(k))², summed over category boundaries.
 * Squaring the difference of CUMULATIVE probabilities is what makes it ordinal:
 * being one category out costs 1, two categories 4× less than being wrong by
 * chance would suggest — the penalty grows with distance.
 *
 * This is the property MCC and HSS lack entirely. They score "one return period
 * low" exactly like "four return periods low", which discards the severity
 * ladder the whole return-period design exists to express.
 *
 * It also uses the ensemble as an ensemble. MCC and HSS treat each of the 51
 * members as a separate deterministic forecast and take a median of the scores;
 * RPS reads the members as a probability distribution over categories, which is
 * what an ensemble actually is.
 */

/** Category index of a value against ordered thresholds: 0 = below the lowest. */
export function categoryOf(value: number, thresholds: number[]): number {
  let k = 0;
  for (let i = 0; i < thresholds.length; i++) {
    if (Number.isFinite(thresholds[i]) && value >= thresholds[i]) k = i + 1;
  }
  return k;
}

/** Ordered thresholds for the categories in use, lowest first. */
export function orderedThresholds(rp: RpThresholds, eventRp: number): number[] {
  const out: number[] = [];
  for (const level of RP_LEVELS) {
    if (level > eventRp) break;
    const t = rp[level];
    if (Number.isFinite(t)) out.push(t);
  }
  return out;
}

/** RPS for one timestep. `probs` must sum to 1 and be ordered low to high. */
export function rpsOne(probs: number[], observedCat: number): number {
  let cumF = 0;
  let cumO = 0;
  let total = 0;
  // The last boundary is skipped: both CDFs are 1 there by construction, so it
  // contributes nothing and including it would just add a zero.
  for (let k = 0; k < probs.length - 1; k++) {
    cumF += probs[k];
    cumO += k === observedCat ? 1 : 0;
    total += (cumF - cumO) ** 2;
  }
  return total;
}

/**
 * Below this, a climatological RPS is treated as untested rather than skilful.
 *
 * A backstop only — the structural test (was there any observed exceedance at
 * all) is what actually catches the real case. Set well under any reference a
 * genuinely contested window produces: a real near-miss event measured 8.7e-6
 * here, while a flood-dominated window measures ~1e0.
 */
const MIN_REFERENCE_RPS = 1e-3;

export interface RpsResult {
  leads: number[];
  /** Mean RPS of the ensemble at each lead. Lower is better. */
  rps: number[];
  /** Mean RPS of the climatological reference over the same timesteps. */
  rpsClim: number[];
  /** 1 − rps/rpsClim. NaN where the reference is degenerate — see `rpssSkipped`. */
  rpss: number[];
  /** Timesteps behind each lead. */
  n: number[];
  /** Climatological category probabilities used as the reference. */
  climatology: number[];
  /** Set when a lead could not be scored at all. */
  skipped: (string | null)[];
  /**
   * Set when RPS was scored but RPSS is not defined, and why.
   *
   * Separate from `skipped` because these are different outcomes: RPS is a
   * proper score and stands on its own, while RPSS is a ratio that needs a
   * reference which was actually put to the test.
   */
  rpssSkipped: (string | null)[];
  /** Observed exceedances of the lowest threshold behind each lead. */
  exceedances: number[];
}

/**
 * Climatological category frequencies from a long observed record.
 *
 * The reference has to be observed, not modelled, for the same reason CRPSS
 * requires it: a baseline built from model output inherits the model's bias and
 * is correspondingly easier to beat.
 */
export function climatologyFromRecord(
  record: TimeSeries,
  obsThresholds: number[],
): number[] {
  const counts = new Array<number>(obsThresholds.length + 1).fill(0);
  let n = 0;
  for (const v of record.values) {
    if (!Number.isFinite(v)) continue;
    counts[categoryOf(v, obsThresholds)] += 1;
    n += 1;
  }
  if (n === 0) return counts.map(() => 1 / counts.length);
  // A category never seen still needs non-zero probability, or the reference
  // becomes infinitely confident and RPSS is undefined the first time it occurs.
  const floor = 1 / (n + counts.length);
  const raw = counts.map((c) => Math.max(c / n, floor));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((p) => p / sum);
}

export interface RpsOptions {
  maxLead?: number;
  minPairs?: number;
}

/**
 * RPS, climatological RPS and RPSS per lead day.
 *
 * Report RPSS rather than RPS when comparing across events. Raw RPS is a mean
 * over timesteps, so padding a window with quiet days drives it toward zero
 * regardless of skill. RPSS is far more stable, because the reference absorbs
 * the same easy timesteps — measured drift is about 0.01 across an 800-fold
 * increase in window length, against 0.37 for MCC over comparable padding.
 */
export function rpsByLead(
  buckets: Record<number, LeadBucket | undefined>,
  observed: TimeSeries,
  obsThresholds: number[],
  simThresholds: number[],
  climatology: number[],
  opts: RpsOptions = {},
): RpsResult {
  const maxLead = opts.maxLead ?? 15;
  const minPairs = opts.minPairs ?? 5;
  const out: RpsResult = {
    leads: [],
    rps: [],
    rpsClim: [],
    rpss: [],
    n: [],
    climatology,
    skipped: [],
    rpssSkipped: [],
    exceedances: [],
  };

  const obsAt = new Map<number, number>();
  for (let i = 0; i < observed.time.length; i++) {
    const v = observed.values[i];
    if (Number.isFinite(v)) obsAt.set(observed.time[i].getTime(), v);
  }

  for (let lead = 0; lead <= maxLead; lead++) {
    out.leads.push(lead);
    const bucket = buckets[lead];
    if (!bucket || bucket.time.length === 0) {
      out.rps.push(Number.NaN);
      out.rpsClim.push(Number.NaN);
      out.rpss.push(Number.NaN);
      out.n.push(0);
      out.exceedances.push(0);
      out.skipped.push('no forecast data');
      out.rpssSkipped.push(null);
      continue;
    }

    let sum = 0;
    let sumClim = 0;
    let n = 0;
    let exceedances = 0;
    for (let t = 0; t < bucket.time.length; t++) {
      const o = obsAt.get(bucket.time[t].getTime());
      if (o === undefined) continue;
      const members = bucket.members[t] ?? [];
      const counts = new Array<number>(simThresholds.length + 1).fill(0);
      let m = 0;
      for (const v of members) {
        if (!Number.isFinite(v)) continue;
        // Forecasts classified against SIMULATED thresholds and observations
        // against OBSERVED ones — the app's dual-threshold convention, which
        // absorbs magnitude bias rather than correcting for it.
        counts[categoryOf(v, simThresholds)] += 1;
        m += 1;
      }
      if (m === 0) continue;
      const probs = counts.map((c) => c / m);
      const obsCat = categoryOf(o, obsThresholds);
      if (obsCat > 0) exceedances += 1;
      sum += rpsOne(probs, obsCat);
      sumClim += rpsOne(climatology, obsCat);
      n += 1;
    }

    if (n < minPairs) {
      out.rps.push(Number.NaN);
      out.rpsClim.push(Number.NaN);
      out.rpss.push(Number.NaN);
      out.n.push(n);
      out.exceedances.push(exceedances);
      out.skipped.push(`only ${n} overlapping timestep${n === 1 ? '' : 's'}`);
      out.rpssSkipped.push(null);
      continue;
    }
    const rps = sum / n;
    const rpsClim = sumClim / n;
    out.rps.push(rps);
    out.rpsClim.push(rpsClim);
    out.n.push(n);
    out.exceedances.push(exceedances);
    out.skipped.push(null);

    // RPSS needs a reference that was actually tested.
    //
    // If nothing in the scored window crossed even the lowest threshold, the
    // climatological reference was right at every timestep almost by
    // construction: it puts ~99.7% of its mass on "below the 2-year level" and
    // that is what happened. Its RPS collapses toward zero — measured at 8.7e-6
    // on a real near-miss event — and RPSS = 1 − rps/rpsClim explodes. Guarding
    // only `rpsClim === 0` let that through: a moderate event produced RPSS of
    // −2266 to −3421, which then set the panel's axis and compressed every other
    // lead's bar to under a tenth of a percent of the plot height.
    //
    // The structural test is the real guard; the floor is a backstop for any
    // other route to a near-perfect reference.
    const reason =
      exceedances === 0
        ? 'no observed exceedance in this window, so the climatological reference is right by default'
        : rpsClim < MIN_REFERENCE_RPS
          ? 'climatological reference is degenerate (RPS below ' + MIN_REFERENCE_RPS + ')'
          : null;
    out.rpss.push(reason ? Number.NaN : 1 - rps / rpsClim);
    out.rpssSkipped.push(reason);
  }
  return out;
}
