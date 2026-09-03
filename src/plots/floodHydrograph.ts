import type { Data, Layout } from 'plotly.js-dist-min';
import type { ForecastRun, RpThresholds } from '../lib/types';
import { medianSeries, crestOfRun } from '../lib/floodCheck';
import { rpBandTraces } from './helpers';

const SELECTED = '#1f77b4';
const CONTEXT = 'rgba(120, 118, 112, 0.30)';
const CREST = '#b45309';
const MUTED = '#898781';
const SURFACE = '#fcfcfb';

export interface FloodHydrographOptions {
  /** The run drawn in full, as YYYYMMDD. Others become context lines. */
  selectedInit: string;
  /** Reported event window, shaded. */
  eventStart: Date;
  eventEnd: Date;
  /** Days of slack either side of the window that still count as the event. */
  toleranceDays: number;
  /** The model's own retrospective, drawn as the answer key where it overlaps. */
  retro?: { time: Date[]; values: number[] } | null;
  subtitle?: string;
}

/**
 * The forecast hydrograph behind the exceedance grid.
 *
 * The grid says how much of the ensemble crossed each level; it cannot say when,
 * or by how much, or what the run's shape looked like. This does: the selected
 * run as a full spread against the return-period bands, every other run reduced
 * to a thin median line for context, and the reported event window shaded so the
 * reader can see whether the forecast crest lands inside it.
 *
 * The crest marker is on the MEDIAN, not the top member — same reason the
 * verdict table never quotes a level without its member share.
 */
export function floodHydrographFigure(
  forecasts: Map<string, ForecastRun>,
  simRp: RpThresholds,
  opts: FloodHydrographOptions,
): { data: Data[]; layout: Partial<Layout> } {
  const DAY = 86400000;
  const tol = opts.toleranceDays * DAY;
  const lo = opts.eventStart.getTime() - tol;
  const hi = opts.eventEnd.getTime() + DAY - 1 + tol;

  const selected = forecasts.get(opts.selectedInit);
  const keys = [...forecasts.keys()].sort();

  // Plot range: the selected run, widened to hold the shaded window.
  const times = selected?.time ?? [];
  const xMin = new Date(Math.min(times[0]?.getTime() ?? lo, lo));
  const xMax = new Date(Math.max(times.at(-1)?.getTime() ?? hi, hi));

  // Bands behind everything, as traces — plotly counts data-coordinate shapes in
  // autorange, so a band drawn as a shape would pin the y-axis at its own top.
  const data: Data[] = rpBandTraces([{ label: 'simulated', rp: simRp, defaultVisible: true }], xMin, xMax);

  // Context: every other run's median, thin and grey. Collapsing them to one
  // line each is what keeps 20-odd runs legible; their spread is in the grid.
  for (const k of keys) {
    if (k === opts.selectedInit) continue;
    const run = forecasts.get(k);
    if (!run) continue;
    const { time, median } = medianSeries(run);
    data.push({
      type: 'scatter',
      mode: 'lines',
      x: time,
      y: median,
      line: { color: CONTEXT, width: 1 },
      name: 'other runs (median)',
      legendgroup: 'context',
      showlegend: k === keys.find((x) => x !== opts.selectedInit),
      hoverinfo: 'skip',
    });
  }

  if (opts.retro && opts.retro.time.length > 0) {
    // The answer key: what the model itself later said happened. Only where it
    // overlaps the plotted range, so it cannot stretch the axis.
    const rx: Date[] = [];
    const ry: number[] = [];
    for (let i = 0; i < opts.retro.time.length; i++) {
      const ms = opts.retro.time[i]?.getTime();
      if (!Number.isFinite(ms) || ms < xMin.getTime() || ms > xMax.getTime()) continue;
      rx.push(opts.retro.time[i]);
      ry.push(opts.retro.values[i]);
    }
    if (rx.length > 0) {
      data.push({
        type: 'scatter',
        mode: 'lines',
        x: rx,
        y: ry,
        line: { color: '#111', width: 2, dash: 'dot' },
        name: 'retrospective (what the model says happened)',
        hovertemplate: '%{x|%Y-%m-%d}<br>retrospective %{y:.0f} m³/s<extra></extra>',
      });
    }
  }

  if (selected) {
    const { time, median } = medianSeries(selected);
    const rev = [...time].reverse();
    const per = (q: number) => percentileByStep(selected, q);

    data.push(
      {
        type: 'scatter',
        name: 'members min–max',
        x: [...time, ...rev],
        y: [...per(1), ...per(0).reverse()],
        fill: 'toself',
        fillcolor: 'rgba(31, 119, 180, 0.14)',
        line: { color: 'rgba(0,0,0,0)' },
        hoverinfo: 'skip',
      },
      {
        type: 'scatter',
        name: 'members 25–75%',
        x: [...time, ...rev],
        y: [...per(0.75), ...per(0.25).reverse()],
        fill: 'toself',
        fillcolor: 'rgba(31, 119, 180, 0.32)',
        line: { color: 'rgba(0,0,0,0)' },
        hoverinfo: 'skip',
      },
      {
        type: 'scatter',
        mode: 'lines',
        name: `run of ${pretty(opts.selectedInit)} (median)`,
        x: time,
        y: median,
        line: { color: SELECTED, width: 2.4 },
        hovertemplate: '%{x|%Y-%m-%d %H:%M}<br>median %{y:.0f} m³/s<extra></extra>',
      },
    );

    const crest = crestOfRun(selected, xMin.getTime(), xMax.getTime());
    if (crest) {
      data.push({
        type: 'scatter',
        mode: 'markers',
        x: [crest.time],
        y: [crest.value],
        marker: { color: CREST, size: 10, symbol: 'diamond', line: { color: '#fff', width: 1.5 } },
        name: 'forecast crest (median)',
        hovertemplate:
          `crest of this run<br>%{x|%Y-%m-%d %H:%M}<br>%{y:.0f} m³/s<extra></extra>`,
      });
    }
  }

  const shapes: NonNullable<Layout['shapes']> = [
    {
      type: 'rect',
      // yref 'paper', deliberately: a data-coordinate shape would join the
      // y-autorange and hold the axis open at whatever height it was given.
      xref: 'x',
      yref: 'paper',
      x0: opts.eventStart.toISOString(),
      x1: new Date(opts.eventEnd.getTime() + DAY).toISOString(),
      y0: 0,
      y1: 1,
      fillcolor: 'rgba(180, 83, 9, 0.10)',
      line: { width: 0 },
      layer: 'below',
    },
  ];
  if (opts.toleranceDays > 0) {
    for (const [a, b] of [
      [new Date(lo), opts.eventStart],
      [new Date(opts.eventEnd.getTime() + DAY), new Date(hi + 1)],
    ] as const) {
      shapes.push({
        type: 'rect',
        xref: 'x',
        yref: 'paper',
        x0: a.toISOString(),
        x1: b.toISOString(),
        y0: 0,
        y1: 1,
        fillcolor: 'rgba(180, 83, 9, 0.04)',
        line: { width: 0 },
        layer: 'below',
      });
    }
  }

  const annotations: NonNullable<Layout['annotations']> = [
    {
      xref: 'x',
      yref: 'paper',
      x: new Date((opts.eventStart.getTime() + opts.eventEnd.getTime() + DAY) / 2).toISOString(),
      y: 1.02,
      text: 'reported flood',
      showarrow: false,
      font: { size: 10, color: CREST },
    },
  ];

  const layout: Partial<Layout> = {
    title: {
      text: `Forecast hydrograph${opts.subtitle ? `<br><sup>${opts.subtitle}</sup>` : ''}`,
      x: 0.5,
    },
    margin: { l: 68, r: 24, t: opts.subtitle ? 70 : 56, b: 52 },
    xaxis: { title: { text: 'time (UTC)' }, range: [xMin.toISOString(), xMax.toISOString()], tickfont: { color: MUTED } },
    yaxis: { title: { text: 'discharge (m³/s)', standoff: 12 }, rangemode: 'tozero', tickfont: { color: MUTED } },
    shapes,
    annotations,
    height: 420,
    legend: { orientation: 'h', y: -0.18, font: { size: 10 } },
    hovermode: 'closest',
    plot_bgcolor: SURFACE,
    paper_bgcolor: SURFACE,
  };

  return { data, layout };
}

/** Per-timestep quantile across members; q=0 is min, q=1 is max. */
function percentileByStep(run: ForecastRun, q: number): number[] {
  const out = new Array<number>(run.time.length).fill(Number.NaN);
  const buf: number[] = [];
  for (let i = 0; i < run.time.length; i++) {
    buf.length = 0;
    for (let m = 0; m < run.discharge.length; m++) {
      const v = run.discharge[m]?.[i];
      if (Number.isFinite(v)) buf.push(v);
    }
    if (buf.length === 0) continue;
    buf.sort((a, b) => a - b);
    if (q <= 0) out[i] = buf[0];
    else if (q >= 1) out[i] = buf[buf.length - 1];
    else {
      // Linear interpolation between order statistics, matching numpy's default.
      const pos = q * (buf.length - 1);
      const base = Math.floor(pos);
      const frac = pos - base;
      out[i] = base + 1 < buf.length ? buf[base] + (buf[base + 1] - buf[base]) * frac : buf[base];
    }
  }
  return out;
}

function pretty(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}
