import { useEffect, useMemo, useRef, useState } from 'react';
import { PROSE_MAX } from '../prose';
import { useApp } from '../state/appState';
import { fetchForecasts } from '../data/rfs';
import { dailyDateRange, reorganizeByLead, statSeries, type StatKey } from '../lib/leadBuckets';
import { pickDefaultRun } from '../lib/defaultRun';
import { Plot } from './Plot';
import { forecastFigure } from '../plots/forecasts';
import { eventVsLeadFigure, type LeadSeries } from '../plots/eventVsLead';
import { PlotNote } from './PlotNote';

const INIT_LOOKBACK_DAYS = 15;
const MAX_EVENT_WINDOW_DAYS = 31;
const DAY_MS = 24 * 3600 * 1000;
const MAX_LEAD = 15;

const STAT_OPTIONS: { key: StatKey; label: string }[] = [
  { key: 'median', label: 'Ensemble median' },
  { key: 'mean', label: 'Ensemble mean' },
  { key: 'p25', label: 'Ensemble p25' },
  { key: 'p75', label: 'Ensemble p75' },
  { key: 'min', label: 'Ensemble min' },
  { key: 'max', label: 'Ensemble max' },
];

/** Shown on load; the rest are one legend click away. */
const DEFAULT_VISIBLE_LEADS = [1, 3, 5, 7, 10, 15];

function utcDayFloor(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function ForecastTab() {
  const app = useApp();

  // Auto-derive defaults from the uploaded event CSV.
  const csvBounds = useMemo(() => {
    if (!app.eventData || app.eventData.time.length === 0) return null;
    return {
      start: utcDayFloor(app.eventData.time[0]),
      end: utcDayFloor(app.eventData.time[app.eventData.time.length - 1]),
    };
  }, [app.eventData]);

  // User-overridable event window, DERIVED from the CSV rather than copied into
  // state by an effect.
  //
  // The effect version wrote the CSV's bounds into state on mount, which meant a
  // render, a setState, and a second render every time the upload changed — the
  // cascading-render pattern react-hooks/set-state-in-effect exists to catch. It
  // also could not distinguish "not set yet" from "user cleared the field",
  // because both are the empty string, so clearing the box refilled it.
  //
  // Null here means "not overridden", so the default follows a newly uploaded
  // CSV while a value the user typed survives one.
  const [startOverride, setStartOverride] = useState<string | null>(null);
  const [endOverride, setEndOverride] = useState<string | null>(null);
  const eventStartStr = startOverride ?? (csvBounds ? ymd(csvBounds.start) : '');
  const eventEndStr = endOverride ?? (csvBounds ? ymd(csvBounds.end) : '');

  const validation = useMemo(() => {
    if (!eventStartStr || !eventEndStr) {
      return { ok: false as const, reason: 'Set both event start and end.' };
    }
    const eventStart = parseYmd(eventStartStr);
    const eventEnd = parseYmd(eventEndStr);
    if (eventEnd.getTime() < eventStart.getTime()) {
      return { ok: false as const, reason: 'End date must be on or after start date.' };
    }
    const eventDays =
      Math.round((eventEnd.getTime() - eventStart.getTime()) / DAY_MS) + 1;
    if (eventDays > MAX_EVENT_WINDOW_DAYS) {
      return {
        ok: false as const,
        reason: `Event window is ${eventDays} days; max is ${MAX_EVENT_WINDOW_DAYS}.`,
      };
    }
    const downloadStart = new Date(eventStart.getTime() - INIT_LOOKBACK_DAYS * DAY_MS);
    return { ok: true as const, eventStart, eventEnd, downloadStart, eventDays };
  }, [eventStartStr, eventEndStr]);

  const forecastDates = useMemo(() => {
    if (!validation.ok) return [];
    return dailyDateRange(validation.downloadStart, validation.eventEnd);
  }, [validation]);

  // Whether the shown initialization is still the app's own choice. Once the
  // user drags the slider, nothing below may override them.
  const runPickedByUser = useRef(false);

  // Open on a run that actually forecast the event — see pickDefaultRun.
  //
  // Re-runs while the choice is still ours, so that observations arriving after
  // the forecasts upgrade the middle-initialization fallback to a crest-aware
  // pick rather than leaving the weaker guess in place.
  useEffect(() => {
    if (runPickedByUser.current || app.forecasts.size === 0) return;
    const pick = pickDefaultRun([...app.forecasts.keys()].sort(), app.eventData, MAX_LEAD);
    if (pick && pick !== app.selectedDate) app.setSelectedDate(pick);
  }, [app.forecasts, app.eventData, app.selectedDate, app]);

  async function downloadAll() {
    if (!app.riverId || !validation.ok) return;
    app.setForecastProgress({ done: 0, total: forecastDates.length });
    const m = await fetchForecasts(app.riverId, forecastDates, 4, (done, total) =>
      app.setForecastProgress({ done, total }),
    );
    app.setForecasts(m);
    app.setForecastProgress(null);
    app.setLeadBuckets(null); // invalidate downstream
    app.setMccDistribution(null);
    app.setHssDistribution(null);
    app.setEventReturnPeriod(null);
  }

  const selected = app.selectedDate ? app.forecasts.get(app.selectedDate) ?? null : null;

  // --- Event vs lead time ---
  const [leadStat, setLeadStat] = useState<StatKey>('median');
  // null = the original per-lead colour ramp; a number emphasises that lead and
  // drops the rest to context grey.
  const [emphasiseLead, setEmphasiseLead] = useState<number | null>(null);

  // Reuse the buckets the Metrics tab already built when they are current;
  // downloading forecasts clears them, so fall back to building our own.
  const leadBuckets = useMemo(() => {
    if (app.forecasts.size === 0) return null;
    return app.leadBuckets ?? reorganizeByLead(app.forecasts, MAX_LEAD);
  }, [app.leadBuckets, app.forecasts]);

  // Every lead with data gets a trace; the legend decides which are drawn.
  const leadSeries = useMemo<LeadSeries[]>(() => {
    if (!leadBuckets) return [];
    const out: LeadSeries[] = [];
    for (let lead = 0; lead <= MAX_LEAD; lead++) {
      const bucket = leadBuckets[lead];
      if (!bucket || bucket.time.length === 0) continue;
      out.push({ lead, series: statSeries(bucket, leadStat) });
    }
    return out;
  }, [leadBuckets, leadStat]);

  return (
    <div>
      <section style={section}>
        <h2 style={h2}>Forecast download</h2>
        {!app.riverId && <p>Pick a river_id on the Setup tab first.</p>}
        {app.riverId && !csvBounds && (
          <p style={{ maxWidth: PROSE_MAX, color: '#b91c1c' }}>
            Upload the event observations CSV on the Setup tab first — the event window defaults
            are derived from it.
          </p>
        )}
        {app.riverId && csvBounds && (
          <>
            <div
              style={{
                display: 'flex',
                gap: '1rem',
                flexWrap: 'wrap',
                alignItems: 'flex-end',
                marginBottom: '0.75rem',
              }}
            >
              <label style={dateLabel}>
                <span>Event start (UTC)</span>
                <input
                  type="date"
                  value={eventStartStr}
                  onChange={(e) => setStartOverride(e.target.value)}
                  style={dateInput}
                />
              </label>
              <label style={dateLabel}>
                <span>Event end (UTC)</span>
                <input
                  type="date"
                  value={eventEndStr}
                  onChange={(e) => setEndOverride(e.target.value)}
                  style={dateInput}
                />
              </label>
              <span style={{ fontSize: '0.85rem', color: '#666' }}>
                Max range: {MAX_EVENT_WINDOW_DAYS} days
              </span>
            </div>

            {validation.ok ? (
              <>
                <p style={{ maxWidth: PROSE_MAX, color: '#444', margin: '0 0 0.4rem' }}>
                  Event window: <code>{ymd(validation.eventStart)}</code> …{' '}
                  <code>{ymd(validation.eventEnd)}</code> ({validation.eventDays} day
                  {validation.eventDays === 1 ? '' : 's'}).
                </p>
                <p style={{ maxWidth: PROSE_MAX, color: '#555', margin: '0 0 0.75rem', fontSize: '0.9rem' }}>
                  Forecast init range (event start − {INIT_LOOKBACK_DAYS} days through event end):{' '}
                  <code>{forecastDates[0]}</code> …{' '}
                  <code>{forecastDates[forecastDates.length - 1]}</code> ({forecastDates.length}{' '}
                  init date{forecastDates.length === 1 ? '' : 's'}).
                </p>
              </>
            ) : (
              <p style={{ maxWidth: PROSE_MAX, color: '#b91c1c', margin: '0 0 0.5rem' }}>{validation.reason}</p>
            )}

            <button
              onClick={downloadAll}
              disabled={!validation.ok || !!app.forecastProgress}
              style={btn}
            >
              {app.forecastProgress
                ? `Downloading ${app.forecastProgress.done}/${app.forecastProgress.total}…`
                : app.forecasts.size > 0
                  ? 'Re-download forecasts'
                  : 'Download all forecasts'}
            </button>
            {app.forecasts.size > 0 && (
              <p style={{ maxWidth: PROSE_MAX, color: '#1a7f37', marginTop: '0.5rem' }}>
                {app.forecasts.size} forecast{app.forecasts.size === 1 ? '' : 's'} cached in memory.
              </p>
            )}
          </>
        )}
      </section>

      {app.forecasts.size > 0 && (
        <section style={section}>
          <h2 style={h2}>Forecast plot by start date</h2>
          <DateSlider
            sortedDates={[...app.forecasts.keys()].sort()}
            selected={app.selectedDate}
            onChange={(d) => {
              runPickedByUser.current = true;
              app.setSelectedDate(d);
            }}
          />
          {selected && app.simRp && (
            <>
              <Plot {...forecastFigure(selected, app.simRp, app.selectedDate!)} />
              <PlotNote>
                one initialization of the 51-member ensemble. The pale envelope is the full
                min–max spread and the darker band the 25th–75th percentile, so a wide envelope
                means the members disagree and the forecast is uncertain. Mean and median far
                apart indicates a skewed ensemble — usually a minority of members predicting a
                much larger peak. Height against the simulated return-period bands is the
                model's own severity signal for this initialization.
                <br />
                <br />
                Opens on a <strong>middle</strong> initialization rather than the newest one. Runs
                are fetched from {INIT_LOOKBACK_DAYS} days before the event through its last day,
                so the newest run is initialized on the event's final day and its whole horizon
                lies after it — that run shows no event at all. Drag the slider left toward the
                earliest runs to watch the forecast pick the event up, and right to watch it fall
                out of the horizon.
              </PlotNote>
            </>
          )}
        </section>
      )}

      {app.forecasts.size > 0 && (
        <section style={section}>
          <h2 style={h2}>Event vs forecast lead time</h2>
          {!app.eventData ? (
            <p style={{ maxWidth: PROSE_MAX, color: '#b91c1c', margin: 0 }}>
              Upload the event observations CSV on the Setup tab to compare against forecasts.
            </p>
          ) : (
            <>
              <p style={{ maxWidth: PROSE_MAX, color: '#555', fontSize: '0.9rem', margin: '0 0 0.75rem' }}>
                Each line holds lead time constant and walks forward through the event: every
                forecast start date contributes the timesteps that fall that far ahead of its own
                initialization. Short leads are blue, long leads red. Leads {' '}
                {DEFAULT_VISIBLE_LEADS.join(', ')} are drawn on load — click legend entries to
                show the rest or hide the observed series, and the y-axis rescales to what is
                left.
              </p>
              <label style={{ ...dateLabel, marginBottom: '0.75rem' }}>
                <span>Ensemble statistic</span>
                <select
                  value={leadStat}
                  onChange={(e) => setLeadStat(e.target.value as StatKey)}
                  style={{ ...dateInput, maxWidth: 220 }}
                >
                  {STAT_OPTIONS.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ marginLeft: '1rem' }}>
                Highlight:&nbsp;
                <select
                  value={emphasiseLead ?? ''}
                  onChange={(e) =>
                    setEmphasiseLead(e.target.value === '' ? null : Number(e.target.value))
                  }
                >
                  <option value="">All leads by colour</option>
                  {leadSeries.map(({ lead }) => (
                    <option key={lead} value={lead}>
                      Lead {lead} d only
                    </option>
                  ))}
                </select>
              </label>

              <Plot
                {...eventVsLeadFigure(app.eventData, leadSeries, {
                  statLabel: STAT_OPTIONS.find((s) => s.key === leadStat)!.label,
                  maxLead: MAX_LEAD,
                  obsRp: app.obsRp,
                  simRp: app.simRp,
                  // With one lead emphasised every lead is drawn, since the others
                  // are the context that makes the accent readable.
                  visibleLeads: emphasiseLead == null ? DEFAULT_VISIBLE_LEADS : undefined,
                  emphasiseLead,
                })}
              />
              <PlotNote>
                vertical distance from the black observed line is the forecast error at that lead
                time. If the blue (short-lead) lines hug the observations more closely than the
                red (long-lead) ones, skill degrades with lead time as expected; lines that stay
                bunched together mean lead time barely mattered for this event. A line that sits
                consistently above or below black is a bias at that lead, not a timing problem —
                a line with the right shape shifted sideways is the reverse.
                <br />
                <br />
                <strong>Highlight</strong> switches from sixteen coloured lines to one accent line
                against grey context. Use it when the question is about a particular lead: the
                accent is found instantly instead of traced through the others, and identity stops
                depending on hue, so the chart still works in greyscale or with colour-blindness.
              </PlotNote>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function DateSlider({
  sortedDates,
  selected,
  onChange,
}: {
  sortedDates: string[];
  selected: string | null;
  onChange: (d: string | null) => void;
}) {
  if (sortedDates.length === 0) return null;
  const idx = selected ? sortedDates.indexOf(selected) : -1;
  const safeIdx = idx >= 0 ? idx : sortedDates.length - 1;
  const fmt = (d: string) =>
    d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d;

  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#555' }}>
        <span>
          Start date:{' '}
          <strong style={{ color: '#111' }}>{fmt(sortedDates[safeIdx])}</strong>{' '}
          <span style={{ color: '#888' }}>
            ({safeIdx + 1} of {sortedDates.length})
          </span>
        </span>
        <span>
          <code>{fmt(sortedDates[0])}</code> … <code>{fmt(sortedDates[sortedDates.length - 1])}</code>
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={sortedDates.length - 1}
        step={1}
        value={safeIdx}
        onChange={(e) => onChange(sortedDates[Number(e.target.value)])}
        style={{ width: '100%', marginTop: '0.25rem' }}
      />
    </div>
  );
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
  /** Sized to its label, so a flex column's default `stretch` cannot widen it. */
  alignSelf: 'flex-start',
};
const dateLabel: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.2rem',
  fontSize: '0.9rem',
  color: '#444',
};
const dateInput: React.CSSProperties = {
  padding: '0.35rem 0.5rem',
  fontSize: '1rem',
  border: '1px solid #bbb',
  borderRadius: 4,
};
