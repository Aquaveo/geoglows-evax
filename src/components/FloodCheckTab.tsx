import { useMemo, useState } from 'react';
import { PROSE_MAX } from '../prose';
import { getAndCacheRetrospective, fetchForecasts } from '../data/rfs';
import { returnPeriodsFromSeries } from '../lib/gumbel';
import { dailyDateRange } from '../lib/leadBuckets';
import { floodCheck, crestOfRun, levelOf, type FloodCheckResult } from '../lib/floodCheck';
import { Plot } from './Plot';
import { PlotNote } from './PlotNote';
import { exceedanceGridFigure } from '../plots/exceedanceGrid';
import { floodHydrographFigure } from '../plots/floodHydrograph';
import type { ForecastRun, RpThresholds } from '../lib/types';

/**
 * First initialisation date the forecast archive serves.
 *
 * Binary-searched against the API, not read from documentation: 2024-06-23 and
 * 2024-06-29 both return nothing, 2024-07-01 returns a full run.
 */
const ARCHIVE_START = '2024-07-01';
const MAX_LEAD = 15;
const DAY_MS = 24 * 3600 * 1000;
/** Longest reported window worth accepting; beyond this it is a season, not an event. */
const MAX_WINDOW_DAYS = 10;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function parseYmd(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) ? new Date(t) : null;
}
function pretty(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

export function FloodCheckTab() {
  const [reachInput, setReachInput] = useState('');
  const [startInput, setStartInput] = useState('');
  const [endInput, setEndInput] = useState('');
  const [tolerance, setTolerance] = useState(2);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<
    | {
        check: FloodCheckResult;
        riverId: number;
        start: Date;
        end: Date;
        tol: number;
        simRp: RpThresholds;
        requested: number;
        forecasts: Map<string, ForecastRun>;
        retro: { time: Date[]; values: number[] };
      }
    | null
  >(null);

  async function run() {
    setError(null);
    const riverId = Number(reachInput);
    if (!Number.isInteger(riverId) || riverId < 1e8 || riverId > 1e9 - 1) {
      setError('river_id must be a 9-digit integer.');
      return;
    }
    const start = parseYmd(startInput);
    const end = endInput ? parseYmd(endInput) : start;
    if (!start || !end) {
      setError('Enter the flood date as YYYY-MM-DD.');
      return;
    }
    if (end.getTime() < start.getTime()) {
      setError('The end of the window is before its start.');
      return;
    }
    const windowDays = (end.getTime() - start.getTime()) / DAY_MS + 1;
    if (windowDays > MAX_WINDOW_DAYS) {
      setError(
        `That window is ${Math.round(windowDays)} days. This check is for a single event — ` +
          `keep it to ${MAX_WINDOW_DAYS} days or fewer.`,
      );
      return;
    }
    const archiveStart = parseYmd(ARCHIVE_START)!;
    if (end.getTime() < archiveStart.getTime()) {
      setError(`The forecast archive starts ${ARCHIVE_START}. Nothing is stored for that date.`);
      return;
    }
    if (start.getTime() > Date.now()) {
      setError('That date is in the future.');
      return;
    }

    // Look back far enough to include the run that saw the event at the longest
    // lead, and forward through the tolerance so a late-reported flood is still
    // covered by a run issued inside its own window.
    const fetchFrom = new Date(
      Math.max(
        archiveStart.getTime(),
        start.getTime() - (tolerance + MAX_LEAD) * DAY_MS,
      ),
    );
    const fetchTo = new Date(Math.min(Date.now(), end.getTime() + tolerance * DAY_MS));
    const dates = dailyDateRange(fetchFrom, fetchTo);

    setProgress({ done: 0, total: dates.length });
    try {
      const retro = await getAndCacheRetrospective(riverId, 'daily');
      const retroSeries = {
        time: retro.time.map((t: string | Date) => new Date(t)),
        values: retro.discharge as number[],
      };
      // The same fit the Setup tab uses — Gumbel-I on the daily retrospective
      // with negatives clamped to 0 — so a level here means what it means there.
      const simRp = returnPeriodsFromSeries({
        time: retroSeries.time,
        values: retroSeries.values.map((v) => (Number.isFinite(v) && v < 0 ? 0 : v)),
      });
      const forecasts = await fetchForecasts(riverId, dates, 4, (done, total) =>
        setProgress({ done, total }),
      );
      if (forecasts.size === 0) {
        setError('No forecasts came back for those dates.');
        setResult(null);
        return;
      }
      const check = floodCheck(forecasts, simRp, {
        eventStart: start,
        eventEnd: end,
        toleranceDays: tolerance,
        maxLead: MAX_LEAD,
      });
      setResult({
        check,
        riverId,
        start,
        end,
        tol: tolerance,
        simRp,
        requested: dates.length,
        forecasts,
        retro: retroSeries,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setProgress(null);
    }
  }

  return (
    <div>
      <section style={sectionStyle}>
        <h2 style={h2}>Did the model see this flood?</h2>
        <p style={prose}>
          Enter a reach and the dates someone reported flooding there. The check pulls every
          forecast issued in the two weeks before the event and asks a single question of each
          one: how many of its 51 ensemble members went above the river's 2-, 5-, 10-, 25-, 50-
          and 100-year levels while the flood was happening.
        </p>
        <p style={prose}>
          The answer is a description, not a score. There is no member fraction that makes a
          flood "captured" and none that makes it missed, so the check does not pick one — it
          shows what the ensemble said and leaves the reading to you. The thresholds are the
          model's own simulated return periods, so a reach where RFS runs consistently low is
          still judged against what RFS itself calls a large flow there.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2}>The event</h2>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={field}>
            <span style={fieldLabel}>River ID</span>
            <input
              value={reachInput}
              onChange={(e) => setReachInput(e.target.value)}
              placeholder="9-digit river_id"
              style={input}
            />
          </label>
          <label style={field}>
            <span style={fieldLabel}>Flood date</span>
            <input
              type="date"
              value={startInput}
              min={ARCHIVE_START}
              max={ymd(new Date())}
              onChange={(e) => setStartInput(e.target.value)}
              style={input}
            />
          </label>
          <label style={field}>
            <span style={fieldLabel}>Through (optional)</span>
            <input
              type="date"
              value={endInput}
              min={startInput || ARCHIVE_START}
              max={ymd(new Date())}
              onChange={(e) => setEndInput(e.target.value)}
              style={input}
            />
          </label>
          <label style={field}>
            <span style={fieldLabel}>Allow for</span>
            <select
              value={tolerance}
              onChange={(e) => setTolerance(Number(e.target.value))}
              style={input}
            >
              <option value={0}>exact dates</option>
              <option value={1}>±1 day</option>
              <option value={2}>±2 days</option>
              <option value={3}>±3 days</option>
            </select>
          </label>
          <button onClick={run} disabled={progress != null} style={btn}>
            {progress ? 'Working…' : 'Run check'}
          </button>
        </div>
        <p style={{ ...note, marginTop: '0.75rem', maxWidth: PROSE_MAX }}>
          The flood date is the day the water was up. Most people report the day they noticed it
          rather than the hour of the crest, so the tolerance widens the window either side
          before anything is counted. The forecast archive starts {ARCHIVE_START}; events before
          then cannot be checked, and an event in the first fortnight of July 2024 has fewer
          initialisations behind it than a later one.
        </p>
        {progress && (
          <p style={note}>
            Downloading forecasts… {progress.done} / {progress.total}
          </p>
        )}
        {error && (
          <p style={{ color: '#b91c1c', marginTop: '0.75rem', maxWidth: PROSE_MAX }}>{error}</p>
        )}
      </section>

      {result && <FloodCheckResultView {...result} />}
    </div>
  );
}

function FloodCheckResultView({
  check,
  riverId,
  start,
  end,
  tol,
  requested,
  simRp,
  forecasts,
  retro,
}: {
  check: FloodCheckResult;
  riverId: number;
  start: Date;
  end: Date;
  tol: number;
  simRp: RpThresholds;
  requested: number;
  forecasts: Map<string, ForecastRun>;
  retro: { time: Date[]; values: number[] };
}) {
  const windowText =
    ymd(start) === ymd(end) ? ymd(start) : `${ymd(start)} to ${ymd(end)}`;
  const searched =
    tol > 0
      ? `${ymd(new Date(start.getTime() - tol * DAY_MS))} to ${ymd(
          new Date(end.getTime() + tol * DAY_MS),
        )}`
      : windowText;

  const DAY = DAY_MS;
  const initKeys = useMemo(() => [...forecasts.keys()].sort(), [forecasts]);

  // The last forecast issued before the flood window opens — the most informed
  // run a person would actually have had in hand. Falls back to the final run
  // when every initialisation is already inside the window.
  const defaultInit = useMemo(() => {
    const before = initKeys.filter((k) => {
      const t = parseYmd(`${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`);
      return t != null && t.getTime() < start.getTime();
    });
    return before.at(-1) ?? initKeys.at(-1) ?? '';
  }, [initKeys, start]);
  const [selectedInit, setSelectedInit] = useState<string | null>(null);
  const activeInit = selectedInit && forecasts.has(selectedInit) ? selectedInit : defaultInit;

  // What the model's own retrospective did near the event — the answer key the
  // forecasts are being judged against.
  const retroPeak = useMemo(() => {
    const lo = start.getTime() - (tol + 4) * DAY;
    const hi = end.getTime() + (tol + 4) * DAY;
    let best = Number.NEGATIVE_INFINITY;
    let at: Date | null = null;
    for (let i = 0; i < retro.time.length; i++) {
      const ms = retro.time[i]?.getTime();
      if (!Number.isFinite(ms) || ms < lo || ms > hi) continue;
      const v = retro.values[i];
      if (Number.isFinite(v) && v > best) { best = v; at = retro.time[i]; }
    }
    return at ? { time: at, value: best, level: levelOf(best, simRp) } : null;
  }, [retro, start, end, tol, simRp, DAY]);

  // Where the selected run put the crest.
  const runCrest = useMemo(() => {
    const run = forecasts.get(activeInit);
    if (!run) return null;
    const lo = start.getTime() - (tol + 4) * DAY;
    const hi = end.getTime() + (tol + 4) * DAY;
    return crestOfRun(run, lo, hi);
  }, [forecasts, activeInit, start, end, tol, DAY]);

  const crossed = check.levels.filter((l) => l.everCrossed);
  const highest = crossed.slice(-1)[0] ?? null;
  const reachText = `reach ${riverId}`;

  return (
    <>
      <section style={sectionStyle}>
        <h2 style={h2}>What the forecasts said</h2>
        {highest ? (
          <div style={verdictBox}>
            <p style={{ margin: 0, fontSize: '1rem', lineHeight: 1.6 }}>
              For <strong>{reachText}</strong> over <strong>{windowText}</strong>, members went
              above every level up to the <strong>{highest.level}-year</strong>. How much of the
              ensemble that took, and how far ahead it happened, differs level by level:
            </p>
          </div>
        ) : (
          <div style={{ ...verdictBox, borderColor: '#fca5a5', background: '#fef2f2' }}>
            <p style={{ margin: 0, fontSize: '1rem', lineHeight: 1.6 }}>
              For <strong>{reachText}</strong> over <strong>{windowText}</strong>, no ensemble
              member in any forecast went above even the 2-year level. On this evidence RFS did
              not signal high water here.
            </p>
          </div>
        )}

        <table style={{ borderCollapse: 'collapse', fontSize: '0.9rem', marginTop: '1.25rem' }}>
          <thead>
            <tr>
              <th style={th}>Level</th>
              <th style={{ ...th, textAlign: 'right' }}>Threshold</th>
              <th style={{ ...th, textAlign: 'right' }}>Most of the ensemble, in one forecast</th>
              <th style={{ ...th, textAlign: 'right' }}>Longest lead any member crossed</th>
            </tr>
          </thead>
          <tbody>
            {check.levels.map((l) => (
              <tr key={l.level}>
                <td style={td}>{l.level}-year</td>
                <td style={{ ...td, textAlign: 'right' }}>{l.threshold.toFixed(0)} m³/s</td>
                <td style={{ ...td, textAlign: 'right' }}>
                  {l.everCrossed ? (
                    <>
                      {Math.round(l.peakShare * 100)}%
                      {l.peakShareInit && (
                        <span style={{ color: '#777' }}> ({pretty(l.peakShareInit)})</span>
                      )}
                    </>
                  ) : (
                    <span style={{ color: '#999' }}>none</span>
                  )}
                </td>
                <td style={{ ...td, textAlign: 'right' }}>
                  {l.maxLead != null ? (
                    <>
                      {l.maxLead} d
                      {l.maxLeadInit && (
                        <span style={{ color: '#777' }}> ({pretty(l.maxLeadInit)})</span>
                      )}
                    </>
                  ) : (
                    <span style={{ color: '#999' }}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ ...note, marginTop: '0.6rem', maxWidth: PROSE_MAX }}>
          Read the last two columns together. A level one member touched once is not a level the
          ensemble called, and the lead column saturates on exactly that kind of member — on a
          wide ensemble a single outlier can cross the 100-year level a fortnight out while the
          rest of the members never leave normal flow.
        </p>

        <p style={{ ...prose, marginTop: '1rem' }}>
          All of this is a statement about the model, not about the flood. A miss can mean the
          model got the event wrong, or that the reported reach is not the one that flooded, or
          that the flooding came from something a river model does not carry — a levee, a dam
          release, rain falling faster than the ground could take it. The check tells you whether
          the signal was there; it does not tell you why it was not.
        </p>
        <table style={{ borderCollapse: 'collapse', fontSize: '0.9rem', marginTop: '1rem' }}>
          <tbody>
            <Row label="Forecasts with data in the window" value={`${check.runsUsed} of ${requested} requested`} />
            <Row label="Member forecasts examined" value={String(check.memberForecasts)} />
            <Row label="Dates searched" value={searched} />
            <Row
              label="Peak day, model's own retrospective"
              value={
                retroPeak
                  ? `${ymd(retroPeak.time)} — ${retroPeak.value.toFixed(0)} m³/s` +
                    (retroPeak.level ? ` (${retroPeak.level}-year level)` : ' (below the 2-year level)')
                  : 'no retrospective data in the window'
              }
            />
            <Row
              label="Peak day, largest single member"
              value={
                check.peakForecastTime && Number.isFinite(check.peakForecast)
                  ? `${ymd(check.peakForecastTime)} — ${check.peakForecast.toFixed(0)} m³/s` +
                    (check.peakForecastInit ? ` (run of ${pretty(check.peakForecastInit)})` : '')
                  : '—'
              }
            />
          </tbody>
        </table>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2}>The forecast hydrograph</h2>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '0.85rem', color: '#555' }}>
            Forecast issued{' '}
            <select
              value={activeInit}
              onChange={(e) => setSelectedInit(e.target.value)}
              style={{ padding: '0.3rem 0.4rem', fontSize: '0.9rem' }}
            >
              {initKeys.map((k) => (
                <option key={k} value={k}>
                  {pretty(k)}
                  {k === defaultInit ? ' — last before the flood' : ''}
                </option>
              ))}
            </select>
          </label>
          {runCrest && (
            <span style={{ fontSize: '0.85rem', color: '#555' }}>
              This run crests <strong>{ymd(runCrest.time)}</strong> at{' '}
              <strong>{runCrest.value.toFixed(0)} m³/s</strong>
              {(() => {
                const l = levelOf(runCrest.value, simRp);
                return l ? ` (${l}-year level)` : ' (below the 2-year level)';
              })()}
            </span>
          )}
        </div>
        <Plot {...floodHydrographFigure(forecasts, simRp, {
          selectedInit: activeInit,
          eventStart: start,
          eventEnd: end,
          toleranceDays: tol,
          retro,
          subtitle: `${reachText} — reported flood ${windowText}${tol > 0 ? `, ±${tol} d` : ''}`,
        })} />
        <PlotNote>
          The shaded band is the flood you reported, with the tolerance either side in a
          lighter tone. The blue spread is the chosen run's 51 members and the diamond is where
          its median crests — compare that against the dotted retrospective, which is what the
          model itself later said happened. Grey lines are every other run reduced to its
          median, so you can see whether successive forecasts converged on the same crest day or
          kept moving it. A crest that sits outside the shaded band is a timing error even when
          the exceedance grid is solid.
        </PlotNote>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2}>By the date the forecast was issued</h2>
        <Plot {...exceedanceGridFigure(check.byInitialisation, {
          title: 'Members crossing each level, by initialisation',
          subtitle: `${reachText} — event ${windowText}${tol > 0 ? `, ±${tol} d` : ''}`,
          columnLabel: 'forecast issued (UTC)',
          columnNoun: 'issued',
          // 20260113 -> 2026-01-13. Readable, and it keeps the axis labels out
          // of the numeric-coercion trap described in exceedanceGrid.
          formatColumn: pretty,
        })} />
        <PlotNote>
          Each column is one day's forecast, and the colour is how much of its ensemble went
          above that row's level at some point during the event. Reading left to right is
          watching the model make up its mind: colour appearing early and staying means the
          signal was there days out, colour that only appears in the last few columns means the
          model saw it late, and colour that comes and goes means successive runs disagreed.
        </PlotNote>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2}>By lead day</h2>
        <Plot {...exceedanceGridFigure(check.byLead, {
          title: 'Members crossing each level, by lead day',
          subtitle: 'all initialisations pooled',
          columnLabel: 'lead day',
          columnNoun: 'lead day',
        })} />
        <PlotNote>
          The same crossings sorted by how far ahead they were, with every forecast pooled.
          Colour fading to the right is the ordinary result — the further out, the fewer members
          commit. How far right the colour reaches is the warning time this reach got.
        </PlotNote>
      </section>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td style={{ padding: '3px 12px 3px 0', color: '#555' }}>{label}</td>
      <td style={{ padding: '3px 0' }}>{value}</td>
    </tr>
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
const prose: React.CSSProperties = { maxWidth: PROSE_MAX, lineHeight: 1.65 };
const note: React.CSSProperties = { color: '#555', fontSize: '0.9rem', margin: '0 0 0.5rem' };
const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.25rem' };
const fieldLabel: React.CSSProperties = { fontSize: '0.8rem', color: '#555' };
const input: React.CSSProperties = { padding: '0.4rem 0.6rem', fontSize: '0.95rem' };
const btn: React.CSSProperties = {
  padding: '0.45rem 0.9rem',
  fontSize: '1rem',
  cursor: 'pointer',
};
const th: React.CSSProperties = {
  textAlign: 'left',
  borderBottom: '1px solid #ccc',
  padding: '4px 12px 4px 0',
  fontWeight: 600,
};
const td: React.CSSProperties = { borderBottom: '1px solid #eee', padding: '4px 12px 4px 0' };
const verdictBox: React.CSSProperties = {
  maxWidth: PROSE_MAX,
  padding: '0.9rem 1.1rem',
  border: '1px solid #bfdbfe',
  background: '#eff6ff',
  borderRadius: 6,
  color: '#1e3a5f',
};
