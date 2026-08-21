import { useEffect, useRef } from 'react';
import Plotly, {
  type Data,
  type Layout,
  type Config,
  type PlotlyHTMLElement,
} from 'plotly.js-dist-min';

interface PlotProps {
  data: Data[];
  layout?: Partial<Layout>;
  config?: Partial<Config>;
  style?: React.CSSProperties;
}

/** Marker written by `rpBandTraces` onto the topmost band of each group. */
interface TopBandMeta {
  rpTopBand?: boolean;
  lower?: number;
}

/**
 * Stretch return-period top-bands up to the top of the visible data.
 *
 * The band cannot be sized at figure-build time: plotly.js counts
 * data-coordinate traces and shapes in autorange, so a band sized from a series
 * the user later hides would hold the y-axis up at that hidden series' peak.
 * Sizing it here — from the traces that are actually visible — keeps the band
 * filling the plot while letting the axis collapse when a series is toggled off.
 *
 * This terminates: the band top is set to the visible maximum, which autorange
 * already accounts for, so the follow-up `plotly_restyle` finds nothing to
 * change and the cascade stops.
 */
function syncTopBands(gd: PlotlyHTMLElement) {
  const traces = (gd.data ?? []) as Array<Record<string, unknown>>;

  let dataMax = 0;
  for (const t of traces) {
    if ((t.meta as TopBandMeta | undefined)?.rpTopBand) continue;
    if (t.visible === 'legendonly' || t.visible === false) continue;
    const ys = t.y as unknown[] | undefined;
    if (!Array.isArray(ys)) continue;
    for (const v of ys) {
      if (typeof v === 'number' && Number.isFinite(v) && v > dataMax) dataMax = v;
    }
  }

  const indices: number[] = [];
  const updated: number[][] = [];
  traces.forEach((t, i) => {
    const meta = t.meta as TopBandMeta | undefined;
    if (!meta?.rpTopBand || typeof meta.lower !== 'number') return;
    const lower = meta.lower;
    // Never invert the band: if every visible series sits below the threshold,
    // fall back to a thin band above it.
    const top = Math.max(dataMax, lower * 1.05);
    const current = (t.y as number[] | undefined)?.[2];
    if (current != null && Math.abs(current - top) <= Math.max(1e-9, Math.abs(top) * 1e-9)) {
      return; // already at the right height — stop the restyle cascade here
    }
    indices.push(i);
    updated.push([lower, lower, top, top, lower]);
  });

  if (indices.length > 0) {
    void Plotly.restyle(gd, { y: updated }, indices);
  }
}

/**
 * Minimal Plotly wrapper. We use plotly.js-dist-min directly instead of
 * react-plotly.js to avoid pulling in the much larger plotly.js bundle.
 */
export function Plot({ data, layout, config, style }: PlotProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const cfg: Partial<Config> = {
      responsive: true,
      displaylogo: false,
      ...config,
    };
    let disposed = false;
    void Plotly.react(ref.current, data, layout ?? {}, cfg).then((gd) => {
      if (disposed) return;
      syncTopBands(gd);
      // Legend clicks arrive as restyles; re-fit the band to what is left.
      gd.removeAllListeners('plotly_restyle');
      gd.on('plotly_restyle', () => syncTopBands(gd));
    });
    return () => {
      disposed = true;
    };
  }, [data, layout, config]);

  useEffect(() => {
    const el = ref.current;
    return () => {
      if (el) Plotly.purge(el);
    };
  }, []);

  return <div ref={ref} style={{ width: '100%', height: 520, ...style }} />;
}
