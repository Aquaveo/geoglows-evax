import { useState } from 'react';
import { useApp } from '../state/AppContext';
import { reorganizeByLead, memberSeries } from '../lib/leadBuckets';
import { kge } from '../lib/metrics/kge';
import { Plot } from './Plot';
import { kgeVsLeadFigure, type PerLeadDistribution } from '../plots/kgeVsLead';

const MAX_LEAD = 15;
const MEMBER_COUNT = 51;

export function MetricsTab() {
  const app = useApp();
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCompute = !!(app.eventData && app.forecasts.size > 0);

  function computeKge() {
    setError(null);
    if (!app.eventData) return;
    setComputing(true);
    // Yield to UI then compute.
    setTimeout(() => {
      try {
        const buckets = reorganizeByLead(app.forecasts, MAX_LEAD);
        app.setLeadBuckets(buckets);

        const leads: number[] = [];
        const median: number[] = [];
        const p25: number[] = [];
        const p75: number[] = [];
        const min: number[] = [];
        const max: number[] = [];

        for (let lead = 0; lead <= MAX_LEAD; lead++) {
          leads.push(lead);
          const bucket = buckets[lead];
          if (!bucket || bucket.time.length === 0) {
            median.push(NaN); p25.push(NaN); p75.push(NaN); min.push(NaN); max.push(NaN);
            continue;
          }
          const kges: number[] = [];
          for (let m = 0; m < MEMBER_COUNT; m++) {
            const ms = memberSeries(bucket, m);
            const r = kge(ms, app.eventData!);
            if (Number.isFinite(r.kge)) kges.push(r.kge);
          }
          if (kges.length === 0) {
            median.push(NaN); p25.push(NaN); p75.push(NaN); min.push(NaN); max.push(NaN);
            continue;
          }
          const sorted = [...kges].sort((a, b) => a - b);
          median.push(quantile(sorted, 0.5));
          p25.push(quantile(sorted, 0.25));
          p75.push(quantile(sorted, 0.75));
          min.push(sorted[0]);
          max.push(sorted[sorted.length - 1]);
        }
        const dist: PerLeadDistribution = { leads, median, p25, p75, min, max };
        app.setKgeDistribution(dist);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setComputing(false);
      }
    }, 0);
  }

  return (
    <div>
      <section style={section}>
        <h2 style={h2}>KGE by lead day</h2>
        {!canCompute && (
          <p style={{ color: '#555' }}>
            Need both the event CSV (Setup tab) and downloaded forecasts (Forecast tab) before computing metrics.
          </p>
        )}
        {canCompute && (
          <button onClick={computeKge} disabled={computing} style={btn}>
            {computing ? 'Computing…' : app.kgeDistribution ? 'Re-compute KGE' : 'Compute KGE'}
          </button>
        )}
        {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
        {app.kgeDistribution && (
          <div style={{ marginTop: '1rem' }}>
            <Plot {...kgeVsLeadFigure(app.kgeDistribution)} />
          </div>
        )}
      </section>
    </div>
  );
}

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

const section: React.CSSProperties = {
  marginBottom: '2rem',
  padding: '1rem 1.25rem',
  border: '1px solid #ddd',
  borderRadius: 8,
  background: '#fff',
};
const h2: React.CSSProperties = { marginTop: 0, fontSize: '1.05rem' };
const btn: React.CSSProperties = {
  padding: '0.4rem 0.8rem',
  fontSize: '1rem',
  cursor: 'pointer',
};
