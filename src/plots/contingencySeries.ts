import type { Data, Layout } from 'plotly.js-dist-min';
import type { ContingencyResult } from '../lib/metrics/contingency';
import type { RpThresholds } from '../lib/types';
import { RP_LEVELS } from '../lib/types';
import { rpBandTraces, type RpBandGroup } from './helpers';

export interface ContingencySeriesOptions {
  /** Observed-side thresholds — what the observations are classified against. */
  obsRp: RpThresholds;
  /** Simulated-side thresholds — what the forecast is classified against. */
  simRp: RpThresholds;
  /** Highest category in play for this event. */
  eventRp: number;
  /** Lead day and series name, for the title. */
  leadLabel?: string;
}

/**
 * The two series the contingency matrix was actually built from, with every
 * disagreeing timestep marked.
 *
 * The matrix says how many timesteps fell in the wrong category; this says
 * which ones and by how much. Both threshold sets are drawn because the
 * classification is dual-threshold: observations are cut against the observed
 * return periods and the forecast against the simulated ones, so a timestep can
 * be counted as a miss even where the two lines nearly touch — that only makes
 * sense once you can see both sets of cut points.
 */
export function contingencySeriesFigure(
  r: ContingencyResult,
  opts: ContingencySeriesOptions,
): { data: Data[]; layout: Partial<Layout> } {
  const d = r.detail;

  // Split the disagreements by direction so the colours match the table.
  const overT: Date[] = [];
  const overY: number[] = [];
  const overText: string[] = [];
  const underT: Date[] = [];
  const underY: number[] = [];
  const underText: string[] = [];

  const catName = (c: number) => (c === 0 ? '<2yr' : `${c}yr`);

  for (let i = 0; i < d.time.length; i++) {
    const oc = d.obsCat[i];
    const fc = d.fcstCat[i];
    if (fc === oc) continue;
    const label = `forecast ${catName(fc)} vs observed ${catName(oc)}`;
    if (fc > oc) {
      overT.push(d.time[i]);
      overY.push(d.fcst[i]);
      overText.push(label);
    } else {
      underT.push(d.time[i]);
      underY.push(d.fcst[i]);
      underText.push(label);
    }
  }

  // Return-period zones as filled colour bands, drawn first so they sit behind
  // the series. Each provenance is one legend entry, so a click shows or hides
  // the whole set — the reader can flip between "what classified the
  // observations" and "what classified the forecast" instead of trying to trace
  // two families of dashed lines.
  //
  // Only levels at or below the event's own return period are drawn, because
  // classification is capped there: a 100-year band on a 25-year event would
  // suggest a category that cannot occur in this matrix.
  const inPlay = (rp: RpThresholds): RpThresholds => {
    const out: RpThresholds = {};
    for (const level of RP_LEVELS) {
      if (level <= opts.eventRp && Number.isFinite(rp[level])) out[level] = rp[level];
    }
    return out;
  };

  const bandGroups: RpBandGroup[] = [];
  const obsInPlay = inPlay(opts.obsRp);
  const simInPlay = inPlay(opts.simRp);
  if (Object.keys(obsInPlay).length > 0) {
    bandGroups.push({ label: 'observed', rp: obsInPlay });
  }
  if (Object.keys(simInPlay).length > 0) {
    // Starts hidden: two overlapping band sets at once are unreadable. Toggling
    // it on is how you see the forecast's own cut points.
    bandGroups.push({ label: 'simulated', rp: simInPlay, defaultVisible: false });
  }

  const xSpan =
    d.time.length > 0
      ? { lo: d.time[0], hi: d.time[d.time.length - 1] }
      : { lo: new Date(), hi: new Date() };

  const data: Data[] = bandGroups.length > 0 ? rpBandTraces(bandGroups, xSpan.lo, xSpan.hi) : [];

  data.push(
    {
      type: 'scatter',
      mode: 'lines+markers',
      x: d.time,
      y: d.obs,
      name: 'Observed',
      line: { color: '#111', width: 2.5 },
      marker: { size: 4, color: '#111' },
      hovertemplate: '%{x|%Y-%m-%d %H:%M}<br>Observed %{y:.2f} m³/s<extra></extra>',
    },
    {
      type: 'scatter',
      mode: 'lines+markers',
      x: d.time,
      y: d.fcst,
      name: 'Forecast',
      line: { color: '#1f77b4', width: 2 },
      marker: { size: 4, color: '#1f77b4' },
      hovertemplate: '%{x|%Y-%m-%d %H:%M}<br>Forecast %{y:.2f} m³/s<extra></extra>',
    },
  );

  if (overT.length > 0) {
    data.push({
      type: 'scatter',
      mode: 'markers',
      x: overT,
      y: overY,
      name: `Over-forecast (${overT.length})`,
      marker: { size: 11, color: 'rgba(255, 165, 0, 0.95)', symbol: 'triangle-up',
        line: { width: 1, color: '#92400e' } },
      text: overText,
      hovertemplate: '%{x|%Y-%m-%d %H:%M}<br>%{text}<extra></extra>',
    });
  }
  if (underT.length > 0) {
    data.push({
      type: 'scatter',
      mode: 'markers',
      x: underT,
      y: underY,
      name: `Under-forecast (${underT.length})`,
      marker: { size: 11, color: 'rgba(214, 39, 40, 0.95)', symbol: 'triangle-down',
        line: { width: 1, color: '#7f1d1d' } },
      text: underText,
      hovertemplate: '%{x|%Y-%m-%d %H:%M}<br>%{text}<extra></extra>',
    });
  }

  const agree = r.hits;
  const title =
    `Observed vs forecast${opts.leadLabel ? ` — ${opts.leadLabel}` : ''}` +
    `<br><sup>${agree} of ${r.n} timesteps in the correct category` +
    `  |  ${overT.length} over-forecast, ${underT.length} under-forecast</sup>`;

  const layout: Partial<Layout> = {
    title: { text: title, x: 0.5, font: { size: 14 } },
    margin: { l: 60, r: 20, t: 55, b: 45 },
    xaxis: { title: { text: 'Time (UTC)' } },
    yaxis: { title: { text: 'Discharge (m³/s)' }, rangemode: 'tozero' },
    legend: { orientation: 'h', y: -0.22 },
    hovermode: 'closest',
    plot_bgcolor: 'white',
    paper_bgcolor: 'white',
  };

  return { data, layout };
}
