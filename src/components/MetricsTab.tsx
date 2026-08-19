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
import { computeThresholdCrossing } from '../lib/metrics/thresholdCrossing';
import { kge } from '../lib/metrics/kge';
import { computeCrpsByLead } from '../lib/metrics/crps';
import { Plot } from './Plot';
import {
  distributionVsLeadFigure,
  type PerLeadDistribution,
} from '../plots/distributionVsLead';
import { deterministicLimitFigure } from '../plots/deterministicLimit';
import { crpsPerLeadFigure } from '../plots/crpsPerLead';
import { RP_LEVELS } from '../lib/types';
import type { CrossingDetection } from '../state/AppContext';

const MAX_LEAD = 15;
const MEMBER_COUNT = 51;

const STAT_OPTIONS: { key: StatKey; label: string }[] = [
  { key: 'median', label: 'Ensemble median' },
  { key: 'mean', label: 'Ensemble mean' },
  { key: 'p25', label: 'Ensemble p25' },
  { key: 'p75', label: 'Ensemble p75' },
  { key: 'min', label: 'Ensemble min' },
  { key: 'max', label: 'Ensemble max' },
];

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

  const canCompute = !!(
    app.eventData &&
    app.forecasts.size > 0 &&
    app.obsRp &&
    app.simRp
  );

  const canComputeTiming = !!(app.eventData && app.forecasts.size > 0);
  const canComputeCrossing = canComputeTiming && !!(app.obsRp && app.simRp);
  const canComputeAccuracy = !!(app.eventData && app.forecasts.size > 0);
  const canComputeCrps = !!(app.eventData && app.forecasts.size > 0);

  function computeCategoricalMetrics() {
    setError(null);
    if (!app.eventData || !app.obsRp || !app.simRp) return;
    setComputing(true);
    setTimeout(() => {
      try {
        const buckets = reorganizeByLead(app.forecasts, MAX_LEAD);
        app.setLeadBuckets(buckets);

        const eventRp = determineEventReturnPeriod(app.eventData!, app.obsRp!);
        app.setEventReturnPeriod(eventRp);

        const mccDist: PerLeadDistribution = { leads: [], values: [] };
        const hssDist: PerLeadDistribution = { leads: [], values: [] };

        for (let lead = 0; lead <= MAX_LEAD; lead++) {
          const bucket = buckets[lead];
          mccDist.leads.push(lead);
          hssDist.leads.push(lead);

          const mccVals: number[] = [];
          const hssVals: number[] = [];

          if (bucket && bucket.time.length > 0) {
            for (let m = 0; m < MEMBER_COUNT; m++) {
              const ms = memberSeries(bucket, m);
              const cm = buildContingencyMatrix(
                ms,
                app.eventData!,
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
    if (!app.eventData) return;
    setComputingTiming(true);
    setTimeout(() => {
      try {
        // Reuse lead buckets if already computed; otherwise build them.
        const buckets =
          app.leadBuckets ?? reorganizeByLead(app.forecasts, MAX_LEAD);
        if (!app.leadBuckets) app.setLeadBuckets(buckets);

        // Peak timing distribution
        const peakDist: PerLeadDistribution = { leads: [], values: [] };
        for (let lead = 0; lead <= MAX_LEAD; lead++) {
          peakDist.leads.push(lead);
          const vals: number[] = [];
          const bucket = buckets[lead];
          if (bucket && bucket.time.length > 0) {
            for (let m = 0; m < MEMBER_COUNT; m++) {
              const dt = computePeakTimingError(
                memberSeries(bucket, m),
                app.eventData!,
              );
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
            const dist: PerLeadDistribution = { leads: [], values: [] };
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
              if (bucket && bucket.time.length > 0) {
                for (let m = 0; m < MEMBER_COUNT; m++) {
                  nTotal += 1;
                  const r = computeThresholdCrossing(
                    memberSeries(bucket, m),
                    app.eventData!,
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
    if (!app.eventData) return;
    setComputingAccuracy(true);
    setTimeout(() => {
      try {
        const buckets =
          app.leadBuckets ?? reorganizeByLead(app.forecasts, MAX_LEAD);
        if (!app.leadBuckets) app.setLeadBuckets(buckets);

        const kgeDist: PerLeadDistribution = { leads: [], values: [] };
        const rDist: PerLeadDistribution = { leads: [], values: [] };
        const betaDist: PerLeadDistribution = { leads: [], values: [] };
        const gammaDist: PerLeadDistribution = { leads: [], values: [] };

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
          if (bucket && bucket.time.length > 0) {
            for (let m = 0; m < MEMBER_COUNT; m++) {
              const result = kge(memberSeries(bucket, m), app.eventData!);
              if (Number.isFinite(result.kge)) kVals.push(result.kge);
              if (Number.isFinite(result.r)) rVals.push(result.r);
              if (Number.isFinite(result.beta)) bVals.push(result.beta);
              if (Number.isFinite(result.gamma)) gVals.push(result.gamma);
            }
          }
          kgeDist.values.push(kVals);
          rDist.values.push(rVals);
          betaDist.values.push(bVals);
          gammaDist.values.push(gVals);
        }

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
    if (!app.eventData) return;
    setComputingCrps(true);
    setTimeout(() => {
      try {
        const buckets =
          app.leadBuckets ?? reorganizeByLead(app.forecasts, MAX_LEAD);
        if (!app.leadBuckets) app.setLeadBuckets(buckets);

        const result = computeCrpsByLead(buckets, app.eventData!, MAX_LEAD);
        app.setCrpsResults(result);
      } catch (e) {
        setCrpsError(e instanceof Error ? e.message : String(e));
      } finally {
        setComputingCrps(false);
      }
    }, 0);
  }

  // Recompute the contingency matrix on lead/series selection change.
  const contingency = useMemo<ContingencyResult | null>(() => {
    if (
      !app.leadBuckets ||
      !app.eventData ||
      !app.obsRp ||
      !app.simRp ||
      app.eventReturnPeriod == null
    ) {
      return null;
    }
    const bucket = app.leadBuckets[matrixLead];
    if (!bucket) return null;
    const series = resolveSeries(bucket, matrixSeriesKey);
    if (!series) return null;
    return buildContingencyMatrix(
      series,
      app.eventData,
      app.obsRp,
      app.simRp,
      app.eventReturnPeriod,
    );
  }, [
    app.leadBuckets,
    app.eventData,
    app.obsRp,
    app.simRp,
    app.eventReturnPeriod,
    matrixLead,
    matrixSeriesKey,
  ]);

  // Deterministic-limit data for the currently selected forecast series.
  const detLimit = useMemo<{
    leads: number[];
    hits: number[];
    misses: number[];
    detLimit: number;
  } | null>(() => {
    if (
      !app.leadBuckets ||
      !app.eventData ||
      !app.obsRp ||
      !app.simRp ||
      app.eventReturnPeriod == null
    ) {
      return null;
    }
    const leads: number[] = [];
    const hits: number[] = [];
    const misses: number[] = [];
    for (let lead = 0; lead <= MAX_LEAD; lead++) {
      const bucket = app.leadBuckets[lead];
      if (!bucket) continue;
      const series = resolveSeries(bucket, matrixSeriesKey);
      if (!series) continue;
      const cm = buildContingencyMatrix(
        series,
        app.eventData,
        app.obsRp,
        app.simRp,
        app.eventReturnPeriod,
      );
      leads.push(lead);
      hits.push(cm.hits);
      misses.push(cm.underestimation + cm.overestimation);
    }
    // Last lead where hits > misses (Hewson 2007: keep the last crossing, not the first).
    let dl = -1;
    for (let i = 0; i < leads.length; i++) {
      if (hits[i] > misses[i]) dl = leads[i];
    }
    return { leads, hits, misses, detLimit: dl };
  }, [
    app.leadBuckets,
    app.eventData,
    app.obsRp,
    app.simRp,
    app.eventReturnPeriod,
    matrixSeriesKey,
  ]);

  const seriesLabel = describeSeriesKey(matrixSeriesKey);

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
              <ContingencyMatrixTable result={contingency} />
            )}
            {detLimit && detLimit.leads.length > 0 && (
              <div style={{ marginTop: '1rem' }}>
                <Plot
                  {...deterministicLimitFigure({
                    leads: detLimit.leads,
                    hits: detLimit.hits,
                    misses: detLimit.misses,
                    detLimit: detLimit.detLimit,
                    seriesLabel,
                    riverId: app.reach?.riverId ?? undefined,
                  })}
                />
              </div>
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
            <DetectionTable detection={app.crossingDetections[crossingRp]} />
          </div>
        )}
      </CollapsibleBlock>

      <CollapsibleBlock
        title="Accuracy metrics"
        description="Kling-Gupta efficiency (KGE') and its decomposition: Pearson correlation r, bias ratio β = μ_f/μ_o, variability ratio γ = CV_f/CV_o (Kling et al., 2012)."
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
          <div style={subBlock}>
            <h3 style={h3}>KGE' distribution by lead day</h3>
            <Plot
              {...distributionVsLeadFigure(app.kgeDistribution, {
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
          </div>
        )}

        {app.rDistribution && (
          <div style={subBlock}>
            <h3 style={h3}>Pearson correlation (r) by lead day</h3>
            <Plot
              {...distributionVsLeadFigure(app.rDistribution, {
                metricLabel: 'r',
                title: `Pearson Correlation per Lead Day${riverIdSuffix}`,
                subtitle: 'KGE component  |  51 members (leads 0–15)',
                yAxisLabel: 'r',
                referenceLines: [{ y: 1, label: 'r = 1 (perfect)', color: 'green' }],
                zeroLine: true,
              })}
            />
          </div>
        )}

        {app.betaDistribution && (
          <div style={subBlock}>
            <h3 style={h3}>Bias ratio (β) by lead day</h3>
            <Plot
              {...distributionVsLeadFigure(app.betaDistribution, {
                metricLabel: 'β',
                title: `Bias Ratio per Lead Day${riverIdSuffix}`,
                subtitle:
                  'β = μ_forecast / μ_observed  |  β < 1 underestimate, β > 1 overestimate  |  51 members',
                yAxisLabel: 'β',
                referenceLines: [{ y: 1, label: 'β = 1 (no bias)', color: 'green' }],
              })}
            />
          </div>
        )}

        {app.gammaDistribution && (
          <div style={subBlock}>
            <h3 style={h3}>Variability ratio (γ) by lead day</h3>
            <Plot
              {...distributionVsLeadFigure(app.gammaDistribution, {
                metricLabel: 'γ',
                title: `Variability Ratio per Lead Day${riverIdSuffix}`,
                subtitle:
                  'γ = CV_forecast / CV_observed (Kling et al., 2012)  |  γ < 1 under-varies, γ > 1 over-varies  |  51 members',
                yAxisLabel: 'γ',
                referenceLines: [{ y: 1, label: 'γ = 1 (perfect)', color: 'green' }],
              })}
            />
          </div>
        )}
      </CollapsibleBlock>

      <CollapsibleBlock
        title="Probabilistic metrics"
        description="Continuous Ranked Probability Score (CRPS) via the energy-score decomposition (Gneiting & Raftery, 2007): CRPS = MAE component − Spread. Evaluates the 51-member ensemble as a distribution; one scalar per lead day."
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
          <div style={subBlock}>
            <h3 style={h3}>CRPS and components by lead day</h3>
            <Plot
              {...crpsPerLeadFigure(app.crpsResults, {
                riverId: app.reach?.riverId ?? undefined,
              })}
            />
            <CrpsTable r={app.crpsResults} />
            <p style={{ marginTop: '0.6rem', color: '#555', fontSize: '0.9rem' }}>
              <strong>Reading the plot:</strong> the red MAE line is the raw mean absolute
              error of the members against the observation; the green Spread line is the
              ensemble's internal disagreement (half the mean pairwise absolute
              difference). CRPS = MAE − Spread; the shaded green region is the "discount"
              the ensemble earns for being appropriately dispersed. Same units as
              discharge (m³/s); lower is better.
            </p>
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

function describeSeriesKey(key: string): string {
  if (key.startsWith('stat:')) {
    const stat = key.slice(5);
    const labels: Record<string, string> = {
      median: 'Ensemble median (p50)',
      mean: 'Ensemble mean',
      p25: 'Ensemble p25',
      p75: 'Ensemble p75',
      min: 'Ensemble min',
      max: 'Ensemble max',
    };
    return labels[stat] ?? `Statistic: ${stat}`;
  }
  if (key.startsWith('ensemble:')) {
    const idx = Number(key.slice(9));
    return `Ensemble ${String(idx + 1).padStart(2, '0')}`;
  }
  return key;
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
