import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../state/AppContext';
import { fetchForecasts } from '../data/rfs';
import { dailyDateRange } from '../lib/leadBuckets';
import { Plot } from './Plot';
import { forecastFigure } from '../plots/forecasts';

const INIT_LOOKBACK_DAYS = 15;
const MAX_EVENT_WINDOW_DAYS = 31;
const DAY_MS = 24 * 3600 * 1000;

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

  // User-overridable event window. Defaults to the CSV's first/last day.
  const [eventStartStr, setEventStartStr] = useState<string>('');
  const [eventEndStr, setEventEndStr] = useState<string>('');
  useEffect(() => {
    if (csvBounds && !eventStartStr) setEventStartStr(ymd(csvBounds.start));
    if (csvBounds && !eventEndStr) setEventEndStr(ymd(csvBounds.end));
  }, [csvBounds, eventStartStr, eventEndStr]);

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

  // Default to most-recent fetched date when forecasts arrive.
  useEffect(() => {
    if (!app.selectedDate && app.forecasts.size > 0) {
      const keys = [...app.forecasts.keys()].sort();
      app.setSelectedDate(keys[keys.length - 1]);
    }
  }, [app.forecasts, app.selectedDate, app]);

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

  return (
    <div>
      <section style={section}>
        <h2 style={h2}>Forecast download</h2>
        {!app.riverId && <p>Pick a river_id on the Setup tab first.</p>}
        {app.riverId && !csvBounds && (
          <p style={{ color: '#b91c1c' }}>
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
                  onChange={(e) => setEventStartStr(e.target.value)}
                  style={dateInput}
                />
              </label>
              <label style={dateLabel}>
                <span>Event end (UTC)</span>
                <input
                  type="date"
                  value={eventEndStr}
                  onChange={(e) => setEventEndStr(e.target.value)}
                  style={dateInput}
                />
              </label>
              <span style={{ fontSize: '0.85rem', color: '#666' }}>
                Max range: {MAX_EVENT_WINDOW_DAYS} days
              </span>
            </div>

            {validation.ok ? (
              <>
                <p style={{ color: '#444', margin: '0 0 0.4rem' }}>
                  Event window: <code>{ymd(validation.eventStart)}</code> …{' '}
                  <code>{ymd(validation.eventEnd)}</code> ({validation.eventDays} day
                  {validation.eventDays === 1 ? '' : 's'}).
                </p>
                <p style={{ color: '#555', margin: '0 0 0.75rem', fontSize: '0.9rem' }}>
                  Forecast init range (event start − {INIT_LOOKBACK_DAYS} days through event end):{' '}
                  <code>{forecastDates[0]}</code> …{' '}
                  <code>{forecastDates[forecastDates.length - 1]}</code> ({forecastDates.length}{' '}
                  init date{forecastDates.length === 1 ? '' : 's'}).
                </p>
              </>
            ) : (
              <p style={{ color: '#b91c1c', margin: '0 0 0.5rem' }}>{validation.reason}</p>
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
              <p style={{ color: '#1a7f37', marginTop: '0.5rem' }}>
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
            onChange={app.setSelectedDate}
          />
          {selected && app.simRp && (
            <Plot {...forecastFigure(selected, app.simRp, app.selectedDate!)} />
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
