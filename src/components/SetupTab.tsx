import { useState } from 'react';
import { useApp } from '../state/AppContext';
import { getReachMetadata } from '../data/reachMetadata';
import { getAndCacheRetrospective } from '../data/rfs';
import { resampleHourly } from '../lib/ingest/resampleHourly';
import { returnPeriodsFromSeries } from '../lib/gumbel';
import { ReachMap } from './Map';
import { CsvUploader } from './CsvUploader';
import { Plot } from './Plot';
import { retrospectiveFigure } from '../plots/retrospective';
import { RP_LEVELS } from '../lib/types';

export function SetupTab() {
  const app = useApp();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onLoadReach() {
    setError(null);
    const n = Number(input);
    if (!Number.isInteger(n) || n < 1e8 || n > 1e9 - 1) {
      setError('river_id must be a 9-digit integer.');
      return;
    }
    setLoading(true);
    try {
      app.setRiverId(n);
      const [reach, retro] = await Promise.all([
        getReachMetadata(n),
        getAndCacheRetrospective(n, 'daily'),
      ]);
      app.setReach(reach);
      const retroSeries = { time: retro.time, values: retro.discharge };
      app.setRetro(retroSeries);
      // Compute simulated return periods from the daily retrospective with the
      // same Gumbel-I fit the notebook uses (cell 78), instead of the server's
      // precomputed values. Negatives are clamped to 0 to match the notebook.
      const clamped = {
        time: retroSeries.time,
        values: retroSeries.values.map((v) => (Number.isFinite(v) && v < 0 ? 0 : v)),
      };
      app.setSimRp(returnPeriodsFromSeries(clamped));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      app.setRiverId(null);
      app.setReach(null);
      app.setRetro(null);
      app.setSimRp(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <section style={sectionStyle}>
        <h2 style={h2}>Choose a reach</h2>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="9-digit river_id"
            style={{ padding: '0.4rem 0.6rem', fontSize: '1rem', width: 200 }}
          />
          <button onClick={onLoadReach} disabled={loading} style={btn}>
            {loading ? 'Loading…' : 'Load reach'}
          </button>
          {error && <span style={{ color: '#b91c1c' }}>{error}</span>}
        </div>
        {app.reach && (
          <p style={{ color: '#555', marginTop: '0.5rem' }}>
            Reach <code>{app.reach.riverId}</code> loaded.
            {app.reach.lat != null && app.reach.lon != null && (
              <> Lat <code>{app.reach.lat}</code>, lon <code>{app.reach.lon}</code>.</>
            )}
          </p>
        )}
      </section>

      {app.reach && app.reach.lat != null && app.reach.lon != null && (
        <section style={sectionStyle}>
          <h2 style={h2}>Reach location</h2>
          <ReachMap lat={app.reach.lat} lon={app.reach.lon} riverId={app.reach.riverId} />
        </section>
      )}

      <section style={sectionStyle}>
        <h2 style={h2}>Upload observed data</h2>
        <CsvUploader
          label="Event observations (must be UTC, datetime + discharge)"
          onParsed={(s) => app.setEventData(resampleHourly(s))}
        />
        <CsvUploader
          label="Historical observations (for observed return periods)"
          onParsed={(s) => {
            app.setHistoricalData(s);
            try {
              app.setObsRp(returnPeriodsFromSeries(s));
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        />
      </section>

      {(app.simRp || app.obsRp) && (
        <section style={sectionStyle}>
          <h2 style={h2}>Return periods (m³/s)</h2>
          <RpTable simRp={app.simRp} obsRp={app.obsRp} />
        </section>
      )}

      {app.retro && (
        <section style={sectionStyle}>
          <h2 style={h2}>Retrospective daily discharge</h2>
          <Plot {...retrospectiveFigure(app.retro)} />
        </section>
      )}
    </div>
  );
}

function RpTable({ simRp, obsRp }: { simRp: Record<number, number> | null; obsRp: Record<number, number> | null }) {
  return (
    <table style={{ borderCollapse: 'collapse', minWidth: 360 }}>
      <thead>
        <tr>
          <th style={th}>RP (yr)</th>
          <th style={th}>Simulated</th>
          <th style={th}>Observed</th>
        </tr>
      </thead>
      <tbody>
        {RP_LEVELS.map((rp) => (
          <tr key={rp}>
            <td style={td}>{rp}</td>
            <td style={td}>{simRp ? simRp[rp]?.toFixed(2) ?? '—' : '—'}</td>
            <td style={td}>{obsRp ? obsRp[rp]?.toFixed(2) ?? '—' : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const sectionStyle: React.CSSProperties = {
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
const th: React.CSSProperties = { textAlign: 'left', borderBottom: '1px solid #ccc', padding: '4px 8px' };
const td: React.CSSProperties = { borderBottom: '1px solid #eee', padding: '4px 8px' };
