import { useMemo, useState } from 'react';
import { useApp } from '../state/AppContext';
import { Plot } from './Plot';
import { PlotNote } from './PlotNote';
import { dumbbellFigure } from '../plots/dumbbell';
import { conditionalBiasFigure } from '../plots/conditionalBias';
import { flowDurationFigure, monthlyBiasFigure } from '../plots/flowDuration';
import {
  flowDurationCurve,
  monthlyBias,
  murphyDecomposition,
  noiseFloorRes,
  pairDaily,
  summarise,
} from '../lib/metrics/retrospectiveEval';

const BIN_CHOICES = [10, 20, 50, 100];

/**
 * Retrospective evaluation: the retrospective simulation against the uploaded
 * observed record, with no reference to any event.
 *
 * A separate tab rather than a section of Metrics, because it answers a
 * different question with a different sample. Metrics asks "how did the forecast
 * do on this flood" from tens of pairs; this asks "how good is the model at this
 * reach" from tens of thousands. Several methods that are statistically
 * indefensible on one event — conditional-bias curves, an MSE decomposition —
 * are sound here, and mixing them into the event tab would invite reading them
 * as event results.
 *
 * Nothing here needs a download the app does not already make.
 */
export function RetrospectiveTab() {
  const app = useApp();
  const [binCount, setBinCount] = useState(50);

  const paired = useMemo(
    () => (app.retro && app.historicalData ? pairDaily(app.retro, app.historicalData) : null),
    [app.retro, app.historicalData],
  );
  const summary = useMemo(() => (paired ? summarise(paired) : null), [paired]);
  const murphy = useMemo(
    () => (paired ? murphyDecomposition(paired.sim, paired.obs, binCount) : null),
    [paired, binCount],
  );
  const months = useMemo(() => (paired ? monthlyBias(paired) : null), [paired]);
  const fdc = useMemo(
    () =>
      paired
        ? { sim: flowDurationCurve(paired.sim), obs: flowDurationCurve(paired.obs) }
        : null,
    [paired],
  );

  if (!app.retro) {
    return (
      <Empty>
        Load a reach on the <strong>Setup</strong> tab. The retrospective simulation is fetched
        with it — nothing further to download.
      </Empty>
    );
  }
  if (!app.historicalData) {
    return (
      <Empty>
        Upload the <strong>historical observations</strong> on the Setup tab. This tab compares that
        record against the retrospective simulation, so it needs the long observed series rather
        than the event CSV.
      </Empty>
    );
  }
  if (!paired || !summary || paired.sim.length < 400) {
    return (
      <Empty>
        Only {paired?.sim.length ?? 0} days overlap between the retrospective and the uploaded
        record. This tab needs a few hundred at minimum, and is designed for multi-decade records —
        the methods here produce confident-looking numbers from noise on small samples.
      </Empty>
    );
  }

  const floor = murphy ? noiseFloorRes(murphy.unc, binCount, murphy.n) : null;
  const river = app.reach?.riverId ? ` — River ${app.reach.riverId}` : '';

  return (
    <div>
      <section style={section}>
        <h2 style={h2}>Retrospective evaluation</h2>
        <p style={note}>
          The retrospective simulation against your uploaded observed record, over every day the
          two overlap. <strong>No forecasts are involved</strong>, so there is no lead time here:
          the retrospective is driven by observed meteorology, which makes this the model's skill
          with perfect weather input — a ceiling on what any forecast at this reach can achieve.
        </p>
        <div style={tiles}>
          <Tile label="Paired days" value={summary.n.toLocaleString()} sub={`${summary.years.toFixed(0)} years`} />
          <Tile label="NSE" value={summary.nse.toFixed(3)} sub={summary.nse > 0 ? 'beats the observed mean' : 'worse than the mean'} />
          <Tile label="KGE′" value={summary.kge.toFixed(3)} sub={`r ${summary.r.toFixed(2)}`} />
          <Tile label="Bias" value={`${summary.pbias > 0 ? '+' : ''}${summary.pbias.toFixed(1)}%`} sub={`β ${summary.beta.toFixed(3)}`} />
          <Tile label="Variability" value={summary.gamma.toFixed(3)} sub="γ = CV ratio" />
          <Tile label="RMSE" value={summary.rmse.toFixed(0)} sub="m³/s" />
          <Tile label="Record max" value={summary.obsMax.toFixed(0)} sub={`simulated ${summary.simMax.toFixed(0)}`} />
        </div>
        {paired.simOnly + paired.obsOnly > 0 && (
          <p style={{ ...note, marginTop: '0.6rem' }}>
            {paired.simOnly.toLocaleString()} simulated days and{' '}
            {paired.obsOnly.toLocaleString()} observed days had no counterpart and are excluded.
            Both series are reduced to daily means before pairing — the coarser cadence wins, as
            everywhere else in the app.
          </p>
        )}
      </section>

      <section style={section}>
        <h2 style={h2}>Where in the flow range the model fails</h2>
        <Plot
          {...flowDurationFigure(fdc!.sim, fdc!.obs, {
            title: `Flow Duration Curves${river}`,
            subtitle: `${summary.n.toLocaleString()} paired days, ${summary.years.toFixed(0)} years`,
          })}
        />
        <PlotNote>
          each curve says what discharge is exceeded on what fraction of days, so the left edge is
          floods and the right is low flow. Parallel curves mean a constant bias one factor could
          fix. Curves that converge at one end and separate at the other mean the error depends on
          magnitude — and then no single multiplier works, which is exactly what the bias-correction
          section runs into. Both axes are logarithmic because the flood end occupies the leftmost
          1% and would otherwise be invisible.
        </PlotNote>
      </section>

      <section style={section}>
        <h2 style={h2}>Conditional bias</h2>
        <label style={lbl}>
          Bins:&nbsp;
          <select value={binCount} onChange={(e) => setBinCount(Number(e.target.value))} style={sel}>
            {BIN_CHOICES.map((b) => (
              <option key={b} value={b}>
                {b} ({Math.floor(summary.n / b).toLocaleString()} days each)
              </option>
            ))}
          </select>
        </label>
        {murphy && (
          <>
            <Plot
              {...conditionalBiasFigure(murphy.bins, {
                title: `Observed given Simulated${river}`,
                subtitle: `${binCount} equal-count bins, ${murphy.n.toLocaleString()} days`,
                obsMean: mean(paired.obs),
                slope: murphy.slope,
              })}
            />
            <PlotNote>
              group the days by simulated discharge, then plot what was actually observed in each
              group. Distance from the dashed diagonal is the calibration error <em>at that
              magnitude</em>, which a single aggregate bias figure cannot show. The curve's slope
              says whether the model's range is scaled correctly: above 1 it compresses the range,
              below 1 it exaggerates it. Marker size is the number of days behind each point.
            </PlotNote>

            <h3 style={h3}>MSE decomposition</h3>
            <Plot
              {...dumbbellFigure(
                [
                  { label: 'REL — conditional bias', before: 0, after: murphy.rel },
                  { label: 'RES — resolution', before: 0, after: murphy.res },
                  { label: 'var(obs) — uncertainty', before: 0, after: murphy.unc },
                  { label: 'MSE', before: 0, after: murphy.mse },
                ],
                {
                  title: `MSE = REL − RES + var(obs)${river}`,
                  subtitle: `${binCount} bins, closure error ${murphy.closurePct.toFixed(2)}%`,
                  metricLabel: '(m³/s)²',
                  beforeLabel: 'zero',
                  afterLabel: 'value',
                  higherIsBetter: true,
                },
              )}
            />
            <div style={callout}>
              <strong>Read these against two numbers.</strong>{' '}
              <strong>Closure error {murphy.closurePct.toFixed(2)}%</strong> — the split is exact
              only for discrete forecasts, so the within-bin spread of continuous discharge leaves
              a residual. It shrinks as bins are added; if it is large, raise the bin count before
              trusting the terms.{' '}
              {floor != null && (
                <>
                  <strong>
                    Resolution noise floor {floor.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </strong>{' '}
                  — roughly what RES would read if the model had <em>no</em> real skill, from{' '}
                  (bins − 1) × var(obs) / n. RES here is{' '}
                  {(murphy.res / floor).toFixed(0)}× that, so{' '}
                  {murphy.res / floor > 5 ? 'the resolution is real' : 'treat the resolution as unresolved'}.
                </>
              )}{' '}
              REL {murphy.rel > murphy.res ? 'exceeds' : 'is below'} RES, so in MSE terms the model{' '}
              {murphy.rel > murphy.res ? 'loses to' : 'beats'} simply predicting the observed mean.
            </div>
          </>
        )}
        {!murphy && (
          <p style={note}>
            Not enough days for {binCount} bins. Choose fewer bins, or upload a longer record.
          </p>
        )}
      </section>

      <section style={section}>
        <h2 style={h2}>Seasonal bias</h2>
        {months && months.length > 0 && (
          <>
            <Plot
              {...monthlyBiasFigure(months, {
                title: `Simulated / Observed by Month${river}`,
                subtitle: `${summary.n.toLocaleString()} days over ${summary.years.toFixed(0)} years`,
              })}
            />
            <PlotNote>
              zero is parity. This is the view that decides whether bias correction can work at
              all: a flat line means one factor fixes the whole year, a swing means the monthly
              treatment is necessary, and bars crossing zero mean the model is high in some months
              and low in others — which no multiplicative correction can fix. The app's bias
              correction is fitted per calendar month, so these are the twelve regimes it is
              working with.
            </PlotNote>
          </>
        )}
      </section>
    </div>
  );
}

function mean(a: number[]): number {
  return a.reduce((x, y) => x + y, 0) / a.length;
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={tile}>
      <div style={tileL}>{label}</div>
      <div style={tileV}>{value}</div>
      {sub && <div style={tileS}>{sub}</div>}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <section style={section}>
      <h2 style={h2}>Retrospective evaluation</h2>
      <p style={note}>{children}</p>
    </section>
  );
}

const section: React.CSSProperties = {
  marginBottom: '2rem',
  padding: '1rem 1.25rem',
  border: '1px solid #ddd',
  borderRadius: 8,
  background: '#fff',
};
const h2: React.CSSProperties = { marginTop: 0, fontSize: '1.05rem' };
const h3: React.CSSProperties = { fontSize: '0.95rem', margin: '1.25rem 0 0.5rem' };
const note: React.CSSProperties = { color: '#555', fontSize: '0.9rem', margin: '0 0 0.5rem' };
const tiles: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: '0.6rem',
  marginTop: '0.9rem',
};
const tile: React.CSSProperties = {
  border: '1px solid #e5e4e0',
  borderRadius: 5,
  padding: '0.6rem 0.75rem',
  background: '#fcfcfb',
};
const tileL: React.CSSProperties = {
  fontSize: '0.68rem',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: '#898781',
};
const tileV: React.CSSProperties = {
  fontSize: '1.5rem',
  fontWeight: 700,
  letterSpacing: '-0.02em',
  fontVariantNumeric: 'tabular-nums',
  margin: '0.2rem 0 0',
};
const tileS: React.CSSProperties = { fontSize: '0.75rem', color: '#52514e', marginTop: '0.15rem' };
const callout: React.CSSProperties = {
  marginTop: '0.75rem',
  padding: '0.75rem 1rem',
  border: '1px solid #cbd5e1',
  background: '#f8fafc',
  borderRadius: 6,
  fontSize: '0.88rem',
  lineHeight: 1.6,
};
const lbl: React.CSSProperties = { fontSize: '0.9rem', color: '#333' };
const sel: React.CSSProperties = { padding: '0.2rem 0.4rem', fontSize: '0.9rem' };
