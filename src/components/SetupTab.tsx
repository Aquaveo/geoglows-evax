import { useState } from 'react';
import { useApp } from '../state/AppContext';
import { getReachMetadata } from '../data/reachMetadata';
import { getAndCacheRetrospective } from '../data/rfs';
import { detectCadence } from '../lib/ingest/cadence';
import { assessEventData } from '../lib/ingest/dataQuality';
import { returnPeriodsFromSeries } from '../lib/gumbel';
import { extractEvent, suggestEventWindow } from '../lib/ingest/eventWindow';
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
  // Two ways to get event observations, because they are not equivalent: an
  // uploaded file can be sub-daily, while a historical record is usually daily
  // and caps peak-timing resolution at 24 h.
  const [eventMode, setEventMode] = useState<'upload' | 'extract'>('upload');
  const [extractDay, setExtractDay] = useState('');
  const [extractNote, setExtractNote] = useState<string | null>(null);

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
        <div style={{ display: 'flex', gap: '1.25rem', margin: '0 0 0.75rem', flexWrap: 'wrap' }}>
          {(
            [
              ['upload', 'Upload an event file'],
              ['extract', 'Take the event from the historical record'],
            ] as const
          ).map(([mode, label]) => (
            <label key={mode} style={{ fontSize: '0.9rem', cursor: 'pointer' }}>
              <input
                type="radio"
                name="eventMode"
                checked={eventMode === mode}
                onChange={() => setEventMode(mode)}
                style={{ marginRight: '0.35rem' }}
              />
              {label}
            </label>
          ))}
        </div>

        {eventMode === 'upload' ? (
          <CsvUploader
            label="Event observations (must be UTC, datetime + discharge)"
            // Stored at its native cadence — deliberately NOT resampled. The
            // comparison grid is chosen later, against the forecast cadence, so
            // that a coarse upload is never interpolated up into invented samples.
            onParsed={(s) => app.setEventData(sortByTime(s))}
          />
        ) : (
          <div>
            {!app.historicalData ? (
              <p style={note}>
                Upload the historical observations below first — this mode cuts the event out of
                that record, so there is nothing to slice until it is loaded.
              </p>
            ) : (
              <>
                <label style={{ fontSize: '0.9rem' }}>
                  Approximate date of the flood:&nbsp;
                  <input
                    type="date"
                    value={extractDay}
                    onChange={(e) => setExtractDay(e.target.value)}
                    style={{ padding: '0.25rem 0.4rem', fontSize: '0.9rem' }}
                  />
                </label>
                <button
                  style={{ ...btn, marginLeft: '0.5rem', padding: '0.3rem 0.7rem', fontSize: '0.9rem' }}
                  disabled={!extractDay}
                  onClick={() => {
                    setExtractNote(null);
                    const got = extractEvent(app.historicalData!, extractDay);
                    if (!got) {
                      setExtractNote(
                        'No data within 10 days of that date. Check the date against the record you uploaded.',
                      );
                      return;
                    }
                    app.setEventData(sortByTime(got.series));
                    setExtractNote(
                      `Peak ${got.peakValue.toFixed(1)} m³/s on ${got.peakDay}. ` +
                        `Window ${got.start} to ${got.end}, ${got.n} values at ` +
                        `${got.stepHours} h spacing.` +
                        (got.cadenceCaveat ? ` Note: ${got.cadenceCaveat}` : ''),
                    );
                  }}
                >
                  Find the event
                </button>
                <p style={{ ...note, marginTop: '0.5rem' }}>
                  The app finds the highest value within 10 days of the date, then opens the window
                  at the last minimum before the rise and closes it once flow is back near that
                  level. Use the upload option instead if you have sub-daily data for the event —
                  a daily record caps peak timing at 24 hours no matter how the window is chosen.
                </p>
                {extractNote && <p style={{ ...note, color: '#1d4ed8' }}>{extractNote}</p>}
              </>
            )}
          </div>
        )}
        <CsvUploader
          label="Historical observations — long record (observed return periods, bias correction, CRPSS)"
          onParsed={(s, meta) => {
            app.setHistoricalData(s);
            app.setHistoricalClampedNegatives(meta.clampedNegatives);
            try {
              app.setObsRp(returnPeriodsFromSeries(s));
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        />
        {app.eventData && (
          <>
            <p style={{ ...note, marginTop: '0.75rem' }}>
              Stored at its native{' '}
              <strong>{detectCadence(app.eventData)?.label ?? 'unknown'}</strong> resolution — see{' '}
              <em>Temporal resolution</em> on the Overview tab for how this sets the comparison grid.
            </p>
            <EventQualityNotice event={app.eventData} reference={app.historicalData} />
            <WindowAdvice event={app.eventData} />
          </>
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

/**
 * What window to use for this event, and whether the one loaded is well chosen.
 *
 * The advice is hydrograph-shaped rather than a fixed number of days: the right
 * answer depends on how fast the river rose and how slowly it drains. Two events
 * verified with this app wanted 5 days before the peak and 25 after, and 16
 * before and 14 after — a fixed rule would have clipped one of them.
 *
 * Note what this deliberately does NOT advise: shortening the window to raise the
 * categorical base rate. Measured on a real event, the base rate stays 8-80x its
 * long-run value at every window length under the cap, so the dilution cannot be
 * fixed this way. Meanwhile pairs per lead equal the window length in days, so a
 * longer window is strictly better for everything else.
 */
function WindowAdvice({ event }: { event: TimeSeries }) {
  const w = suggestEventWindow(event);
  if (!w) return null;
  const loaded = {
    start: event.time[0].toISOString().slice(0, 10),
    end: event.time[event.time.length - 1].toISOString().slice(0, 10),
  };
  const matches = loaded.start === w.start && loaded.end === w.end;

  return (
    <div style={advice}>
      <strong>Suggested window for this event.</strong>{' '}
      <code>{w.start}</code> to <code>{w.end}</code> — {w.daysBefore} days before the peak and{' '}
      {w.daysAfter} after, opening at {w.baseline.toFixed(0)} m³/s and closing at{' '}
      {w.endFlow.toFixed(0)}, with the peak of {w.peakValue.toFixed(0)} m³/s on{' '}
      <code>{w.peakDay}</code>.
      <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.2rem', lineHeight: 1.6 }}>
        <li>
          Open the window at the last low point <em>before</em> the rise so the whole rising limb is
          inside, and close it once flow is back near that level. Both ends at comparable flow means
          the event is bracketed rather than clipped.
        </li>
        <li>
          If the two will not both fit in the 31-day cap, cut from the <strong>front</strong>. Losing
          pre-event days costs a little lead coverage; losing the falling limb distorts every volume
          and timing metric and stops the peak being bracketed.
        </li>
        <li>
          Longer is otherwise better: forecast/observation pairs at every lead day equal the window
          length in days, so a 31-day window gives 31 pairs per lead where a 14-day window gives 14.
        </li>
        {w.recessionTruncated && (
          <li style={{ color: '#7f1d1d' }}>
            <strong>Recession is cut off.</strong> {w.recessionTruncated}.
          </li>
        )}
        {w.dataLimited && <li style={{ color: '#7f1d1d' }}>{w.dataLimited}.</li>}
      </ul>
      {!matches && (
        <p style={{ margin: '0.5rem 0 0' }}>
          The series currently loaded runs <code>{loaded.start}</code> to <code>{loaded.end}</code>.
          Enter the suggested dates on the Forecast tab, or re-cut the upload to match.
        </p>
      )}
    </div>
  );
}

/**
 * Gaps and extreme values in the uploaded event series.
 *
 * Both are invisible in a plot of a short event but dominate every magnitude
 * metric: one reading far above the historical record owns almost all of the
 * observed variance, so NSE and KGE' stop measuring forecast skill. A gap
 * through the peak means the true maximum may not be in the file at all.
 */
function EventQualityNotice({
  event,
  reference,
}: {
  event: TimeSeries;
  reference: TimeSeries | null;
}) {
  const q = assessEventData(event, reference);
  if (!q) return null;
  const hasIssue = q.outliers.length > 0 || q.totalMissingSteps > 0;
  if (!hasIssue) return null;

  const fmt = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ');

  return (
    <div style={qualityNotice}>
      <strong>Check the event data before trusting the metrics.</strong>
      <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.2rem', lineHeight: 1.6 }}>
        {q.totalMissingSteps > 0 && (
          <li>
            <strong>{q.totalMissingSteps} missing {q.cadenceLabel} value
            {q.totalMissingSteps === 1 ? '' : 's'}</strong>
            {q.gaps.length > 0 && (
              <>
                {' '}— largest gap {q.gaps[0].missingSteps} step
                {q.gaps[0].missingSteps === 1 ? '' : 's'} after {fmt(q.gaps[0].after)}
              </>
            )}
            . If a gap covers the peak, the observed maximum may not be in the file.
          </li>
        )}
        {q.outliers.length > 0 && q.referenceMax != null && (
          <li>
            <strong>
              {q.outliers.length} value{q.outliers.length === 1 ? '' : 's'} above the historical
              maximum
            </strong>{' '}
            of {q.referenceMax.toFixed(1)} m³/s:{' '}
            {q.outliers
              .slice(0, 3)
              .map((o) => `${o.value.toFixed(1)} (${o.ratio.toFixed(1)}×) at ${fmt(o.time)}`)
              .join('; ')}
            {q.outliers.length > 3 && ` and ${q.outliers.length - 3} more`}. A single reading many
            times the record owns almost all of a short event's variance, so NSE and KGE′ will
            mostly be measuring whether the forecast reproduced that one value — which no forecast
            will. Verify it against the gauge before reading the magnitude metrics.
          </li>
        )}
      </ul>
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
const advice: React.CSSProperties = {
  marginTop: '0.75rem',
  padding: '0.7rem 1rem',
  border: '1px solid #bfdbfe',
  background: '#eff6ff',
  borderRadius: 6,
  fontSize: '0.9rem',
  color: '#1e3a5f',
  lineHeight: 1.6,
};
const qualityNotice: React.CSSProperties = {
  marginTop: '0.75rem',
  padding: '0.7rem 1rem',
  border: '1px solid #fca5a5',
  background: '#fef2f2',
  borderRadius: 6,
  fontSize: '0.9rem',
  color: '#7f1d1d',
};
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
