import type { Data, Layout } from 'plotly.js-dist-min';
import type { RpThresholds, TimeSeries } from '../lib/types';
import { rpBandTraces, type RpBandGroup } from './helpers';

const DAY_MS = 24 * 3600 * 1000;

export interface EventVsRetrospectiveOptions {
  /** Gumbel thresholds fitted to the retrospective simulation. */
  simRp?: RpThresholds | null;
  /** Gumbel thresholds fitted to the uploaded historical observations. */
  obsRp?: RpThresholds | null;
  /** Days of retrospective context shown either side of the event. */
  padDays?: number;
}

/**
 * Uploaded event observations against the RFS retrospective simulation.
 *
 * The retrospective is *sliced* to the event window ± `padDays` rather than
 * plotted in full and clamped with an axis range. That matters for more than
 * tidiness: an explicit axis range would freeze the y-scale, so hiding a trace
 * from the legend — observed peaks and simulated peaks are often an order of
 * magnitude apart — would leave the hidden trace's scale behind. With only
 * in-window data present, Plotly's own autorange fits whatever is visible, and
 * legend toggles rescale correctly. The full record is on the retrospective
 * plot further down the tab.
 */
export function eventVsRetrospectiveFigure(
  retro: TimeSeries,
  event: TimeSeries,
  opts: EventVsRetrospectiveOptions = {},
): { data: Data[]; layout: Partial<Layout> } {
  const padDays = opts.padDays ?? 30;
  const hasEvent = event.time.length > 0;

  const winStart = hasEvent ? event.time[0].getTime() - padDays * DAY_MS : null;
  const winEnd = hasEvent
    ? event.time[event.time.length - 1].getTime() + padDays * DAY_MS
    : null;
  const retroWindow = sliceWindow(retro, winStart, winEnd);

  // Bands first so they paint behind the series.
  const bandExtent = extent([retroWindow, event]);
  const bandGroups: RpBandGroup[] = [];
  if (opts.simRp) bandGroups.push({ label: 'simulated', rp: opts.simRp });
  if (opts.obsRp) bandGroups.push({ label: 'observed', rp: opts.obsRp });

  const data: Data[] = bandExtent
    ? rpBandTraces(bandGroups, new Date(bandExtent.min), new Date(bandExtent.max))
    : [];

  data.push(
    {
      type: 'scatter',
      mode: 'lines',
      name: 'RFS retrospective (simulated, daily)',
      x: retroWindow.time,
      y: retroWindow.values,
      line: { color: '#1f77b4', width: 1.5 },
      hovertemplate: '%{x|%Y-%m-%d}<br>Simulated %{y:.2f} m³/s<extra></extra>',
    },
    {
      type: 'scatter',
      mode: 'lines',
      name: 'Event observations (uploaded)',
      x: event.time,
      y: event.values,
      line: { color: '#111', width: 2.5 },
      hovertemplate: '%{x|%Y-%m-%d %H:%M}<br>Observed %{y:.2f} m³/s<extra></extra>',
    },
  );

  const subtitle =
    retroWindow.time.length === 0
      ? 'No retrospective data in the event window — the records do not overlap'
      : `Retrospective shown for the event ± ${padDays} days; click the legend to hide a series`;

  const layout: Partial<Layout> = {
    title: { text: `Event vs Retrospective<br><sup>${subtitle}</sup>`, x: 0.5 },
    margin: { l: 60, r: 20, t: 60, b: 40 },
    xaxis: { title: { text: 'Date (UTC)' } },
    yaxis: { title: { text: 'Streamflow (m³/s)' }, rangemode: 'tozero' },
    legend: { orientation: 'h', y: -0.2 },
    plot_bgcolor: 'white',
    paper_bgcolor: 'white',
  };

  return { data, layout };
}

/** Points falling inside [start, end]; the whole series when unbounded. */
function sliceWindow(s: TimeSeries, start: number | null, end: number | null): TimeSeries {
  if (start == null || end == null) return s;
  const time: Date[] = [];
  const values: number[] = [];
  for (let i = 0; i < s.time.length; i++) {
    const ms = s.time[i].getTime();
    if (ms < start || ms > end) continue;
    time.push(s.time[i]);
    values.push(s.values[i]);
  }
  return { time, values };
}

function extent(series: TimeSeries[]): { min: number; max: number } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const s of series) {
    for (const t of s.time) {
      const ms = t.getTime();
      if (ms < min) min = ms;
      if (ms > max) max = ms;
    }
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}
