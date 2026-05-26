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
import { Plot } from './Plot';
import {
  distributionVsLeadFigure,
  type PerLeadDistribution,
} from '../plots/distributionVsLead';
import { deterministicLimitFigure } from '../plots/deterministicLimit';

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

  const canCompute = !!(
    app.eventData &&
    app.forecasts.size > 0 &&
    app.obsRp &&
    app.simRp
  );

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
