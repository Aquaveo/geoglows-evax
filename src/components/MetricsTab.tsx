import { useMemo, useState } from 'react';
import { useApp } from '../state/AppContext';
import { reorganizeByLead, memberSeries, statSeries, type StatKey } from '../lib/leadBuckets';
import type { LeadBucket, TimeSeries } from '../lib/types';
import {
  buildContingencyMatrix,
  determineEventReturnPeriod,
  type ContingencyResult,
} from '../lib/metrics/contingency';
import { computeMcc } from '../lib/metrics/mcc';
import { computeHss } from '../lib/metrics/hss';
import { computePeakTimingError } from '../lib/metrics/peakTiming';
import { computePeakTimingByRun } from '../lib/metrics/peakTimingByRun';
import { computeThresholdCrossing } from '../lib/metrics/thresholdCrossing';
import { kge } from '../lib/metrics/kge';
import { computeCrpsByLead, buildClimatology, type CrpsPerLead } from '../lib/metrics/crps';
import { Plot } from './Plot';
import {
  distributionVsLeadFigure,
  type PerLeadDistribution,
} from '../plots/distributionVsLead';
import { crpsPerLeadFigure } from '../plots/crpsPerLead';
import { crpssPerLeadFigure } from '../plots/crpssPerLead';
import { contingencySeriesFigure } from '../plots/contingencySeries';
import { skillBarsFigure } from '../plots/skillBars';
import { skillByLead, skillByRun } from '../lib/metrics/skillSummary';
import { correctForecasts } from '../lib/bias/correctForecasts';
import { correctionEffectByLead } from '../lib/bias/correctionEffect';
import { biasCdfsFigure, biasTransferFigure } from '../plots/biasTransfer';
import { biasHydrographFigure } from '../plots/biasHydrograph';
import type { BiasCorrection } from '../lib/bias/correctForecasts';
import { PlotNote } from './PlotNote';
import { detectCadence } from '../lib/ingest/cadence';
import {
  aggregateBucket,
  aggregateSeries,
  bucketCadence,
  chooseGrid,
  type Aggregation,
} from '../lib/ingest/grid';
import type { LeadBuckets } from '../lib/types';
import { RP_LEVELS } from '../lib/types';
import type { CrossingDetection } from '../state/AppContext';

const MAX_LEAD = 15;
const MEMBER_COUNT = 51;
/** Calendar half-width for sampling the climatological reference used by CRPSS. */
const CLIMATOLOGY_WINDOW_DAYS = 15;
const DAY_MS = 24 * 3600 * 1000;

/**
 * Minimum forecast/observation pairs before a correlation-shaped score means
 * anything. r, γ and KGE' are joint moments; on a handful of points they are
 * dominated by noise, and the box plot renders that noise as a confident-looking
 * distribution. MCC and HSS are chance-corrected over a contingency table and
 * need comparable support.
 */
const MIN_PAIRS_CORRELATION = 10;
/** Ratio-of-means scores (β) survive a much smaller sample. */
const MIN_PAIRS_RATIO = 3;
const FEW_PAIRS_REASON = `fewer than ${MIN_PAIRS_CORRELATION} forecast/observation pairs at this resolution`;
const TOO_FEW_FOR_RATIO = `fewer than ${MIN_PAIRS_RATIO} pairs`;

/** Which forecast values a metric family is showing. */
export type MetricVariant = 'raw' | 'corrected';

/** Pairs at one lead: grid bins where both a forecast and an observation exist. */
function countPairs(bucket: LeadBucket | undefined, obs: TimeSeries): number {
  if (!bucket || bucket.time.length === 0) return 0;
  const keys = new Set(obs.time.map((d) => d.getTime()));
  let n = 0;
  for (const t of bucket.time) if (keys.has(t.getTime())) n++;
  return n;
}

/** Bring one set of lead buckets and the observations onto the comparison grid. */
function griddedFor(
  buckets: LeadBuckets,
  eventData: TimeSeries,
  stepMs: number,
  how: Aggregation,
): { obs: TimeSeries; buckets: LeadBuckets } {
  const obs = aggregateSeries(eventData, stepMs, how);
  const out: LeadBuckets = {};
  for (let lead = 0; lead <= MAX_LEAD; lead++) {
    out[lead] = aggregateBucket(buckets[lead], stepMs, how);
  }
  return { obs, buckets: out };
}

export interface AccuracyDistributions {
  kge: PerLeadDistribution;
  r: PerLeadDistribution;
  beta: PerLeadDistribution;
  gamma: PerLeadDistribution;
}

/**
 * KGE' and its components per lead, across ensemble members.
 *
 * Pure so that the raw and bias-corrected variants are computed by the same
 * code — anything that diverged between them would be indistinguishable from a
 * real difference in the forecasts.
 */
function accuracyDistributions(
  buckets: LeadBuckets,
  eventData: TimeSeries,
): AccuracyDistributions {
  const mk = (): PerLeadDistribution => ({ leads: [], values: [], pairs: [], skipped: [] });
  const kgeDist = mk();
  const rDist = mk();
  const betaDist = mk();
  const gammaDist = mk();

  for (let lead = 0; lead <= MAX_LEAD; lead++) {
    kgeDist.leads.push(lead);
    rDist.leads.push(lead);
    betaDist.leads.push(lead);
    gammaDist.leads.push(lead);

    const kVals: number[] = [];
    const rVals: number[] = [];
    const bVals: number[] = [];
    const gVals: number[] = [];

    const bucket = buckets[lead];
    const pairs = countPairs(bucket, eventData);
    for (const dist of [kgeDist, rDist, betaDist, gammaDist]) dist.pairs!.push(pairs);

    // r, γ and KGE' are joint moments and need a real sample. β is a ratio of
    // means and survives a much smaller one, so it is guarded separately rather
    // than being suppressed alongside them.
    const tooFewForCorrelation = pairs < MIN_PAIRS_CORRELATION;
    const tooFewForRatio = pairs < MIN_PAIRS_RATIO;
    kgeDist.skipped!.push(tooFewForCorrelation ? FEW_PAIRS_REASON : null);
    rDist.skipped!.push(tooFewForCorrelation ? FEW_PAIRS_REASON : null);
    gammaDist.skipped!.push(tooFewForCorrelation ? FEW_PAIRS_REASON : null);
    betaDist.skipped!.push(tooFewForRatio ? TOO_FEW_FOR_RATIO : null);

    if (bucket && bucket.time.length > 0) {
      for (let m = 0; m < MEMBER_COUNT; m++) {
        const result = kge(memberSeries(bucket, m), eventData);
        if (!tooFewForCorrelation) {
          if (Number.isFinite(result.kge)) kVals.push(result.kge);
          if (Number.isFinite(result.r)) rVals.push(result.r);
          if (Number.isFinite(result.gamma)) gVals.push(result.gamma);
        }
        if (!tooFewForRatio && Number.isFinite(result.beta)) bVals.push(result.beta);
      }
    }
    kgeDist.values.push(kVals);
    rDist.values.push(rVals);
    betaDist.values.push(bVals);
    gammaDist.values.push(gVals);
  }

  return { kge: kgeDist, r: rDist, beta: betaDist, gamma: gammaDist };
}

const STAT_OPTIONS: { key: StatKey; label: string }[] = [
  { key: 'median', label: 'Ensemble median' },
  { key: 'mean', label: 'Ensemble mean' },
  { key: 'p25', label: 'Ensemble p25' },
  { key: 'p75', label: 'Ensemble p75' },
  { key: 'min', label: 'Ensemble min' },
  { key: 'max', label: 'Ensemble max' },
];

/**
 * Raw / bias-corrected switch. A labelled <select> because that is the only
 * selector idiom in this codebase — there are no checkbox or toggle components
 * anywhere in src/.
 *
 * Rendered once per block rather than globally: Categorical and Timing
 * deliberately have no corrected variant (their dual-threshold classification
 * already absorbs magnitude bias), so a global control would imply they switch.
 */
function VariantSelect({
  value,
  onChange,
  disabledReason,
}: {
  value: MetricVariant;
  onChange: (v: MetricVariant) => void;
  disabledReason: string | null;
}) {
  return (
    <label style={lbl}>
      Forecasts:&nbsp;
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as MetricVariant)}
        style={sel}
      >
        <option value="raw">Raw</option>
        <option value="corrected" disabled={!!disabledReason}>
          Bias-corrected{disabledReason ? ` — ${disabledReason}` : ''}
        </option>
      </select>
    </label>
  );
}

/** What the correction actually did, so corrected numbers are never unexplained. */
function CorrectionBanner({ c }: { c: BiasCorrection }) {
  return (
    <div style={correctionBanner}>
      <strong>Bias-corrected</strong> by monthly quantile mapping of the forecasts onto the
      uploaded observed record ({c.observedCadence}), using the retrospective (
      {c.simulatedCadence}) as the simulated distribution.
      <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.2rem' }}>
        {c.months.map((m) => (
          <li key={m.month}>
            Month {m.month}:{' '}
            {m.ok
              ? `${m.nSimulated} simulated and ${m.nObserved} observed values in season`
              : `no mapping — ${m.reason}`}
            {m.degenerateRange && ' — flat record, the mapping collapses'}
            {m.ok && m.lowResolution && (
              <>
                {' '}
                — <strong>low resolution</strong>: {Math.round(m.simMaxBinShare * 100)}% of
                simulated and {Math.round(m.obsMaxBinShare * 100)}% of observed values fall in a
                single histogram bin, so the mapping has little detail where the data is and
                behaves close to a constant scale factor. Check the transfer curve.
              </>
            )}
          </li>
        ))}
        {c.excluded.length > 0 && (
          <li>
            <strong>{c.excluded.length} run{c.excluded.length === 1 ? '' : 's'} excluded:</strong>{' '}
            {c.excluded.slice(0, 3).map((e) => `${e.date} (${e.reason})`).join('; ')}
            {c.excluded.length > 3 && ` and ${c.excluded.length - 3} more`}
          </li>
        )}
        {c.nanKeptRaw > 0 && (
          <li>
            {c.nanKeptRaw} member-timestep{c.nanKeptRaw === 1 ? '' : 's'} kept their{' '}
            <em>raw</em> value: below the simulated monthly minimum the mapping is undefined,
            and the reference retains the original number there.
          </li>
        )}
        {c.negativeClipped > 0 && <li>{c.negativeClipped} negative results clipped to zero.</li>}
      </ul>
    </div>
  );
}

export function MetricsTab() {
  const app = useApp();
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Contingency matrix viewer selection
  const [matrixLead, setMatrixLead] = useState(3);
  const [matrixSeriesKey, setMatrixSeriesKey] = useState<string>('stat:median');

  // Timing metrics state
  const [computingTiming, setComputingTiming] = useState(false);
  const [timingError, setTimingError] = useState<string | null>(null);
  const [crossingRp, setCrossingRp] = useState<number>(2);

  // Accuracy metrics state
  const [computingAccuracy, setComputingAccuracy] = useState(false);
  const [accuracyError, setAccuracyError] = useState<string | null>(null);

  // Probabilistic (CRPS) state
  const [computingCrps, setComputingCrps] = useState(false);
  const [crpsError, setCrpsError] = useState<string | null>(null);

  // Bias-corrected variants. Local state rather than AppContext: app.leadBuckets
  // must keep meaning *raw* for ForecastTab, and the context's dependency array
  // is manual and already long.
  const [correctedAccuracy, setCorrectedAccuracy] = useState<AccuracyDistributions | null>(null);
  const [correctedCrps, setCorrectedCrps] = useState<CrpsPerLead | null>(null);
  const [accuracyVariant, setAccuracyVariant] = useState<MetricVariant>('raw');
  const [skillVariant, setSkillVariant] = useState<MetricVariant>('raw');
  const [crpsVariant, setCrpsVariant] = useState<MetricVariant>('raw');
  const [biasMonth, setBiasMonth] = useState<number | null>(null);
  const [biasRunDate, setBiasRunDate] = useState<string | null>(null);

  const canCompute = !!(
    app.eventData &&
    app.forecasts.size > 0 &&
    app.obsRp &&
    app.simRp
  );

  // --- Resolution contract ---------------------------------------------------
  // Comparison runs at the coarser of the two cadences. Both sides are brought
  // onto that grid before any metric sees them, which also snaps timestamps to
  // exact bin boundaries so the metrics' exact-time matching keeps working.
  const obsCadence = useMemo(
    () => (app.eventData ? detectCadence(app.eventData) : null),
    [app.eventData],
  );

  const rawBuckets = useMemo(
    () => (app.forecasts.size > 0 ? (app.leadBuckets ?? reorganizeByLead(app.forecasts, MAX_LEAD)) : null),
    [app.leadBuckets, app.forecasts],
  );

  const fcstCadence = useMemo(() => {
    if (!rawBuckets) return null;
    // Lead 1 is representative: a full day of the run's native output.
    for (let lead = 1; lead <= MAX_LEAD; lead++) {
      const c = bucketCadence(rawBuckets[lead]);
      if (c) return c;
    }
    return null;
  }, [rawBuckets]);

  const grid = useMemo(
    () => (obsCadence && fcstCadence ? chooseGrid(obsCadence, fcstCadence) : null),
    [obsCadence, fcstCadence],
  );

  // 'mean' preserves volume for error/distribution scores; 'max' preserves
  // threshold exceedance for the categorical and crossing families. Both are
  // built in one memo so they stay in step with the underlying data.
  const gridded = useMemo(() => {
    if (!app.eventData || !rawBuckets || !grid) return null;
    return {
      mean: griddedFor(rawBuckets, app.eventData, grid.stepMs, 'mean'),
      max: griddedFor(rawBuckets, app.eventData, grid.stepMs, 'max'),
    };
  }, [app.eventData, rawBuckets, grid]);

  const griddedMean = gridded?.mean ?? null;
  const griddedMax = gridded?.max ?? null;

  // --- Bias correction ------------------------------------------------------
  // Correction runs on RAW forecast values, upstream of lead-bucketing and grid
  // aggregation, because quantile mapping is nonlinear: correcting a bin mean is
  // not the mean of corrected values.
  const correction = useMemo(() => {
    if (app.forecasts.size === 0 || !app.retro || !app.historicalData) return null;
    return correctForecasts(app.forecasts, app.retro, app.historicalData);
  }, [app.forecasts, app.retro, app.historicalData]);

  const correctedBuckets = useMemo(
    () =>
      correction && correction.forecasts.size > 0
        ? reorganizeByLead(correction.forecasts, MAX_LEAD)
        : null,
    [correction],
  );

  // Reuses the SAME grid as the raw side. Correction changes values, not
  // timestamps — but excluding runs removes timestamps, which could shift
  // bucketCadence's median and select a different grid. The two variants must
  // share one grid or they are not comparable.
  //
  // Only 'mean' is built: Categorical and Timing stay raw-only, so 'max' is
  // never needed here.
  const griddedCorrected = useMemo(() => {
    if (!app.eventData || !correctedBuckets || !grid) return null;
    return griddedFor(correctedBuckets, app.eventData, grid.stepMs, 'mean');
  }, [app.eventData, correctedBuckets, grid]);

  const correctedAvailable = !!griddedCorrected;

  /** Why the corrected variant cannot be offered, if it cannot. */
  const correctedUnavailableReason = useMemo(() => {
    if (correctedAvailable) return null;
    if (!app.historicalData) return 'upload historical observations on the Setup tab';
    if (!app.retro) return 'load a reach on the Setup tab';
    if (app.forecasts.size === 0) return 'download forecasts on the Forecast tab';
    return correction?.unavailable ?? 'correction produced no usable runs';
  }, [correctedAvailable, app.historicalData, app.retro, app.forecasts.size, correction]);

  /** Pairs available per lead once both sides are on the grid. */
  const pairsPerLead = useMemo(() => {
    if (!griddedMean) return null;
    const obsKeys = new Set(griddedMean.obs.time.map((d) => d.getTime()));
    let best = 0;
    for (let lead = 1; lead <= MAX_LEAD; lead++) {
      const b = griddedMean.buckets[lead];
      if (!b) continue;
      let n = 0;
      for (const t of b.time) if (obsKeys.has(t.getTime())) n++;
      if (n > best) best = n;
    }
    return best;
  }, [griddedMean]);

  /**
   * The most pairs any lead can achieve. If this is already below the
   * correlation threshold, every lead will blank out — and sixteen identical
   * "n/a" marks are a far worse explanation than one sentence saying the
   * threshold is unreachable at this resolution.
   */
  const feasibility = useMemo(() => {
    if (!griddedMean || !grid) return null;
    let best = 0;
    for (let lead = 0; lead <= MAX_LEAD; lead++) {
      const n = countPairs(griddedMean.buckets[lead], griddedMean.obs);
      if (n > best) best = n;
    }
    return { achievable: best, enough: best >= MIN_PAIRS_CORRELATION };
  }, [griddedMean, grid]);

  const canComputeTiming = !!(app.eventData && app.forecasts.size > 0);
  const canComputeCrossing = canComputeTiming && !!(app.obsRp && app.simRp);
  const canComputeAccuracy = !!(app.eventData && app.forecasts.size > 0);
  const canComputeCrps = !!(app.eventData && app.forecasts.size > 0);

  function computeCategoricalMetrics() {
    setError(null);
    if (!app.eventData || !app.obsRp || !app.simRp || !griddedMax) return;
    setComputing(true);
    setTimeout(() => {
      try {
        if (rawBuckets && !app.leadBuckets) app.setLeadBuckets(rawBuckets);
        // Threshold questions use bin maxima: a bin mean can fall below a return
        // period the actual flow crossed, erasing the exceedance.
        const buckets = griddedMax.buckets;
        const eventData = griddedMax.obs;

        const eventRp = determineEventReturnPeriod(eventData, app.obsRp!);
        app.setEventReturnPeriod(eventRp);

        const mccDist: PerLeadDistribution = { leads: [], values: [], pairs: [], skipped: [] };
        const hssDist: PerLeadDistribution = { leads: [], values: [], pairs: [], skipped: [] };

        for (let lead = 0; lead <= MAX_LEAD; lead++) {
          const bucket = buckets[lead];
          mccDist.leads.push(lead);
          hssDist.leads.push(lead);

          const pairs = countPairs(bucket, eventData);
          mccDist.pairs!.push(pairs);
          hssDist.pairs!.push(pairs);

          const mccVals: number[] = [];
          const hssVals: number[] = [];

          // Chance-corrected scores over a handful of timesteps are noise; leave
          // the lead blank and say why rather than plotting a spurious box.
          const tooFew = pairs < MIN_PAIRS_CORRELATION;
          mccDist.skipped!.push(tooFew ? FEW_PAIRS_REASON : null);
          hssDist.skipped!.push(tooFew ? FEW_PAIRS_REASON : null);

          if (!tooFew && bucket && bucket.time.length > 0) {
            for (let m = 0; m < MEMBER_COUNT; m++) {
              const ms = memberSeries(bucket, m);
              const cm = buildContingencyMatrix(
                ms,
                eventData,
                app.obsRp!,
                app.simRp!,
                eventRp,
              );
              if (cm.n > 0) {
                const mcc = computeMcc(cm.matrix);
                if (Number.isFinite(mcc)) mccVals.push(mcc);
                const hss = computeHss(cm.matrix);
                if (Number.isFinite(hss)) hssVals.push(hss);
              }
            }
          }
          mccDist.values.push(mccVals);
          hssDist.values.push(hssVals);
        }

        app.setMccDistribution(mccDist);
        app.setHssDistribution(hssDist);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setComputing(false);
      }
    }, 0);
  }

  function computeTimingMetrics() {
    setTimingError(null);
    if (!app.eventData || !griddedMax) return;
    setComputingTiming(true);
    setTimeout(() => {
      try {
        if (rawBuckets && !app.leadBuckets) app.setLeadBuckets(rawBuckets);
        // Peaks and threshold crossings are both about how high the flow got, so
        // these use bin maxima rather than bin means.
        const buckets = griddedMax.buckets;
        const eventData = griddedMax.obs;

        // Peak timing distribution
        const peakDist: PerLeadDistribution = { leads: [], values: [], pairs: [] };
        for (let lead = 0; lead <= MAX_LEAD; lead++) {
          peakDist.leads.push(lead);
          const vals: number[] = [];
          const bucket = buckets[lead];
          peakDist.pairs!.push(countPairs(bucket, eventData));
          if (bucket && bucket.time.length > 0) {
            for (let m = 0; m < MEMBER_COUNT; m++) {
              const dt = computePeakTimingError(memberSeries(bucket, m), eventData);
              if (dt != null && Number.isFinite(dt)) vals.push(dt);
            }
          }
          peakDist.values.push(vals);
        }
        app.setPeakTimingDistribution(peakDist);

        // Threshold crossing — only if both RP sets are present.
        if (app.obsRp && app.simRp) {
          const crossDists: Record<number, PerLeadDistribution> = {};
          const crossDets: Record<number, CrossingDetection> = {};
          for (const rp of RP_LEVELS) {
            const obsThr = app.obsRp[rp];
            const simThr = app.simRp[rp];
            const dist: PerLeadDistribution = { leads: [], values: [], pairs: [] };
            const det: CrossingDetection = {
              leads: [],
              nCrossed: [],
              nObsOnly: [],
              nNoObs: [],
              nTotal: [],
            };
            for (let lead = 0; lead <= MAX_LEAD; lead++) {
              dist.leads.push(lead);
              det.leads.push(lead);
              const vals: number[] = [];
              let nCrossed = 0;
              let nObsOnly = 0;
              let nNoObs = 0;
              let nTotal = 0;
              const bucket = buckets[lead];
              dist.pairs!.push(countPairs(bucket, eventData));
              if (bucket && bucket.time.length > 0) {
                for (let m = 0; m < MEMBER_COUNT; m++) {
                  nTotal += 1;
                  const r = computeThresholdCrossing(
                    memberSeries(bucket, m),
                    eventData,
                    obsThr,
                    simThr,
                  );
                  if (r.deltaT != null) {
                    vals.push(r.deltaT);
                    nCrossed += 1;
                  } else if (r.crossedObs && !r.crossedFcst) {
                    nObsOnly += 1;
                  } else if (!r.crossedObs) {
                    nNoObs += 1;
                  }
                }
              }
              dist.values.push(vals);
              det.nCrossed.push(nCrossed);
              det.nObsOnly.push(nObsOnly);
              det.nNoObs.push(nNoObs);
              det.nTotal.push(nTotal);
            }
            crossDists[rp] = dist;
            crossDets[rp] = det;
          }
          app.setCrossingDistributions(crossDists);
          app.setCrossingDetections(crossDets);
        } else {
          app.setCrossingDistributions(null);
          app.setCrossingDetections(null);
        }
      } catch (e) {
        setTimingError(e instanceof Error ? e.message : String(e));
      } finally {
        setComputingTiming(false);
      }
    }, 0);
  }

  function computeAccuracyMetrics() {
    setAccuracyError(null);
    if (!app.eventData || !griddedMean) return;
    setComputingAccuracy(true);
    setTimeout(() => {
      try {
        if (rawBuckets && !app.leadBuckets) app.setLeadBuckets(rawBuckets);
        // Bin means: KGE and its components are about volume and shape, so a
        // within-bin average is the right summary.
        const buckets = griddedMean.buckets;
        const eventData = griddedMean.obs;

        const dists = accuracyDistributions(buckets, eventData);
        const { kge: kgeDist, r: rDist, beta: betaDist, gamma: gammaDist } = dists;
        setCorrectedAccuracy(
          griddedCorrected ? accuracyDistributions(griddedCorrected.buckets, griddedCorrected.obs) : null,
        );

        app.setKgeDistribution(kgeDist);
        app.setRDistribution(rDist);
        app.setBetaDistribution(betaDist);
        app.setGammaDistribution(gammaDist);
      } catch (e) {
        setAccuracyError(e instanceof Error ? e.message : String(e));
      } finally {
        setComputingAccuracy(false);
      }
    }, 0);
  }

  function computeCrpsMetrics() {
    setCrpsError(null);
    if (!app.eventData || !griddedMean) return;
    setComputingCrps(true);
    setTimeout(() => {
      try {
        if (rawBuckets && !app.leadBuckets) app.setLeadBuckets(rawBuckets);
        // Bin means: CRPS is an error magnitude, so volume is what matters.
        const buckets = griddedMean.buckets;
        const eventData = griddedMean.obs;

        // CRPSS climatology: ALWAYS the observed record, and required.
        //
        // The reference is scored against observations, so a baseline built from
        // model output is biased wherever the model is — which makes it
        // artificially easy to beat. Using one shared reference for both variants
        // is also the only way CRPSS_corrected - CRPSS_raw reflects a change in
        // the forecast rather than a change in the denominator.
        //
        // Without a historical upload there is no honest reference, so CRPSS is
        // omitted entirely. CRPS itself needs no climatology and still renders.
        const clim = app.historicalData
          ? buildClimatology(
              aggregateSeries(app.historicalData, Math.max(grid!.stepMs, DAY_MS), 'mean'),
              eventData,
              CLIMATOLOGY_WINDOW_DAYS,
            )
          : null;
        app.setCrpsResults(computeCrpsByLead(buckets, eventData, MAX_LEAD, clim));
        setCorrectedCrps(
          griddedCorrected
            ? computeCrpsByLead(
                griddedCorrected.buckets,
                griddedCorrected.obs,
                MAX_LEAD,
                clim,
              )
            : null,
        );
      } catch (e) {
        setCrpsError(e instanceof Error ? e.message : String(e));
      } finally {
        setComputingCrps(false);
      }
    }, 0);
  }

  // Skill summary bars. Cheap enough to derive on render — one KGE per member
  // per row — so no button or stored state.
  const skillLead = useMemo(
    () =>
      griddedMean
        ? skillByLead(griddedMean.buckets, griddedMean.obs, {
            minPairs: MIN_PAIRS_CORRELATION,
            maxLead: MAX_LEAD,
          })
        : null,
    [griddedMean],
  );

  const skillRun = useMemo(() => {
    if (!app.eventData || app.forecasts.size === 0 || !grid) return null;
    // Per-run scoring needs the runs themselves, aggregated onto the same grid
    // as everything else so the numbers are comparable with the per-lead bars.
    const gridded = new Map<string, { time: Date[]; discharge: number[][] }>();
    for (const [date, run] of app.forecasts) {
      const perMember = run.discharge.map((series) =>
        aggregateSeries({ time: run.time, values: series }, grid.stepMs, 'mean'),
      );
      if (perMember.length === 0) continue;
      gridded.set(date, {
        time: perMember[0].time,
        discharge: perMember.map((s) => s.values),
      });
    }
    const obs = aggregateSeries(app.eventData, grid.stepMs, 'mean');
    return skillByRun(gridded, obs, { minPairs: MIN_PAIRS_CORRELATION });
  }, [app.forecasts, app.eventData, grid]);

  /** Which accuracy distributions the plots should render. */
  const accuracyDisplay = useMemo(() => {
    if (accuracyVariant === 'corrected' && correctedAccuracy) {
      return correctedAccuracy;
    }
    return {
      kge: app.kgeDistribution,
      r: app.rDistribution,
      beta: app.betaDistribution,
      gamma: app.gammaDistribution,
    };
  }, [
    accuracyVariant,
    correctedAccuracy,
    app.kgeDistribution,
    app.rDistribution,
    app.betaDistribution,
    app.gammaDistribution,
  ]);

  /** Appended to plot titles so a screenshot always says which variant it is. */
  const variantSuffix = (v: MetricVariant) => (v === 'corrected' ? ' (bias-corrected)' : '');

  const skillLeadCorrected = useMemo(
    () =>
      griddedCorrected
        ? skillByLead(griddedCorrected.buckets, griddedCorrected.obs, {
            minPairs: MIN_PAIRS_CORRELATION,
            maxLead: MAX_LEAD,
          })
        : null,
    [griddedCorrected],
  );

  const skillRunCorrected = useMemo(() => {
    if (!app.eventData || !correction || correction.forecasts.size === 0 || !grid) return null;
    const griddedRuns = new Map<string, { time: Date[]; discharge: number[][] }>();
    for (const [date, run] of correction.forecasts) {
      const perMember = run.discharge.map((series) =>
        aggregateSeries({ time: run.time, values: series }, grid.stepMs, 'mean'),
      );
      if (perMember.length === 0) continue;
      griddedRuns.set(date, {
        time: perMember[0].time,
        discharge: perMember.map((x) => x.values),
      });
    }
    const obs = aggregateSeries(app.eventData, grid.stepMs, 'mean');
    const rows = skillByRun(griddedRuns, obs, { minPairs: MIN_PAIRS_CORRELATION });
    // Excluded runs appear as labelled n/a bars, so a run vanishing from the
    // corrected view is visible rather than silent.
    for (const ex of correction.excluded) {
      const label = /^\d{8}$/.test(ex.date)
        ? `${ex.date.slice(0, 4)}-${ex.date.slice(4, 6)}-${ex.date.slice(6, 8)}`
        : ex.date;
      rows.push({ label, nse: NaN, kge: NaN, pairs: 0, members: 0, skipped: ex.reason });
    }
    rows.sort((a, b) => a.label.localeCompare(b.label));
    return rows;
  }, [app.eventData, correction, grid]);

  const skillDisplay = useMemo(
    () =>
      skillVariant === 'corrected' && skillLeadCorrected
        ? { lead: skillLeadCorrected, run: skillRunCorrected }
        : { lead: skillLead, run: skillRun },
    [skillVariant, skillLeadCorrected, skillRunCorrected, skillLead, skillRun],
  );

  const crpsDisplay =
    crpsVariant === 'corrected' && correctedCrps ? correctedCrps : app.crpsResults;

  // --- Bias-correction diagnostics ------------------------------------------
  const biasMonths = useMemo(
    () => (correction ? [...correction.mappings.keys()].sort((a, b) => a - b) : []),
    [correction],
  );
  const activeBiasMonth =
    biasMonth != null && biasMonths.includes(biasMonth) ? biasMonth : (biasMonths[0] ?? null);
  const activeMapping =
    correction && activeBiasMonth != null ? (correction.mappings.get(activeBiasMonth) ?? null) : null;

  /** Raw forecast values in the selected month, for the transfer-curve rug. */
  const biasRugValues = useMemo(() => {
    if (activeBiasMonth == null || app.forecasts.size === 0) return [];
    const out: number[] = [];
    for (const run of app.forecasts.values()) {
      if (run.time.length === 0) continue;
      if (run.time[0].getUTCMonth() + 1 !== activeBiasMonth) continue;
      for (const series of run.discharge) {
        for (const v of series) if (Number.isFinite(v)) out.push(v);
      }
    }
    return out;
  }, [activeBiasMonth, app.forecasts]);

  const correctionEffect = useMemo(
    () =>
      rawBuckets && correctedBuckets
        ? correctionEffectByLead(rawBuckets, correctedBuckets, MAX_LEAD)
        : null,
    [rawBuckets, correctedBuckets],
  );

  /** Runs available to compare raw against corrected. */
  const biasRunDates = useMemo(
    () => (correction ? [...correction.forecasts.keys()].sort() : []),
    [correction],
  );
  const activeBiasRun =
    biasRunDate && biasRunDates.includes(biasRunDate) ? biasRunDate : (biasRunDates[0] ?? null);

  // Peak timing grouped by how far ahead of the observed peak each run was
  // issued. Works straight off the raw forecasts — no lead buckets needed, so
  // it costs one argmax per member per run.
  const peakByRun = useMemo(() => {
    if (!app.eventData || app.forecasts.size === 0) return null;
    return computePeakTimingByRun(app.forecasts, app.eventData);
  }, [app.forecasts, app.eventData]);

  // Recompute the contingency matrix on lead/series selection change.
  const contingency = useMemo<ContingencyResult | null>(() => {
    if (!griddedMax || !app.obsRp || !app.simRp || app.eventReturnPeriod == null) {
      return null;
    }
    // Same gridded, max-aggregated inputs the MCC/HSS distributions use, so the
    // table, the graph beside it and the box plots can never disagree.
    const bucket = griddedMax.buckets[matrixLead];
    if (!bucket) return null;
    const series = resolveSeries(bucket, matrixSeriesKey);
    if (!series) return null;
    return buildContingencyMatrix(
      series,
      griddedMax.obs,
      app.obsRp,
      app.simRp,
      app.eventReturnPeriod,
    );
  }, [
    griddedMax,
    app.obsRp,
    app.simRp,
    app.eventReturnPeriod,
    matrixLead,
    matrixSeriesKey,
  ]);

  const eventRpLabel =
    app.eventReturnPeriod == null
      ? '—'
      : app.eventReturnPeriod === 0
        ? 'Did not exceed 2-year threshold'
        : `${app.eventReturnPeriod}-year`;

  const riverIdSuffix = app.reach?.riverId ? ` — River ${app.reach.riverId}` : '';
  const hasResults = app.mccDistribution || app.hssDistribution || contingency;

  return (
    <div>
      {feasibility && !feasibility.enough && grid && (
        <p style={feasibilityBanner}>
          <strong>This event cannot support the correlation-based scores.</strong> At{' '}
          {grid.label} resolution the longest lead day reaches only{' '}
          <strong>{feasibility.achievable}</strong> forecast/observation pair
          {feasibility.achievable === 1 ? '' : 's'}, and r, γ, KGE′, NSE, MCC and HSS need at
          least {MIN_PAIRS_CORRELATION} to mean anything — so they are reported as
          <em> n/a</em> throughout rather than as confident-looking noise.
          <br />
          The limit is arithmetic, not data quality: pairs per lead are capped by the number of{' '}
          {grid.label === 'daily' ? 'days' : 'grid intervals'} your event spans, because the
          coarser series sets the comparison resolution. To get these metrics you need either a
          longer event window or observations at a finer cadence. β and the CRPS family survive
          small samples and are still reported.
        </p>
      )}

      {grid && (
        <p style={gridBanner}>
          Metrics computed at <strong>{grid.label}</strong> resolution
          {grid.limitedBy !== 'equal' && `, limited by the ${grid.limitedBy}`}
          {pairsPerLead != null && ` — ${pairsPerLead} pairs per lead day`}. See{' '}
          <em>Temporal resolution</em> on the Overview tab.
        </p>
      )}

      <CollapsibleBlock
        title="Categorical metrics"
        description="Contingency matrix, MCC, and HSS — dual-threshold classification of forecast vs. observed return-period categories."
      >
        {!canCompute && (
          <p style={{ color: '#555' }}>
            Need observed event data, historical observations (for observed return periods), and
            downloaded forecasts before computing metrics.
          </p>
        )}
        {canCompute && (
          <button onClick={computeCategoricalMetrics} disabled={computing} style={btn}>
            {computing
              ? 'Computing…'
              : hasResults
                ? 'Re-compute categorical metrics'
                : 'Compute categorical metrics'}
          </button>
        )}
        {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
        {app.eventReturnPeriod != null && (
          <p style={{ color: '#444', marginTop: '0.6rem' }}>
            Observed event return period: <strong>{eventRpLabel}</strong>
            {app.eventReturnPeriod === 0 && (
              <> — categorical metrics will be degenerate (single category).</>
            )}
          </p>
        )}

        {app.leadBuckets && app.eventReturnPeriod != null && (
          <div style={subBlock}>
            <h3 style={h3}>Contingency matrix</h3>
            <div
              style={{
                display: 'flex',
                gap: '0.75rem',
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              <label style={lbl}>
                Lead day:&nbsp;
                <select
                  value={matrixLead}
                  onChange={(e) => setMatrixLead(Number(e.target.value))}
                  style={sel}
                >
                  {leadOptions().map((l) => (
                    <option key={l} value={l}>
                      {l === 0 ? 'Lead 0 (initialization)' : `Lead ${l}`}
                    </option>
                  ))}
                </select>
              </label>
              <label style={lbl}>
                Forecast series:&nbsp;
                <select
                  value={matrixSeriesKey}
                  onChange={(e) => setMatrixSeriesKey(e.target.value)}
                  style={sel}
                >
                  {STAT_OPTIONS.map((s) => (
                    <option key={s.key} value={`stat:${s.key}`}>
                      {s.label}
                    </option>
                  ))}
                  <option disabled>──────────</option>
                  {Array.from({ length: MEMBER_COUNT }, (_, i) => i).map((i) => (
                    <option key={i} value={`ensemble:${i}`}>
                      {`Ensemble ${String(i + 1).padStart(2, '0')}`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {contingency && contingency.n === 0 && (
              <p style={{ color: '#b91c1c', marginTop: '0.6rem' }}>
                No overlap between the selected forecast series and the event data.
              </p>
            )}
            {contingency && contingency.n > 0 && (
              <>
                <div
                  style={{
                    display: 'flex',
                    gap: '1.5rem',
                    flexWrap: 'wrap',
                    alignItems: 'flex-start',
                  }}
                >
                  <ContingencyMatrixTable result={contingency} />
                  <div style={{ flex: '1 1 520px', minWidth: 360 }}>
                    {app.obsRp && app.simRp && app.eventReturnPeriod != null && (
                      <Plot
                        {...contingencySeriesFigure(contingency, {
                          obsRp: app.obsRp,
                          simRp: app.simRp,
                          eventRp: app.eventReturnPeriod,
                          leadLabel: `lead ${matrixLead}`,
                        })}
                        style={{ height: 420 }}
                      />
                    )}
                  </div>
                </div>
                <PlotNote>
                  these are the two series the table was built from, so every count above
                  corresponds to points here. Black is observed, blue is the selected forecast
                  series, and each marker flags a timestep that landed in the wrong return-period
                  category — orange triangles up for over-forecasting, red triangles down for
                  under-forecasting. Hover one to see which categories it confused.
                  <br />
                  <br />
                  The coloured bands are the return-period zones a value gets sorted into — yellow
                  for 2-year through purple for the rarest category in play. Classification is
                  dual-threshold, so there are two sets: <strong>observed</strong> zones are shown
                  by default because they classify the black line, and{' '}
                  <strong>simulated</strong> zones start hidden — click that legend entry to swap
                  to the cut points the blue forecast line is judged against. Showing both at once
                  is unreadable, so compare them by toggling.
                  <br />
                  <br />
                  That toggle is the explanation for most surprises here. A timestep can count as
                  a miss even where the two lines nearly touch, if each sits in a different zone
                  under its own thresholds. And if the two zone sets are far apart when you flip
                  between them, the model has a magnitude bias at this reach — meaning the
                  categorical scores are partly measuring that bias rather than forecast skill.
                  Only zones at or below the event's own return period are drawn, since
                  classification is capped there.
                </PlotNote>
              </>
            )}
          </div>
        )}

        {app.mccDistribution && (
          <div style={subBlock}>
            <h3 style={h3}>MCC distribution by lead day</h3>
            <Plot
              {...distributionVsLeadFigure(app.mccDistribution, {
                metricLabel: 'MCC',
                title: `MCC Distribution per Lead Day${riverIdSuffix}`,
                subtitle: 'Gorodkin (2004) / Jurman et al. (2012)  |  51 members (leads 0–15)',
                yAxisLabel: 'MCC (multi-category)',
                zeroLine: true,
              })}
            />
            <PlotNote>
              each box is the spread of MCC across the 51 ensemble members at that lead day, so
              box height is member disagreement and the black line is the typical member. MCC
              near 1 means the member put nearly every timestep in the right return-period
              category; 0 means no better than chance; below 0 is worse than chance. The lead day
              where the median line falls to 0 is where categorical skill runs out. MCC stays
              honest on rare categories, which is why it is preferred here over plain accuracy.
            </PlotNote>
          </div>
        )}

        {app.hssDistribution && (
          <div style={subBlock}>
            <h3 style={h3}>HSS distribution by lead day</h3>
            <Plot
              {...distributionVsLeadFigure(app.hssDistribution, {
                metricLabel: 'HSS',
                title: `HSS Distribution per Lead Day${riverIdSuffix}`,
                subtitle:
                  'Multi-category Heidke Skill Score  |  51 members (leads 0–15)',
                yAxisLabel: 'HSS (multi-category)',
                zeroLine: true,
              })}
            />
            <PlotNote>
              the same per-member spread, but scored against random chance instead of
              correlation. HSS = 1 is perfect, 0 means the member did no better than a random
              forecast with the same category frequencies, and negative means it did worse. Read
              it alongside MCC: agreement between the two is a sign the categorical result is
              robust, while HSS looking much healthier than MCC usually means one common category
              is carrying the score.
            </PlotNote>
          </div>
        )}
      </CollapsibleBlock>

      <CollapsibleBlock
        title="Timing metrics"
        description="Peak timing error (Δt_peak) and first-ascending threshold crossing error (Δt_RP), per ensemble member, by lead day."
      >
        {!canComputeTiming && (
          <p style={{ color: '#555' }}>
            Need observed event data and downloaded forecasts before computing timing metrics.
          </p>
        )}
        {canComputeTiming && (
          <button onClick={computeTimingMetrics} disabled={computingTiming} style={btn}>
            {computingTiming
              ? 'Computing…'
              : app.peakTimingDistribution
                ? 'Re-compute timing metrics'
                : 'Compute timing metrics'}
          </button>
        )}
        {!canComputeCrossing && canComputeTiming && (
          <p style={{ color: '#666', marginTop: '0.6rem', fontSize: '0.9rem' }}>
            Threshold crossing requires both observed and simulated return periods — upload
            historical observations on the Setup tab to enable it.
          </p>
        )}
        {timingError && <p style={{ color: '#b91c1c' }}>{timingError}</p>}

        {app.peakTimingDistribution && (
          <div style={subBlock}>
            <h3 style={h3}>Peak timing error (Δt_peak) by lead day</h3>
            <Plot
              {...distributionVsLeadFigure(app.peakTimingDistribution, {
                metricLabel: 'Δt_peak',
                title: `Peak Timing Error per Lead Day${riverIdSuffix}`,
                subtitle:
                  't_peak,forecast − t_peak,observed (hours)  |  51 members (leads 0–15)  |  negative = early',
                yAxisLabel: 'Δt_peak (hours)',
                valueFormat: '+.1f',
                zeroLine: true,
              })}
            />
            <PlotNote>
              hours between the forecast peak and the observed peak, per member. A box centred on
              the dashed zero line means the members timed the peak correctly; below zero they
              peaked early, above zero late. Box height is disagreement between members, and it
              normally widens with lead time — a narrow box far from zero is worse news than a
              wide box centred on it, because it means the members agree on the wrong answer.
            </PlotNote>
          </div>
        )}

        {peakByRun && peakByRun.daysBefore.length > 0 && (
          <div style={subBlock}>
            <h3 style={h3}>Peak timing error by forecast age (per run)</h3>
            <Plot
              {...distributionVsLeadFigure(
                {
                  // Index positions keep the runs evenly spaced and in date
                  // order; the dates themselves become the tick labels.
                  leads: peakByRun.initDates.map((_, i) => i),
                  values: peakByRun.values,
                },
                {
                  metricLabel: 'Δt_peak',
                  xTickText: peakByRun.initDates.map(
                    (d, i) => `${d}\n(${peakByRun.daysBefore[i]}d before)`,
                  ),
                  title: `Peak Timing Error by Forecast Initialization${riverIdSuffix}`,
                  subtitle:
                    `Observed peak ${peakByRun.obsPeak?.toISOString().slice(0, 16).replace('T', ' ')} UTC` +
                    `  |  peak sought within ±${peakByRun.searchWindowHours} h of it  |  negative = early` +
                    (peakByRun.noPeakMembers > 0
                      ? `  |  ${peakByRun.noPeakMembers} member forecasts had no peak to time`
                      : '') +
                    (peakByRun.censoredMembers > 0
                      ? `  |  ${peakByRun.censoredMembers} censored at the window edge`
                      : '') +
                    (peakByRun.emptyRuns > 0
                      ? `  |  ${peakByRun.emptyRuns} run${peakByRun.emptyRuns === 1 ? '' : 's'} predicted no peak at all`
                      : ''),
                  xAxisLabel: 'Forecast initialization date (UTC)',
                  yAxisLabel: 'Δt_peak (hours)',
                  valueFormat: '+.1f',
                  zeroLine: true,
                  membersLabel: '51 members of one run',
                },
              )}
            />
            <PlotNote>
              this asks your question directly: if you had looked at the forecast{' '}
              <em>n</em> days before the peak actually arrived, when would it have told you the
              peak was coming? Each box is one forecast run, labelled by the date it was
              initialized with its age relative to the peak underneath — so read left to right to
              replay the event as it approached. Zero means that run timed the peak exactly; below
              zero it predicted the peak too early, above zero too late.
              <br />
              <br />
              Box height here <em>is</em> genuine ensemble spread, unlike the per-lead plot above:
              every value in a box comes from the same model run, where the 51 members really are
              one ensemble. Member identity does not carry across runs, so the plot above mixes
              unrelated members together and its box heights should not be read as uncertainty.
              This one can be.
              <br />
              <br />
              <strong>Where the boxes start is itself the answer.</strong> A member only counts if
              it actually forecast a peak — a rise of at least 10% within ±
              {peakByRun.searchWindowHours} h of the observed peak. A run whose hydrograph is flat
              never predicted the event, so there is no timing to score and it is dropped rather
              than assigned a meaningless error. The leftmost box is therefore the earliest
              forecast that saw this peak coming; the subtitle counts what was dropped.
              Searching further afield would only manufacture large errors out of flat forecasts,
              which is why Δt cannot exceed ±{peakByRun.searchWindowHours} h here.
            </PlotNote>
          </div>
        )}

        {app.crossingDistributions && app.crossingDetections && (
          <div style={subBlock}>
            <h3 style={h3}>Threshold crossing timing error (Δt_RP)</h3>
            <label style={lbl}>
              Return period:&nbsp;
              <select
                value={crossingRp}
                onChange={(e) => setCrossingRp(Number(e.target.value))}
                style={sel}
              >
                {RP_LEVELS.map((rp) => (
                  <option key={rp} value={rp}>
                    {rp}-year
                  </option>
                ))}
              </select>
            </label>
            <div style={{ marginTop: '0.75rem' }}>
              <Plot
                {...distributionVsLeadFigure(app.crossingDistributions[crossingRp], {
                  metricLabel: 'Δt_RP',
                  title: `Threshold Crossing Timing Error (${crossingRp}-yr RP)${riverIdSuffix}`,
                  subtitle:
                    'First ascending crossing  |  Only members that crossed both obs and forecast threshold  |  negative = early',
                  yAxisLabel: 'Δt_RP (hours)',
                  valueFormat: '+.1f',
                  zeroLine: true,
                })}
              />
            </div>
            <PlotNote>
              hours between the forecast first crossing the selected threshold on the way up and
              the observation doing the same — the warning-time error. Below zero the forecast
              warned early, above zero late. Only members that crossed the threshold in{' '}
              <em>both</em> forecast and observation can contribute, so check the detection table
              below before trusting a box: a tight box built from three members is a small
              sample, not skill, and members counted as "obs only" are missed warnings that this
              plot cannot show.
            </PlotNote>
            <DetectionTable detection={app.crossingDetections[crossingRp]} />
          </div>
        )}
      </CollapsibleBlock>

      <CollapsibleBlock
        title="Accuracy metrics"
        description="Kling-Gupta efficiency (KGE') and its decomposition: Pearson correlation r, bias ratio β = μ_f/μ_o, variability ratio γ = CV_f/CV_o (Kling et al., 2012). These compare raw discharge, so a bias-corrected variant is available once historical observations are uploaded."
      >
        {!canComputeAccuracy && (
          <p style={{ color: '#555' }}>
            Need observed event data and downloaded forecasts before computing accuracy metrics.
          </p>
        )}
        {canComputeAccuracy && (
          <button onClick={computeAccuracyMetrics} disabled={computingAccuracy} style={btn}>
            {computingAccuracy
              ? 'Computing…'
              : app.kgeDistribution
                ? 'Re-compute accuracy metrics'
                : 'Compute accuracy metrics'}
          </button>
        )}
        {accuracyError && <p style={{ color: '#b91c1c' }}>{accuracyError}</p>}

        {app.kgeDistribution && (
          <div style={{ marginTop: '0.75rem' }}>
            <VariantSelect
              value={accuracyVariant}
              onChange={setAccuracyVariant}
              disabledReason={correctedAccuracy ? null : correctedUnavailableReason}
            />
            {accuracyVariant === 'corrected' && correction && <CorrectionBanner c={correction} />}
          </div>
        )}

        {accuracyDisplay.kge && (
          <div style={subBlock}>
            <h3 style={h3}>KGE' distribution by lead day</h3>
            <Plot
              {...distributionVsLeadFigure(accuracyDisplay.kge!, {
                metricLabel: "KGE'",
                title: `KGE' Distribution per Lead Day${riverIdSuffix}`,
                subtitle:
                  "1 − √((r−1)² + (β−1)² + (γ−1)²)  |  Kling et al. (2012)  |  51 members (leads 0–15)",
                yAxisLabel: "KGE'",
                referenceLines: [
                  { y: 1, label: "KGE' = 1 (perfect)", color: 'green' },
                  { y: -0.41, label: "KGE' = -0.41 (mean-flow benchmark)", color: 'red', dash: 'dot' },
                ],
                zeroLine: true,
              })}
            />
            <PlotNote>
              a single score combining correlation, bias and variability, per member. The green
              line at 1 is perfect. The red line at −0.41 is the benchmark you get by predicting
              the observed mean flow at every timestep — a box below it means the forecast was
              worse than a flat average, which is the threshold that matters most here. Because
              KGE' collapses three error types into one number, use the r, β and γ plots below to
              see which of them caused a drop.
            </PlotNote>
          </div>
        )}

        {accuracyDisplay.r && (
          <div style={subBlock}>
            <h3 style={h3}>Pearson correlation (r) by lead day</h3>
            <Plot
              {...distributionVsLeadFigure(accuracyDisplay.r!, {
                metricLabel: 'r',
                title: `Pearson Correlation per Lead Day${riverIdSuffix}`,
                subtitle: 'KGE component  |  51 members (leads 0–15)',
                yAxisLabel: 'r',
                referenceLines: [{ y: 1, label: 'r = 1 (perfect)', color: 'green' }],
                zeroLine: true,
              })}
            />
            <PlotNote>
              the shape-and-timing component of KGE': how well the rise and fall of the forecast
              lines up with the observation, ignoring magnitude entirely. A member can score near
              1 here while being badly wrong in absolute terms — that combination points to a
              scaling problem, which β and γ below will show. Low r instead means the hydrograph
              shape or timing itself was wrong, and no bias correction would fix it.
            </PlotNote>
          </div>
        )}

        {accuracyDisplay.beta && (
          <div style={subBlock}>
            <h3 style={h3}>Bias ratio (β) by lead day</h3>
            <Plot
              {...distributionVsLeadFigure(accuracyDisplay.beta!, {
                metricLabel: 'β',
                title: `Bias Ratio per Lead Day${riverIdSuffix}`,
                subtitle:
                  'β = μ_forecast / μ_observed  |  β < 1 underestimate, β > 1 overestimate  |  51 members',
                yAxisLabel: 'β',
                referenceLines: [{ y: 1, label: 'β = 1 (no bias)', color: 'green' }],
              })}
            />
            <PlotNote>
              the ratio of mean forecast flow to mean observed flow, so 1 is unbiased, 0.5 means
              the member forecast half the water that arrived and 2 means twice. Read it as a
              multiplier, not a difference. A box sitting off 1 by the same factor at every lead
              day is a systematic bias in the model at this reach rather than a forecast failure
              — the kind of thing the event-vs-retrospective plot on the Setup tab shows directly.
            </PlotNote>
          </div>
        )}

        {accuracyDisplay.gamma && (
          <div style={subBlock}>
            <h3 style={h3}>Variability ratio (γ) by lead day</h3>
            <Plot
              {...distributionVsLeadFigure(accuracyDisplay.gamma!, {
                metricLabel: 'γ',
                title: `Variability Ratio per Lead Day${riverIdSuffix}`,
                subtitle:
                  'γ = CV_forecast / CV_observed (Kling et al., 2012)  |  γ < 1 under-varies, γ > 1 over-varies  |  51 members',
                yAxisLabel: 'γ',
                referenceLines: [{ y: 1, label: 'γ = 1 (perfect)', color: 'green' }],
              })}
            />
            <PlotNote>
              whether the forecast varies as much as the observation does, after removing the
              bias that β already measures. Below 1 the member's hydrograph is too flat —
              damped peaks and shallow recessions, the usual signature of a smoothed forecast.
              Above 1 it swings harder than reality. Together with β this separates "right shape,
              wrong size" from "wrong shape".
            </PlotNote>
          </div>
        )}
      </CollapsibleBlock>

      <CollapsibleBlock
        title="Bias correction"
        description="What the correction actually does to your forecasts: the transfer curve it applies, the two monthly distributions it matches, how much it shifts each lead day, and one run before and after. Diagnostics only — no metric here."
      >
        {!correction && (
          <p style={{ color: '#555' }}>
            {correctedUnavailableReason ?? 'Bias correction is not available yet.'}
          </p>
        )}

        {correction && <CorrectionBanner c={correction} />}

        {activeMapping && (
          <>
            {biasMonths.length > 1 && (
              <label style={lbl}>
                Month:&nbsp;
                <select
                  value={activeBiasMonth ?? ''}
                  onChange={(e) => setBiasMonth(Number(e.target.value))}
                  style={sel}
                >
                  {biasMonths.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div style={subBlock}>
              <h3 style={h3}>Transfer curve</h3>
              <Plot
                {...biasTransferFigure(activeMapping, {
                  forecastValues: biasRugValues,
                  riverId: app.reach?.riverId ?? undefined,
                })}
              />
              <PlotNote>
                read a simulated flow off the bottom axis and the corrected value off the side.
                Distance from the grey 1:1 line is the size of the correction; where the blue
                "Applied" line <em>sits on</em> 1:1, the correction is doing nothing there.
                <br />
                <br />
                The red dotted line is the raw quantile map, and its gaps are the whole story
                behind the caveats. Below the simulated monthly minimum and above its maximum the
                observed CDF is flat, so the inverse is undefined — at the low end the reference
                keeps the raw value (hence Applied returning to 1:1), and at the high end it
                returns infinity and the run is excluded. The black tick marks along the bottom
                are your actual forecast values, so you can see which part of this curve your
                event really uses.
              </PlotNote>
            </div>

            <div style={subBlock}>
              <h3 style={h3}>The two distributions being matched</h3>
              <Plot
                {...biasCdfsFigure(activeMapping, { riverId: app.reach?.riverId ?? undefined })}
              />
              <PlotNote>
                the correction reads a probability off the blue simulated curve and the flow at
                that same probability off the black observed one. Horizontal distance between the
                curves at a given height is the bias being removed. Drawn as steps because they
                are histogram CDFs, and the flat treads are exactly where the inverse mapping
                fails — a tall flat segment on the black curve is a wide band of probabilities
                with no distinct observed flow to map back to.
              </PlotNote>
            </div>
          </>
        )}

        {correctionEffect && (
          <div style={subBlock}>
            <h3 style={h3}>How much it shifts each lead day</h3>
            <Plot
              {...distributionVsLeadFigure(correctionEffect, {
                metricLabel: 'Δ',
                title: `Correction Shift per Lead Day${riverIdSuffix}`,
                subtitle: 'corrected − raw, m³/s, across ensemble members  |  above zero = inflated',
                yAxisLabel: 'corrected − raw (m³/s)',
                valueFormat: '+.2f',
                zeroLine: true,
                membersLabel: 'members',
              })}
            />
            <PlotNote>
              how far the correction moves the forecast at each lead day. Above the dashed zero
              line it inflated the values, below it deflated them, and a box sitting on zero means
              the mapping was a no-op for that lead.
              <br />
              <br />
              One caution about reading a trend here: the transfer curve is the{' '}
              <strong>same at every lead</strong>, because the simulated distribution comes from
              the retrospective, which has no lead dimension. So any lead-dependence you see is
              not the correction treating long leads differently — it is those leads occupying a
              different part of one fixed curve. That is also the method's main structural limit:
              forecast error grows with lead, but the correction cannot know that.
            </PlotNote>
          </div>
        )}

        {activeBiasRun && app.eventData && correction && (
          <div style={subBlock}>
            <h3 style={h3}>One run, before and after</h3>
            <label style={lbl}>
              Run:&nbsp;
              <select
                value={activeBiasRun}
                onChange={(e) => setBiasRunDate(e.target.value)}
                style={sel}
              >
                {biasRunDates.map((d) => (
                  <option key={d} value={d}>
                    {`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`}
                  </option>
                ))}
              </select>
            </label>
            {app.forecasts.get(activeBiasRun) && (
              <Plot
                {...biasHydrographFigure(
                  app.forecasts.get(activeBiasRun)!,
                  correction.forecasts.get(activeBiasRun)!,
                  app.eventData,
                  {
                    label: `${activeBiasRun.slice(0, 4)}-${activeBiasRun.slice(4, 6)}-${activeBiasRun.slice(6, 8)}`,
                    riverId: app.reach?.riverId ?? undefined,
                  },
                )}
              />
            )}
            <PlotNote>
              the plainest test of whether the correction helped: if the blue corrected line moves
              toward the black observations relative to the grey raw line, it did. If it overshoots
              past them, the mapping is over-inflating — which happens when the observed record's
              upper tail is heavier than the simulated one. Where grey and blue coincide the mapping
              was undefined and the raw value was kept; the subtitle counts those timesteps.
              <br />
              <br />
              Only runs that survived correction appear in this list, so a date missing here was
              excluded — the banner above says why.
            </PlotNote>
          </div>
        )}
      </CollapsibleBlock>

      <CollapsibleBlock
        title="Skill summary"
        description="NSE and KGE' side by side, coloured by performance band — a single glance at where the forecast is usable. One view by lead day, one by forecast initialization. Both compare raw discharge, so a bias-corrected variant is available."
      >
        {!skillLead && !skillRun && (
          <p style={{ color: '#555' }}>
            Need observed event data and downloaded forecasts before summarising skill.
          </p>
        )}

        {(skillLead || skillLeadCorrected) && (
          <div style={{ marginTop: '0.75rem' }}>
            <VariantSelect
              value={skillVariant}
              onChange={setSkillVariant}
              disabledReason={skillLeadCorrected ? null : correctedUnavailableReason}
            />
            {skillVariant === 'corrected' && correction && <CorrectionBanner c={correction} />}
          </div>
        )}

        {skillDisplay.lead && (
          <div style={subBlock}>
            <h3 style={h3}>By lead day</h3>
            <Plot
              {...skillBarsFigure(skillDisplay.lead!, {
                categoryLabel: 'Lead day',
                title: `Skill by Lead Day${riverIdSuffix}${variantSuffix(skillVariant)}`,
                subtitle:
                  'Median across the 51 ensemble members  |  bars coloured by band  |' +
                  ` dotted = do-nothing benchmark (NSE 0, KGE' ${'−'}0.41), dashed = 0.5`,
              })}
            />
            <PlotNote>
              each row is one lead day scored two ways. <strong>NSE</strong> is the
              mean-squared-error skill score against the observed average, so the dotted line at 0
              is the do-nothing benchmark — a bar left of it means the forecast was worse than
              simply predicting average flow. <strong>KGE'</strong> combines correlation, bias and
              variability; its equivalent benchmark is −0.41, also dotted. The dashed line at 0.5
              is the green threshold in both panels.
              <br />
              <br />
              Read a row straight across: strong on KGE' but weak on NSE usually means the shape
              was right and the magnitude was not, because NSE punishes squared error on the peak
              while KGE' spreads the penalty across three components. Bars are the median across
              members, matching the black median line on the box plots above, and hover gives the
              pair count behind each row.
            </PlotNote>
          </div>
        )}

        {skillDisplay.run && skillDisplay.run.length > 0 && (
          <div style={subBlock}>
            <h3 style={h3}>By forecast initialization</h3>
            <Plot
              {...skillBarsFigure(skillDisplay.run!, {
                categoryLabel: 'Initialized (UTC)',
                title: `Skill by Forecast Run${riverIdSuffix}${variantSuffix(skillVariant)}`,
                subtitle:
                  "Each run scored over its own horizon against the observed event  |  median of 51 members",
              })}
            />
            <PlotNote>
              the same two scores, but one row per forecast run rather than per lead day — so
              nothing is stitched together, and each row is a real model run judged against the
              observations it overlaps. Read top to bottom to replay the event: rows should
              improve as initialization approaches the event, and the row where colour first turns
              green is the run that first got the event right.
              <br />
              <br />
              Runs initialized well before the event overlap it only briefly, so they are scored on
              few pairs and are marked <em>n/a</em> rather than given a misleading number. Because
              each run covers a different slice of the event, rows here are not strictly comparable
              with one another the way the lead-day rows are — use this to find when the forecast
              locked on, and the lead-day view to quantify how skill decays.
            </PlotNote>
          </div>
        )}
      </CollapsibleBlock>

      <CollapsibleBlock
        title="Probabilistic metrics"
        description="Continuous Ranked Probability Score (CRPS) via the energy-score decomposition (Gneiting & Raftery, 2007): CRPS = MAE component − Spread. Evaluates the 51-member ensemble as a distribution; one scalar per lead day. CRPSS = 1 − CRPS/CRPS_climatology normalises it against a seasonal climatological forecast built from the observed record, which is why it requires the historical observations upload."
      >
        {!canComputeCrps && (
          <p style={{ color: '#555' }}>
            Need observed event data and downloaded forecasts before computing CRPS.
          </p>
        )}
        {canComputeCrps && (
          <button onClick={computeCrpsMetrics} disabled={computingCrps} style={btn}>
            {computingCrps
              ? 'Computing…'
              : app.crpsResults
                ? 'Re-compute CRPS'
                : 'Compute CRPS'}
          </button>
        )}
        {crpsError && <p style={{ color: '#b91c1c' }}>{crpsError}</p>}

        {app.crpsResults && (
          <div style={{ marginTop: '0.75rem' }}>
            <VariantSelect
              value={crpsVariant}
              onChange={setCrpsVariant}
              disabledReason={correctedCrps ? null : correctedUnavailableReason}
            />
            {crpsVariant === 'corrected' && correction && <CorrectionBanner c={correction} />}
          </div>
        )}

        {crpsDisplay && (
          <div style={subBlock}>
            <h3 style={h3}>CRPS and components by lead day</h3>
            <Plot
              {...crpsPerLeadFigure(crpsDisplay, {
                riverId: app.reach?.riverId ?? undefined,
                title: `CRPS and Components per Lead Day${riverIdSuffix}${variantSuffix(crpsVariant)}`,
              })}
            />
            <CrpsTable r={crpsDisplay} />
            <PlotNote>
              the red MAE line is the raw mean absolute error of the members against the
              observation; the green Spread line is the ensemble's internal disagreement (half
              the mean pairwise absolute difference). CRPS = MAE − Spread; the shaded green
              region is the "discount" the ensemble earns for being appropriately dispersed.
              Same units as discharge (m³/s); lower is better. Unlike the box plots above this
              scores the ensemble as a distribution rather than member by member, so it rewards
              being honestly uncertain instead of confidently wrong.
            </PlotNote>

            {crpsDisplay.crpss.some((v) => Number.isFinite(v)) ? (
              <div style={{ marginTop: '1.5rem' }}>
                <h3 style={h3}>CRPS skill score by lead day</h3>
                <Plot
                  {...crpssPerLeadFigure(crpsDisplay, {
                    riverId: app.reach?.riverId ?? undefined,
                    windowDays: CLIMATOLOGY_WINDOW_DAYS,
                    climatologySource: 'observed record',
                    titleSuffix: variantSuffix(crpsVariant),
                  })}
                />
                <PlotNote>
                  CRPS on its own has units of discharge, so a "good" value depends on how big
                  the river is. This normalises it against a climatological forecast — the
                  distribution of retrospective flows within ±{CLIMATOLOGY_WINDOW_DAYS} days of
                  the event's time of year. 1 is perfect, 0 means the ensemble was worth no more
                  than quoting the long-term record for that season, and anything in the red
                  region means it was actively worse than doing nothing. The lead day where the
                  line crosses zero is the honest limit of useful forecast skill for this event,
                  and it is a stricter test than the deterministic limit above because it judges
                  the whole distribution rather than category agreement.
                </PlotNote>
              </div>
            ) : (
              <p style={{ color: '#666', marginTop: '1rem', fontSize: '0.9rem' }}>
                CRPS skill score needs a climatological reference, and that reference must come
                from the <strong>observed</strong> record — a baseline built from model output is
                biased wherever the model is, which makes it artificially easy to beat. Upload
                historical observations on the Setup tab to enable CRPSS. The CRPS plot above
                needs no climatology and is unaffected.
              </p>
            )}
          </div>
        )}
      </CollapsibleBlock>
    </div>
  );
}

function CrpsTable({ r }: { r: import('../lib/metrics/crps').CrpsPerLead }) {
  return (
    <div style={{ marginTop: '0.75rem', overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: '0.9rem' }}>
        <thead>
          <tr>
            <th style={cmth}>Lead</th>
            <th style={cmth}>CRPS (m³/s)</th>
            <th style={cmth}>MAE component</th>
            <th style={cmth}>Spread</th>
            <th style={cmth}>N timesteps</th>
          </tr>
        </thead>
        <tbody>
          {r.leads.map((l, i) => {
            const c = r.crps[i];
            const m = r.mae[i];
            const s = r.spread[i];
            const n = r.nTimesteps[i];
            const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '—');
            return (
              <tr key={l}>
                <td style={cmtd}>{l}</td>
                <td style={cmtd}>{fmt(c)}</td>
                <td style={cmtd}>{fmt(m)}</td>
                <td style={cmtd}>{fmt(s)}</td>
                <td style={cmtd}>{n}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DetectionTable({ detection }: { detection: CrossingDetection }) {
  return (
    <div style={{ marginTop: '0.75rem', overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: '0.9rem' }}>
        <thead>
          <tr>
            <th style={cmth}>Lead</th>
            <th style={cmth}>Members</th>
            <th style={cmth}>Crossed (Δt)</th>
            <th style={cmth}>Obs ✓ / Fcst ✗</th>
            <th style={cmth}>Obs ✗</th>
            <th style={cmth}>Detection</th>
          </tr>
        </thead>
        <tbody>
          {detection.leads.map((l, i) => {
            const total = detection.nTotal[i];
            const crossed = detection.nCrossed[i];
            const rate = total > 0 ? `${Math.round((100 * crossed) / total)}%` : '—';
            return (
              <tr key={l}>
                <td style={cmtd}>{l}</td>
                <td style={cmtd}>{total}</td>
                <td style={cmtd}>{crossed}</td>
                <td style={cmtd}>{detection.nObsOnly[i]}</td>
                <td style={cmtd}>{detection.nNoObs[i]}</td>
                <td style={cmtd}>{rate}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CollapsibleBlock({
  title,
  description,
  defaultOpen = false,
  children,
}: {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section style={blockStyle}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={blockToggleButton}
      >
        <span style={chevronStyle} aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span>{title}</span>
      </button>
      {open && (
        <div style={blockBody}>
          {description && <p style={blockIntro}>{description}</p>}
          {children}
        </div>
      )}
    </section>
  );
}

function ContingencyMatrixTable({ result }: { result: ContingencyResult }) {
  const { matrix, labels, hits, underestimation, overestimation, n } = result;
  return (
    <div style={{ marginTop: '0.75rem' }}>
      <table style={{ borderCollapse: 'collapse', marginTop: '0.5rem' }}>
        <thead>
          <tr>
            <th style={cmthCorner}>
              <span style={{ color: '#666', fontWeight: 400 }}>obs ↓ / fcst →</span>
            </th>
            {labels.map((label) => (
              <th key={label} style={cmth}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => (
            <tr key={i}>
              <th style={cmthRow}>{labels[i]}</th>
              {row.map((v, j) => {
                const cellStyle: React.CSSProperties = { ...cmtd };
                if (i === j) cellStyle.background = 'rgba(46, 160, 67, 0.18)';
                else if (i > j) cellStyle.background = 'rgba(214, 39, 40, 0.10)';
                else cellStyle.background = 'rgba(255, 165, 0, 0.10)';
                return (
                  <td key={j} style={cellStyle}>
                    {v}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ marginTop: '0.6rem', color: '#444' }}>
        <strong>Hits</strong> (diagonal): {hits} &nbsp;|&nbsp;{' '}
        <strong>Underestimation</strong> (lower triangle): {underestimation} &nbsp;|&nbsp;{' '}
        <strong>Overestimation</strong> (upper triangle): {overestimation} &nbsp;|&nbsp;{' '}
        <strong>N</strong>: {n}
      </p>
    </div>
  );
}

function resolveSeries(bucket: LeadBucket, key: string): TimeSeries | null {
  if (key.startsWith('stat:')) {
    const stat = key.slice(5) as StatKey;
    return statSeries(bucket, stat);
  }
  if (key.startsWith('ensemble:')) {
    const idx = Number(key.slice(9));
    if (!Number.isInteger(idx) || idx < 0 || idx >= MEMBER_COUNT) return null;
    return memberSeries(bucket, idx);
  }
  return null;
}

function leadOptions(): number[] {
  const out: number[] = [];
  for (let i = 0; i <= MAX_LEAD; i++) out.push(i);
  return out;
}

const feasibilityBanner: React.CSSProperties = {
  margin: '0 0 1rem',
  padding: '0.7rem 1rem',
  border: '1px solid #fcd34d',
  background: '#fffbeb',
  borderRadius: 6,
  fontSize: '0.9rem',
  lineHeight: 1.6,
  color: '#4a3a12',
};
const gridBanner: React.CSSProperties = {
  margin: '0 0 1.25rem',
  padding: '0.5rem 0.85rem',
  border: '1px solid #bfdbfe',
  background: '#f0f7ff',
  borderRadius: 6,
  fontSize: '0.88rem',
  color: '#334155',
};
const blockStyle: React.CSSProperties = {
  marginBottom: '1.25rem',
  padding: '0',
  border: '1px solid #cbd5e1',
  borderRadius: 10,
  background: '#fff',
  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.03)',
  overflow: 'hidden',
};
const blockToggleButton: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  padding: '0.85rem 1.25rem',
  background: '#f8fafc',
  border: 'none',
  borderBottom: '2px solid #1f77b4',
  fontSize: '1.15rem',
  fontWeight: 600,
  color: '#1f2937',
  cursor: 'pointer',
  textAlign: 'left',
  fontFamily: 'inherit',
};
const chevronStyle: React.CSSProperties = {
  display: 'inline-block',
  width: '1rem',
  marginRight: '0.5rem',
  color: '#1f77b4',
  fontSize: '0.9em',
};
const blockBody: React.CSSProperties = {
  padding: '1.25rem 1.5rem',
};
const blockIntro: React.CSSProperties = {
  color: '#555',
  margin: '0 0 1rem',
  fontSize: '0.95rem',
};
const subBlock: React.CSSProperties = {
  marginTop: '1.5rem',
  paddingTop: '1rem',
  borderTop: '1px dashed #e5e7eb',
};
const h3: React.CSSProperties = {
  marginTop: 0,
  marginBottom: '0.6rem',
  fontSize: '1.02rem',
  color: '#222',
};
const btn: React.CSSProperties = {
  padding: '0.4rem 0.8rem',
  fontSize: '1rem',
  cursor: 'pointer',
};
const correctionBanner: React.CSSProperties = {
  margin: '0.75rem 0 1rem',
  padding: '0.6rem 0.9rem',
  border: '1px solid #fcd34d',
  background: '#fffbeb',
  borderRadius: 6,
  fontSize: '0.88rem',
  color: '#4a3a12',
};
const lbl: React.CSSProperties = { display: 'inline-flex', alignItems: 'center' };
const sel: React.CSSProperties = { padding: '0.3rem 0.5rem', fontSize: '0.95rem' };
const cmth: React.CSSProperties = {
  border: '1px solid #ccc',
  padding: '4px 10px',
  background: '#f6f7f9',
  fontSize: '0.9rem',
  textAlign: 'center',
};
const cmthCorner: React.CSSProperties = {
  ...cmth,
  textAlign: 'left',
};
const cmthRow: React.CSSProperties = {
  ...cmth,
  textAlign: 'right',
};
const cmtd: React.CSSProperties = {
  border: '1px solid #eee',
  padding: '4px 12px',
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
};
