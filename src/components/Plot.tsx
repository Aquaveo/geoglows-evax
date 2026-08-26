import { useEffect, useMemo, useRef } from 'react';
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
 * Structural hash of a figure, used to tell a real change from a re-render.
 *
 * Walks the value and folds it into one number rather than serialising it. A
 * JSON.stringify would work but allocates a several-hundred-kilobyte string for
 * an ensemble hydrograph on every render, which is the kind of cost this is
 * meant to avoid in the first place.
 *
 * Key order is not sorted: these objects are built by one code path per figure,
 * so insertion order is already stable between renders.
 */
function hashFigure(value: unknown, h = 0x811c9dc5): number {
  if (value === null) return fold(h, 1);
  switch (typeof value) {
    case 'undefined':
      return fold(h, 2);
    case 'boolean':
      return fold(h, value ? 3 : 4);
    case 'number':
      // Split the float so 1 and 1.5 cannot collide, and NaN stays stable.
      if (Number.isNaN(value)) return fold(h, 5);
      return fold(fold(h, value | 0), Math.round((value % 1) * 0x7fffffff));
    case 'string': {
      let out = fold(h, value.length);
      for (let i = 0; i < value.length; i++) out = fold(out, value.charCodeAt(i));
      return out;
    }
    case 'object': {
      if (value instanceof Date) return fold(h, value.getTime());
      if (Array.isArray(value)) {
        let out = fold(h, value.length);
        for (let i = 0; i < value.length; i++) out = hashFigure(value[i], out);
        return out;
      }
      let out = h;
      for (const k in value as Record<string, unknown>) {
        out = hashFigure(k, out);
        out = hashFigure((value as Record<string, unknown>)[k], out);
      }
      return out;
    }
    default:
      // Functions and symbols: identity is not stable across renders and no
      // figure should carry them, so fold a constant rather than thrashing.
      return fold(h, 6);
  }
}

function fold(h: number, n: number): number {
  return (Math.imul(h ^ n, 0x01000193) >>> 0) | 0;
}

/**
 * Minimal Plotly wrapper. We use plotly.js-dist-min directly instead of
 * react-plotly.js to avoid pulling in the much larger plotly.js bundle.
 */
export function Plot({ data, layout, config, style }: PlotProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Every caller builds `data` and `layout` inline in its JSX, so both are new
  // objects on every render even when the figure is identical. Keying the effect
  // on their identity therefore re-ran Plotly.react for EVERY mounted chart on
  // EVERY render of the tab — and since react() resets the return-period bands
  // to their unstretched height, syncTopBands then issued a restyle, so each
  // chart paid two full Plotly operations per render. With ~20 charts mounted
  // that is what made the page stop responding.
  //
  // Keying on the figure's CONTENT makes a render that changes nothing free.
  //
  // Memoising on the hash gives back the SAME object while the content is
  // unchanged, and a fresh one carrying the current figure the moment it is not,
  // so the effect can depend on it directly. No ref written during render, and
  // nothing to keep in sync.
  const signature = hashFigure([data, layout, config]);
  const figure = useMemo(
    () => ({ data, layout, config }),
    // Content, deliberately, not identity — that substitution is the whole fix.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature],
  );

  useEffect(() => {
    if (!ref.current) return;
    const { data: d, layout: l, config: c } = figure;
    const cfg: Partial<Config> = {
      responsive: true,
      displaylogo: false,
      ...c,
    };
    let disposed = false;
    void Plotly.react(ref.current, d, l ?? {}, cfg).then((gd) => {
      if (disposed) return;
      syncTopBands(gd);
      // Legend clicks arrive as restyles; re-fit the band to what is left.
      gd.removeAllListeners('plotly_restyle');
      gd.on('plotly_restyle', () => syncTopBands(gd));
    });
    return () => {
      disposed = true;
    };
  }, [figure]);

  useEffect(() => {
    const el = ref.current;
    return () => {
      if (el) Plotly.purge(el);
    };
  }, []);

  return <div ref={ref} style={{ width: '100%', height: 520, ...style }} />;
}
