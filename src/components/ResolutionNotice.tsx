import type { Cadence } from '../lib/ingest/cadence';
import type { ComparisonGrid } from '../lib/ingest/grid';

interface ResolutionNoticeProps {
  obs: Cadence | null;
  fcst: Cadence | null;
  grid: ComparisonGrid | null;
  /** Pairs available after aggregation, when known. */
  pairs?: number | null;
}

/**
 * States the resolution contract in the UI: what was uploaded, what the
 * forecasts are, what grid the comparison runs on, and which side got
 * aggregated. Every metric in the app inherits this resolution, so it is shown
 * rather than left implicit.
 */
export function ResolutionNotice({ obs, fcst, grid, pairs }: ResolutionNoticeProps) {
  if (!obs && !fcst) return null;

  return (
    <div style={box}>
      <div style={{ fontWeight: 600, marginBottom: '0.4rem', color: '#1f2937' }}>
        Temporal resolution
      </div>
      <ul style={list}>
        {obs && (
          <li>
            Observations uploaded at <strong>{obs.label}</strong> resolution ({obs.nSamples}{' '}
            samples)
            {obs.irregular && (
              <span style={warn}>
                {' '}
                — spacing is irregular ({Math.round(obs.regularShare * 100)}% of gaps match the
                median), so this is an estimate
              </span>
            )}
          </li>
        )}
        {fcst && (
          <li>
            Forecasts published at <strong>{fcst.label}</strong> resolution
            {fcst.irregular && (
              <span style={warn}> — cadence varies across the horizon</span>
            )}
          </li>
        )}
        {grid && (
          <li>
            Compared at <strong>{grid.label}</strong> resolution
            {grid.limitedBy === 'equal'
              ? ' — both inputs match'
              : `, limited by the ${grid.limitedBy}`}
            .{' '}
            {grid.observationsAggregated && 'Observations are aggregated down to this grid. '}
            {grid.forecastsAggregated &&
              'Forecasts are aggregated down to this grid, every member separately. '}
            {!grid.observationsAggregated && !grid.forecastsAggregated && 'Neither side is altered.'}
          </li>
        )}
        {pairs != null && (
          <li>
            <strong>{pairs}</strong> forecast/observation pair{pairs === 1 ? '' : 's'} per lead day
            after aggregation
            {pairs < 10 && (
              <span style={warn}>
                {' '}
                — too few for correlation-based scores (r, γ, KGE′) to be meaningful
              </span>
            )}
          </li>
        )}
      </ul>
      <p style={foot}>
        The coarser input always sets the comparison resolution. Nothing is interpolated up to a
        finer grid, because that would invent samples the data does not contain and make every
        metric look better-sampled than it is.
      </p>
    </div>
  );
}

const box: React.CSSProperties = {
  border: '1px solid #bfdbfe',
  background: '#f0f7ff',
  borderRadius: 8,
  padding: '0.75rem 1rem',
  marginBottom: '1.25rem',
  fontSize: '0.9rem',
  color: '#334155',
};
const list: React.CSSProperties = {
  margin: '0 0 0.5rem',
  paddingLeft: '1.2rem',
  lineHeight: 1.7,
};
const warn: React.CSSProperties = { color: '#b45309' };
const foot: React.CSSProperties = {
  margin: 0,
  color: '#64748b',
  fontSize: '0.85rem',
  borderTop: '1px solid #dbeafe',
  paddingTop: '0.5rem',
};
