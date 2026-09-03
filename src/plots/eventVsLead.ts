import type { Data, Layout } from 'plotly.js-dist-min';
import type { RpThresholds, TimeSeries } from '../lib/types';
import { leadColor, rpBandTraces, type RpBandGroup } from './helpers';

/** Accent and de-emphasis colours for the single-lead emphasis treatment. */
const EMPHASIS_ACCENT = '#eb6834';
const EMPHASIS_CONTEXT = '#d5d4cd';

/** One constant-lead-time forecast series, pooled across all start dates. */
export interface LeadSeries {
  lead: number;
  series: TimeSeries;
}

export interface EventVsLeadOptions {
  /** Human-readable name of the ensemble statistic plotted (e.g. "Ensemble median"). */
  statLabel: string;
  /** Largest lead day offered — fixes the color ramp endpoints. */
  maxLead: number;
  /**
   * Gumbel thresholds fitted to the uploaded historical observations — the set
   * to compare the observed trace against.
   */
  obsRp?: RpThresholds | null;
  /**
   * Gumbel thresholds fitted to the retrospective simulation — the set to
   * compare the forecast traces against, since forecasts share the model's
   * bias. Starts hidden behind a legend entry.
   */
  simRp?: RpThresholds | null;
  /**
   * Leads drawn on load. Every lead in `leadSeries` gets a legend entry either
   * way; the rest start collapsed to `legendonly` so 16 overlapping lines do
   * not arrive at once.
   */
  visibleLeads?: readonly number[];
  /**
   * Lead to draw in the accent colour, with every other lead dropped to a
   * recessive grey.
   *
   * The default treatment spends a distinct hue on all sixteen leads, which
   * forces the reader to carry a colour key while tracing one line through the
   * others. When the question is about ONE lead — and it usually is — emphasis
   * answers it faster: the accent line is found instantly and the rest read as
   * context rather than as competing series. It also takes identity off hue
   * entirely, so the chart survives colour-blindness and greyscale printing.
   *
   * Null keeps the original per-lead ramp.
   */
  emphasiseLead?: number | null;
  /**
   * Name for the heavy reference trace.
   *
   * Defaults to the uploaded event observations, which is what this chart was
   * built for. The flood check has no upload and uses the model's own
   * retrospective as its reference instead — that is a hindcast, not a
   * measurement, and calling it "Observed" would be a claim the data does not
   * support.
   */
  eventLabel?: string;
}

/**
 * Event observations against forecasts held at a constant lead time.
 *
 * Each lead trace is the notebook's `reorganize_forecasts_by_daily_lead` output
 * for one lead day: every start date contributes the timesteps that fall that
 * far ahead of its own initialization, so consecutive daily starts tile into a
 * continuous series on the real time axis. Comparing traces therefore shows how
 * the same event looks when forecast 1 day out versus 10 days out.
 *
 * Series visibility is the legend's job, so no axis range is set here — an
 * explicit range would freeze the y-scale and stop hidden traces from being
 * dropped from it, which matters when observed and forecast magnitudes differ.
 */
export function eventVsLeadFigure(
  event: TimeSeries,
  leadSeries: LeadSeries[],
  opts: EventVsLeadOptions,
): { data: Data[]; layout: Partial<Layout> } {
  // Full time extent of everything plotted, so the bands span the axis.
  let tMin = Number.POSITIVE_INFINITY;
  let tMax = Number.NEGATIVE_INFINITY;
  for (const s of [event, ...leadSeries.map((l) => l.series)]) {
    for (const t of s.time) {
      const ms = t.getTime();
      if (ms < tMin) tMin = ms;
      if (ms > tMax) tMax = ms;
    }
  }
  const haveRange = Number.isFinite(tMin) && Number.isFinite(tMax);

  // Bands first so they paint behind the series. Both provenances are offered
  // as separate, named legend entries — the observed thresholds belong with the
  // observed trace, the simulated ones with the forecasts.
  const bandGroups: RpBandGroup[] = [];
  if (opts.obsRp) bandGroups.push({ label: 'observed', rp: opts.obsRp });
  if (opts.simRp) bandGroups.push({ label: 'simulated', rp: opts.simRp, defaultVisible: false });

  const data: Data[] = haveRange
    ? rpBandTraces(bandGroups, new Date(tMin), new Date(tMax))
    : [];

  const eventLabel = opts.eventLabel ?? 'Observed (event)';
  data.push({
    type: 'scatter',
    mode: 'lines',
    name: eventLabel,
    x: event.time,
    y: event.values,
    line: { color: '#111', width: 3 },
    hovertemplate: `%{x|%Y-%m-%d %H:%M}<br>${eventLabel} %{y:.2f} m³/s<extra></extra>`,
  });

  const emphasis = opts.emphasiseLead ?? null;
  // Context traces first so the accent line is drawn over them, never under.
  const ordered =
    emphasis == null
      ? leadSeries
      : [...leadSeries].sort(
          (a, b) => Number(a.lead === emphasis) - Number(b.lead === emphasis),
        );

  for (const { lead, series } of ordered) {
    const sorted = sortByTime(series);
    const shown = !opts.visibleLeads || opts.visibleLeads.includes(lead);
    const isAccent = emphasis != null && lead === emphasis;
    data.push({
      type: 'scatter',
      mode: 'lines',
      name: `Lead ${lead} d`,
      x: sorted.time,
      y: sorted.values,
      line:
        emphasis == null
          ? { color: leadColor(lead, opts.maxLead), width: 1.6 }
          : isAccent
            ? { color: EMPHASIS_ACCENT, width: 2.6 }
            : { color: EMPHASIS_CONTEXT, width: 1 },
      opacity: emphasis == null || isAccent ? 1 : 0.85,
      visible: shown ? true : 'legendonly',
      // Only the accent line advertises itself in the hover; the context lines
      // still respond, so nothing becomes unreachable.
      hovertemplate:
        `<b>Lead ${lead} d${isAccent ? ' — emphasised' : ''}</b>` +
        `<br>%{x|%Y-%m-%d %H:%M}<br>%{y:.2f} m³/s<extra></extra>`,
    });
  }

  const layout: Partial<Layout> = {
    title: {
      text:
        'Event vs Forecast Lead Time' +
        `<br><sup>${opts.statLabel}, pooled across start dates by lead day` +
        (opts.emphasiseLead != null
          ? ` — lead ${opts.emphasiseLead} highlighted, other leads shown as context`
          : ' — click the legend to show or hide leads') +
        '</sup>',
      x: 0.5,
    },
    margin: { l: 60, r: 20, t: 60, b: 40 },
    xaxis: { title: { text: 'Valid time (UTC)' } },
    yaxis: { title: { text: 'Streamflow (m³/s)' }, rangemode: 'tozero' },
    legend: { orientation: 'h', y: -0.2 },
    plot_bgcolor: 'white',
    paper_bgcolor: 'white',
  };

  return { data, layout };
}

/**
 * Lead buckets are filled in start-date order, which is already ascending in
 * valid time for consecutive daily starts — but a gap or an out-of-order fetch
 * would otherwise draw a line that doubles back on itself.
 */
function sortByTime(s: TimeSeries): TimeSeries {
  let ordered = true;
  for (let i = 1; i < s.time.length; i++) {
    if (s.time[i].getTime() < s.time[i - 1].getTime()) {
      ordered = false;
      break;
    }
  }
  if (ordered) return s;
  const idx = s.time.map((_, i) => i);
  idx.sort((a, b) => s.time[a].getTime() - s.time[b].getTime());
  return { time: idx.map((i) => s.time[i]), values: idx.map((i) => s.values[i]) };
}
