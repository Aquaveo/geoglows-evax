import { useMemo, useState, type ReactNode } from 'react';
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
        initRange: string;
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
        initRange: dates.length > 0 ? `${pretty(dates[0])} to ${pretty(dates[dates.length - 1])}` : '',
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
  initRange,
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
  initRange: string;
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

  /**
   * The day the river actually reached each level, per the model's own
   * retrospective — the anchor the notice column is measured against.
   *
   * Anchoring to the reported flood dates was the defect: those dates are fuzzy
   * by design (that is what the tolerance is for), so on a one-day report every
   * offset in the table hung off a single guessed day. Each level's own
   * crossing day is a physically real reference, and it is the day a forecaster
   * would be judged against.
   *
   * Null where the retrospective never reached the level — then there is no
   * crossing to have given notice of, and the row says so rather than
   * measuring against something that did not happen.
   */
  const reachedDay = useMemo(() => {
    const lo = start.getTime() - (tol + 4) * DAY;
    const hi = end.getTime() + (tol + 4) * DAY;
    const out = new Map<number, Date>();
    for (const l of check.levels) {
      for (let i = 0; i < retro.time.length; i++) {
        const ms = retro.time[i]?.getTime();
        if (!Number.isFinite(ms) || ms < lo || ms > hi) continue;
        const v = retro.values[i];
        if (Number.isFinite(v) && v >= l.threshold) {
          out.set(l.level, retro.time[i]);
          break;
        }
      }
    }
    return out;
  }, [check.levels, retro, start, end, tol, DAY]);

  /** Days between the first majority forecast and the river reaching the level. */
  const noticeDays = (l: (typeof check.levels)[number]): number | null => {
    const reached = reachedDay.get(l.level);
    if (!reached || !l.majorityInit) return null;
    const issued = initDate(l.majorityInit);
    return issued ? Math.round((reached.getTime() - issued.getTime()) / DAY) : null;
  };

  const crossed = check.levels.filter((l) => l.everCrossed);
  const highest = crossed.slice(-1)[0] ?? null;
  const reachText = `reach ${riverId}`;

  return (
    <>
      <section style={sectionStyle}>
        <h2 style={h2}>What the forecasts said</h2>
        {(() => {
          // Crossing is monotone in threshold — a member above the 100-year is
          // above every level below it — so the levels with a majority are
          // always a contiguous run from the lowest, and "every level up to"
          // is safe to say.
          const maj = check.levels.filter((l) => l.majorityLeadDays != null);
          const topMaj = maj.at(-1);
          const lowMaj = maj[0];

          if (!highest) {
            return (
              <div style={{ ...verdictBox, borderColor: '#fca5a5', background: '#fef2f2' }}>
                <p style={{ margin: 0, fontSize: '1rem', lineHeight: 1.6 }}>
                  For <strong>{reachText}</strong> over <strong>{windowText}</strong>, no
                  ensemble member in any forecast went above even the 2-year level. On this
                  evidence RFS did not signal high water here.
                </p>
              </div>
            );
          }
          if (!topMaj || !lowMaj) {
            return (
              <div style={verdictBox}>
                <p style={{ margin: 0, fontSize: '1rem', lineHeight: 1.6 }}>
                  For <strong>{reachText}</strong> over <strong>{windowText}</strong>, no
                  forecast ever had more than half its members above even the 2-year level. The
                  highest any member reached was the <strong>{highest.level}-year</strong>, and
                  at most {highest.peakCrossed} of {highest.peakTotal} members in one forecast
                  got there — a handful of members, not the ensemble.
                </p>
              </div>
            );
          }
          return (
            <div style={verdictBox}>
              <p style={{ margin: 0, fontSize: '1rem', lineHeight: 1.6 }}>
                For <strong>{reachText}</strong> over <strong>{windowText}</strong>, more than
                half the ensemble crossed{' '}
                {topMaj.level === lowMaj.level ? (
                  <>the <strong>{topMaj.level}-year</strong> level</>
                ) : (
                  <>every level up to the <strong>{topMaj.level}-year</strong></>
                )}
                . The {lowMaj.level}-year call came{' '}
                <strong>{offsetText(lowMaj.majorityLeadDays!)}</strong>
                {topMaj.level !== lowMaj.level && (
                  <>, the {topMaj.level}-year <strong>{offsetText(topMaj.majorityLeadDays!)}</strong></>
                )}
                .
                {highest.level > topMaj.level && (
                  <>
                    {' '}Above the {topMaj.level}-year only single members crossed — at most{' '}
                    {highest.peakCrossed} of {highest.peakTotal}, reaching the{' '}
                    {highest.level}-year.
                  </>
                )}
              </p>
            </div>
          );
        })()}

        <table style={{ borderCollapse: 'collapse', fontSize: '0.9rem', marginTop: '1.25rem' }}>
          <thead>
            <tr>
              <Th sub="return period">Level</Th>
              <Th sub="the model's own" right>Threshold</Th>
              <Th sub="per the retrospective" right title="The day the model's own retrospective first put the river above this level. This is the anchor the Notice column is measured against — a real crossing day rather than the reported flood dates, which are fuzzy by design.">
                River reached it
              </Th>
              <Th sub="before the river got there" right title="Days between the day the river reached this level and the issue date of the first forecast in which more than half the members were above it. Blank when no forecast ever had a majority over the level — read the strength column instead.">
                Notice
              </Th>
              <Th sub="most in one forecast" right title="The largest number of members any single forecast put above this level, with the members that forecast had. Present whether or not a majority ever formed.">
                Strength
              </Th>
              <Th sub="of forecasts that had any" right title="How many forecasts had more than half their members over this level, out of the forecasts in which any member was over it. Shows whether the signal held or flickered.">
                Signalled
              </Th>
            </tr>
          </thead>
          <tbody>
            {check.levels.map((l) => {
              const reached = reachedDay.get(l.level);
              const notice = noticeDays(l);
              return (
                <tr key={l.level}>
                  <td style={td}>{l.level}-year</td>
                  <td style={{ ...td, textAlign: 'right' }}>{l.threshold.toFixed(0)} m³/s</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {reached ? (
                      ymd(reached)
                    ) : (
                      <span style={{ color: '#999' }} title="The retrospective never reached this level, so there was no crossing to forecast.">
                        never reached
                      </span>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {notice != null ? (
                      <strong>{notice > 0 ? `${notice} d before` : notice === 0 ? 'same day' : `${-notice} d after`}</strong>
                    ) : (
                      <span style={{ color: '#999' }}>
                        {l.majorityInit == null ? 'never over half' : '—'}
                      </span>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {l.peakCrossed != null && l.peakTotal != null && l.peakCrossed > 0 ? (
                      `${l.peakCrossed} of ${l.peakTotal}`
                    ) : (
                      <span style={{ color: '#999' }}>none</span>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {l.anyForecasts > 0 ? (
                      `${l.majorityForecasts} of ${l.anyForecasts}`
                    ) : (
                      <span style={{ color: '#999' }}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {(() => {
          // A worked example teaches every column at once and costs one
          // sentence. Per-column footnotes cost a paragraph and get skipped.
          const ex = [...check.levels].reverse().find((l) => noticeDays(l) != null) ??
            [...check.levels].reverse().find((l) => (l.peakCrossed ?? 0) > 0);
          if (!ex) return null;
          const n = noticeDays(ex);
          const reached = reachedDay.get(ex.level);
          return (
            <p style={{ ...note, marginTop: '0.6rem', maxWidth: PROSE_MAX }}>
              <strong>Reading a row:</strong> the river reached the {ex.level}-year level (
              {ex.threshold.toFixed(0)} m³/s){reached ? ` on ${ymd(reached)}` : ''}
              {n != null
                ? `, and the first forecast to put more than half its members over it was issued ${n} day${n === 1 ? '' : 's'} earlier`
                : ', and no forecast ever had more than half its members over it'}
              {ex.peakCrossed != null && ex.peakTotal != null
                ? `. The most any one forecast managed was ${ex.peakCrossed} of ${ex.peakTotal} members, and ${ex.majorityForecasts} of the ${ex.anyForecasts} forecasts that had any member over it had more than half.`
                : '.'}
            </p>
          );
        })()}

        <p style={{ ...note, marginTop: '0.5rem', maxWidth: PROSE_MAX }}>
          <strong>How these are counted:</strong> a member is &ldquo;above&rdquo; a level if it
          goes over that level at <em>any</em> timestep inside the flood window — the reported
          dates plus the tolerance — so one hour up there counts the same as three days. Notice
          is measured against the day the river itself reached that level, not against the dates
          you reported, so it does not depend on how long a window you gave. Where no forecast
          ever reached a majority, Notice is blank and <em>Strength</em> and{' '}
          <em>Signalled</em> carry the result instead: a level crossed by a third of the members
          in several separate forecasts is a real minority signal, not nothing. None of these
          are probabilities — they are counts of ensemble members, which are a spread, not a
          calibrated distribution.
        </p>

        {check.levels.some((l) => l.majorityInit == null && (l.peakCrossed ?? 0) > 0 && (l.peakCrossed ?? 0) <= 2) && (
          <p style={{ ...note, marginTop: '0.5rem', maxWidth: PROSE_MAX }}>
            A row showing one or two members is a single outlier, not a statement by the
            ensemble. On a wide spread one member can cross the 100-year level while the rest
            never leave normal flow.
          </p>
        )}

        <p style={{ ...prose, marginTop: '1rem' }}>
          All of this is a statement about the model, not about the flood. A miss can mean the
          model got the event wrong, or that the reported reach is not the one that flooded, or
          that the flooding came from something a river model does not carry — a levee, a dam
          release, rain falling faster than the ground could take it. The check tells you whether
          the signal was there; it does not tell you why it was not.
        </p>
        <table style={{ borderCollapse: 'collapse', fontSize: '0.9rem', marginTop: '1rem' }}>
          <tbody>
            {/*
              Two ranges, both named. One row labelled "Dates searched" used to
              show only the flood window, while the table cited forecasts issued
              before it — a contradiction the reader had no way to resolve.
            */}
            <Row
              label="Forecasts examined"
              value={
                `${check.runsUsed} of ${requested} dates` +
                (initRange ? `, issued ${initRange}` : '') +
                ` — ${check.memberForecasts} member forecasts`
              }
            />
            <Row
              label="Flood window searched"
              value={windowText + (tol > 0 ? `, widened to ${searched} by the ±${tol} d tolerance` : '')}
            />
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

/**
 * Header cell carrying its own definition on a second line.
 *
 * The sparse table only works if the headers say what the number is: one datum
 * per cell is scannable, but "Notice" and "Members" mean nothing on their own.
 * A second muted line costs no vertical space that a footnote paragraph would
 * not have cost, and it sits where the reader is already looking. `title` adds
 * the full definition on hover for anyone who wants it.
 */
function Th({
  children,
  sub,
  right,
  title,
}: {
  children: ReactNode;
  sub: string;
  right?: boolean;
  title?: string;
}) {
  return (
    <th style={{ ...th, textAlign: right ? 'right' : 'left', verticalAlign: 'bottom' }} title={title}>
      <div>{children}</div>
      <div style={{ fontWeight: 400, fontSize: '0.75rem', color: '#8a8880', marginTop: 1 }}>{sub}</div>
    </th>
  );
}

/**
 * Signed days relative to the flood's reported start, phrased so the sign is
 * unmissable.
 *
 * "8 d late" rather than "flood day 9": the same unit as the Notice column, so
 * the two are directly comparable, and no convention for numbering flood days
 * that the reader has to learn.
 */
/** YYYYMMDD -> Date, for the initialisation keys the grids are keyed by. */
function initDate(yyyymmdd: string): Date | null {
  return parseYmd(`${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`);
}

function offsetText(days: number): string {
  if (days > 0) return `${days} d ahead`;
  if (days === 0) return 'on the day';
  return `${-days} d late`;
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
