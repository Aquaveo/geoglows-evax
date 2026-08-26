import type { Data, Layout } from 'plotly.js-dist-min';
import type { CsiByLead } from '../lib/metrics/csiByLead';

const EMPHASIS = '#1baf7a';
const CONTEXT = '#cdccc4';
const CONTEXT_LABEL = '#9d9b93';
const MUTED = '#898781';
const GRID = '#e1e0d9';
const THIN = '#e34948';

/** Below this many distinct observed exceedances, a lead's CSI is not readable. */
export const MIN_EVENT_STEPS = 3;

export interface CsiByLeadOptions {
  title?: string;
  /** Which threshold category to emphasise. Others are drawn as faint context. */
  selected: number;
  riverId?: number;
}

/**
 * CSI against lead day, one threshold emphasised and the rest as context.
 *
 * Every line here is the same KIND of quantity — a 2x2 CSI at some exceedance
 * level — so sharing an axis is legitimate, which is exactly what was wrong
 * about CSI sitting beside the multi-category MCC and HSS. Drawing the
 * unselected thresholds faintly rather than hiding them answers the question the
 * selector otherwise invites ("what do the others look like?") without asking
 * the reader to click through them one at a time.
 *
 * Leads whose distinct observed exceedance count falls under MIN_EVENT_STEPS are
 * marked hollow and red. On a single event that is most of the high thresholds,
 * and a solid line drawn through two flood days implies a precision that is not
 * there.
 */
export function csiByLeadFigure(
  result: CsiByLead,
  opts: CsiByLeadOptions,
): { data: Data[]; layout: Partial<Layout> } {
  const { leads, thresholds } = result;
  const data: Data[] = [];

  // Context lines first, so the emphasised one draws over them.
  for (const s of thresholds) {
    if (s.category === opts.selected) continue;
    data.push({
      type: 'scatter',
      mode: 'lines',
      x: leads,
      y: s.csi,
      name: s.label,
      line: { color: CONTEXT, width: 1.5 },
      hovertemplate: `${s.label}<br>lead %{x} — CSI %{y:.3f}<extra></extra>`,
      showlegend: false,
      connectgaps: false,
    });
  }

  const sel = thresholds.find((s) => s.category === opts.selected) ?? thresholds[0];
  const thinAt = sel.eventSteps.map((n) => n < MIN_EVENT_STEPS);
  const anyThin = thinAt.some(Boolean);

  data.push({
    type: 'scatter',
    mode: 'lines+markers',
    x: leads,
    y: sel.csi,
    name: sel.label,
    line: { color: EMPHASIS, width: 2 },
    marker: {
      size: sel.eventSteps.map((n) => (n < MIN_EVENT_STEPS ? 7 : 8)),
      color: sel.eventSteps.map((n) => (n < MIN_EVENT_STEPS ? '#fcfcfb' : EMPHASIS)),
      line: {
        width: 2,
        color: sel.eventSteps.map((n) => (n < MIN_EVENT_STEPS ? THIN : EMPHASIS)),
      },
    },
    customdata: leads.map((_, i) => [
      sel.eventSteps[i],
      sel.hits[i],
      sel.falseAlarms[i],
      sel.misses[i],
      sel.pod[i],
      sel.far[i],
    ]),
    hovertemplate:
      `<b>${sel.label} — lead %{x}</b><br>CSI %{y:.3f}` +
      '<br>%{customdata[0]} distinct observed exceedances' +
      '<br>pooled hits %{customdata[1]}, false alarms %{customdata[2]}, misses %{customdata[3]}' +
      '<br>POD %{customdata[4]:.3f}  FAR %{customdata[5]:.3f}<extra></extra>',
    showlegend: false,
    connectgaps: false,
  });

  // Direct labels: the emphasised threshold named on the plot, the context ones
  // named faintly at their right-hand end. A legend box would repeat what the
  // selector already says.
  const annotations: NonNullable<Layout['annotations']> = [];
  for (const s of thresholds) {
    let last = -1;
    for (let i = 0; i < s.csi.length; i++) if (Number.isFinite(s.csi[i])) last = i;
    if (last < 0) continue;
    const isSel = s.category === opts.selected;
    annotations.push({
      x: leads[last],
      y: s.csi[last],
      xref: 'x',
      yref: 'y',
      text: `  ${s.label}`,
      showarrow: false,
      xanchor: 'left',
      font: {
        size: isSel ? 12 : 10,
        color: isSel ? EMPHASIS : CONTEXT_LABEL,
      },
    });
  }

  const steps = sel.eventSteps.filter((n) => n > 0);
  const stepRange = steps.length
    ? `${Math.min(...steps)}–${Math.max(...steps)} observed exceedances per lead`
    : 'no observed exceedances at this level';

  const layout: Partial<Layout> = {
    title: {
      text:
        `${opts.title ?? 'CSI by Lead Day'}${opts.riverId != null ? `  |  River ${opts.riverId}` : ''}` +
        `<br><sup>at or above ${sel.label.replace('≥', '')}  |  ` +
        `${result.members} members pooled per lead  |  ${stepRange}</sup>`,
      x: 0.5,
    },
    margin: { l: 64, r: 78, t: 68, b: 54 },
    xaxis: {
      title: { text: 'Lead day', standoff: 10 },
      dtick: 1,
      gridcolor: GRID,
      tickfont: { color: MUTED },
      zeroline: false,
    },
    yaxis: {
      title: { text: 'CSI = hits / (hits + false alarms + misses)', standoff: 12 },
      range: [0, 1.02],
      gridcolor: GRID,
      tickfont: { color: MUTED },
      zeroline: false,
    },
    annotations,
    height: 400,
    hovermode: 'closest',
    plot_bgcolor: '#fcfcfb',
    paper_bgcolor: '#fcfcfb',
    showlegend: false,
  };

  if (anyThin) {
    annotations.push({
      xref: 'paper',
      yref: 'paper',
      x: 0,
      y: -0.17,
      text: `<span style="color:${THIN}">○</span> hollow = fewer than ${MIN_EVENT_STEPS} observed exceedances at this lead`,
      showarrow: false,
      xanchor: 'left',
      font: { size: 10, color: MUTED },
    });
  }

  return { data, layout };
}
