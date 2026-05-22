import { useEffect, useMemo } from 'react';
import { useApp } from '../state/AppContext';
import { fetchForecasts } from '../data/rfs';
import { dailyDateRange } from '../lib/leadBuckets';
import { Plot } from './Plot';
import { forecastFigure } from '../plots/forecasts';

const MAX_EVENT_WINDOW_DAYS = 31;
const DAY_MS = 24 * 3600 * 1000;

function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function ForecastTab() {
  const app = useApp();

  const validation = useMemo(() => {
    if (!app.eventStart || !app.eventEnd) {
      return { ok: false as const, reason: 'Set both start and end dates.' };
    }
    const start = parseYmd(app.eventStart);
    const end = parseYmd(app.eventEnd);
    if (end.getTime() < start.getTime()) {
      return { ok: false as const, reason: 'End date must be on or after start date.' };
    }
    const days = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
    if (days > MAX_EVENT_WINDOW_DAYS) {
      return { ok: false as const, reason: `Event window is ${days} days; max is ${MAX_EVENT_WINDOW_DAYS}.` };
    }
    return { ok: true as const, start, end, days };
  }, [app.eventStart, app.eventEnd]);

  const initDates = useMemo(() => {
    if (!validation.ok) return [];
    const fifteenBefore = new Date(validation.start.getTime() - 15 * DAY_MS);
    return dailyDateRange(fifteenBefore, validation.end);
  }, [validation]);

  // Default to most-recent fetched start date when forecasts arrive.
  useEffect(() => {
    if (!app.selectedInitDate && app.forecasts.size > 0) {
      const keys = [...app.forecasts.keys()].sort();
      app.setSelectedInitDate(keys[keys.length - 1]);
    }
  }, [app.forecasts, app.selectedInitDate, app]);

  async function downloadAll() {
    if (!app.riverId || !validation.ok) return;
    app.setForecastProgress({ done: 0, total: initDates.length });
    const m = await fetchForecasts(app.riverId, initDates, 4, (done, total) =>
      app.setForecastProgress({ done, total }),
    );
    app.setForecasts(m);
    app.setForecastProgress(null);
    app.setLeadBuckets(null); // invalidate downstream
    app.setKgeDistribution(null);
  }

  const selected = app.selectedInitDate ? app.forecasts.get(app.selectedInitDate) ?? null : null;

  return (
    <div>
      <section style={section}>
        <h2 style={h2}>Forecast download</h2>
        {!app.riverId && <p>Pick a river_id on the Setup tab first.</p>}
        {app.riverId && (
          <>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.75rem' }}>
              <label style={dateLabel}>
                <span>Event start (UTC)</span>
                <input
                  type="date"
                  value={app.eventStart ?? ''}
                  onChange={(e) => app.setEventStart(e.target.value || null)}
                  style={dateInput}
                />
              </label>
              <label style={dateLabel}>
                <span>Event end (UTC)</span>
                <input
                  type="date"
                  value={app.eventEnd ?? ''}
                  onChange={(e) => app.setEventEnd(e.target.value || null)}
                  style={dateInput}
                />
              </label>
              <span style={{ fontSize: '0.85rem', color: '#666' }}>
                Max range: {MAX_EVENT_WINDOW_DAYS} days
              </span>
            </div>

            {validation.ok ? (
              <p style={{ color: '#555', margin: '0 0 0.5rem' }}>
                Event window: <code>{validation.days}</code> day{validation.days === 1 ? '' : 's'}.{' '}
                Forecast start-date range: <code>{initDates[0]}</code> … <code>{initDates[initDates.length - 1]}</code>{' '}
                ({initDates.length} forecasts, including 15 days of lead-in before the event).
              </p>
            ) : (
              <p style={{ color: '#b91c1c', margin: '0 0 0.5rem' }}>{validation.reason}</p>
            )}

            <button onClick={downloadAll} disabled={!validation.ok || !!app.forecastProgress} style={btn}>
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
            selected={app.selectedInitDate}
            onChange={app.setSelectedInitDate}
          />
          {selected && app.simRp && (
            <Plot {...forecastFigure(selected, app.simRp, app.selectedInitDate!)} />
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
