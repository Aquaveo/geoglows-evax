import { useState } from 'react';
import { useApp } from '../state/AppContext';
import { getReachMetadata } from '../data/reachMetadata';
import { getAndCacheRetrospective } from '../data/rfs';
import { detectCadence } from '../lib/ingest/cadence';
import { returnPeriodsFromSeries } from '../lib/gumbel';
import { ReachMap } from './Map';
import { CsvUploader } from './CsvUploader';
import { Plot } from './Plot';
import { retrospectiveFigure } from '../plots/retrospective';
import { eventVsRetrospectiveFigure } from '../plots/eventVsRetrospective';
import { PlotNote } from './PlotNote';
import { RP_LEVELS, type TimeSeries } from '../lib/types';

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
          // Stored at its native cadence — deliberately NOT resampled. The
          // comparison grid is chosen later, against the forecast cadence, so
          // that a coarse upload is never interpolated up into invented samples.
          onParsed={(s) => app.setEventData(sortByTime(s))}
        />
        <CsvUploader
          label="Historical observations — long record (observed return periods, bias correction, CRPSS)"
          onParsed={(s) => {
            app.setHistoricalData(s);
            try {
              app.setObsRp(returnPeriodsFromSeries(s));
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        />
        {app.eventData && (
          <p style={{ ...note, marginTop: '0.75rem' }}>
            Stored at its native{' '}
            <strong>{detectCadence(app.eventData)?.label ?? 'unknown'}</strong> resolution — see{' '}
            <em>Temporal resolution</em> on the Overview tab for how this sets the comparison grid.
          </p>
        )}
      </section>

      {app.eventData && app.retro && (
        <section style={sectionStyle}>
          <h2 style={h2}>Event vs retrospective</h2>
          <p style={note}>
            Uploaded event observations against the RFS retrospective simulation over the
            same period. Click a legend entry to hide a series — the y-axis rescales to what is
            left, which is what you want when observed and simulated magnitudes differ.
          </p>
          <Plot
            {...eventVsRetrospectiveFigure(app.retro, app.eventData, {
              simRp: app.simRp,
              obsRp: app.obsRp,
            })}
          />
          <PlotNote>
            black is the discharge you uploaded, blue is what the RFS model simulated over
            the same dates. A persistent gap between them means the model has a magnitude bias at
            this reach — which is why forecasts are later scored against <em>simulated</em>{' '}
            return periods rather than observed ones. If the two peak at different times, that is
            a timing bias, quantified on the Metrics tab.
          </PlotNote>
        </section>
      )}

      {app.eventData && !app.retro && (
        <p style={{ ...note, marginBottom: '2rem' }}>
          Load a reach above to compare the uploaded event against the retrospective simulation.
        </p>
      )}

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
          <PlotNote>
            the model's full simulated daily record for this reach. The simulated return periods
            in the table above are a Gumbel-I fit to this series, so its annual peaks are what
            set those thresholds. Compare the height of past peaks against your event to judge
            how unusual the event was in the model's own terms.
          </PlotNote>
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

/** Ascending by timestamp; every downstream metric assumes chronological order. */
function sortByTime(s: TimeSeries): TimeSeries {
  const idx = s.time.map((_, i) => i);
  idx.sort((a, b) => s.time[a].getTime() - s.time[b].getTime());
  return { time: idx.map((i) => s.time[i]), values: idx.map((i) => s.values[i]) };
}

const sectionStyle: React.CSSProperties = {
  marginBottom: '2rem',
  padding: '1rem 1.25rem',
  border: '1px solid #ddd',
  borderRadius: 8,
  background: '#fff',
};
const h2: React.CSSProperties = { marginTop: 0, fontSize: '1.05rem' };
const note: React.CSSProperties = {
  color: '#555',
  fontSize: '0.9rem',
  margin: '0 0 0.5rem',
};
const btn: React.CSSProperties = {
  padding: '0.4rem 0.8rem',
  fontSize: '1rem',
  cursor: 'pointer',
};
const th: React.CSSProperties = { textAlign: 'left', borderBottom: '1px solid #ccc', padding: '4px 8px' };
const td: React.CSSProperties = { borderBottom: '1px solid #eee', padding: '4px 8px' };
