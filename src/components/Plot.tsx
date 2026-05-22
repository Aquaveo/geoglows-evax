import { useEffect, useRef } from 'react';
import Plotly, { type Data, type Layout, type Config } from 'plotly.js-dist-min';

interface PlotProps {
  data: Data[];
  layout?: Partial<Layout>;
  config?: Partial<Config>;
  style?: React.CSSProperties;
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
    Plotly.react(ref.current, data, layout ?? {}, cfg);
  }, [data, layout, config]);

  useEffect(() => {
    const el = ref.current;
    return () => {
      if (el) Plotly.purge(el);
    };
  }, []);

  return <div ref={ref} style={{ width: '100%', height: 520, ...style }} />;
}
