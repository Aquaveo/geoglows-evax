import { useApp } from '../state/AppContext';
import { detectCadence } from '../lib/ingest/cadence';
import { chooseGrid } from '../lib/ingest/grid';
import { ResolutionNotice } from './ResolutionNotice';

export function OverviewTab() {
  const app = useApp();
  const obsCadence = app.eventData ? detectCadence(app.eventData) : null;

  // Cadence of the forecast output itself, read off any downloaded run.
  const firstRun = app.forecasts.values().next().value;
  const fcstCadence = firstRun
    ? detectCadence({ time: firstRun.time, values: firstRun.time.map(() => 0) })
    : null;

  const grid = obsCadence && fcstCadence ? chooseGrid(obsCadence, fcstCadence) : null;

  return (
    <div>
      <section style={sectionStyle}>
        <h2 style={h2}>Introduction</h2>
        <p style={p}>
          Forecast verification answers a deceptively simple question:{' '}
          <em>how good is the forecast?</em> In operational hydrology, the answer determines when
          to issue warnings, how much trust to place in model output, and where to focus model
          improvement efforts.
        </p>
        <p style={p}>
          This app implements a verification framework for ECMWF ensemble streamflow forecasts
          produced by the GEOGLOWS system. The framework evaluates forecasts issued during a
          specific flood event against observed gauge data, across multiple lead times (0–15 days)
          and all 51 ensemble members.
        </p>

        <h3 style={h3}>Why ensemble verification is different</h3>
        <p style={p}>
          A deterministic forecast produces a single value. An ensemble forecast produces a{' '}
          <em>distribution</em> of possible futures — 51 perturbed members. This distinction
          matters for verification because:
        </p>
        <ul style={ul}>
          <li>
            Some metrics evaluate <strong>each member independently</strong> as a deterministic
            forecast (MCC, HSS, KGE', peak timing error).
          </li>
          <li>
            Other metrics evaluate the <strong>ensemble as a collective distribution</strong>{' '}
            (CRPS).
          </li>
          <li>
            The spread between members is itself informative — a wide spread at the right time is
            desirable.
          </li>
        </ul>

        <h3 style={h3}>Structure of the verification framework</h3>
        <p style={p}>
          The metrics cover four complementary aspects of forecast quality. No single metric tells
          the complete story — a model can have good timing but poor magnitude, or good
          categorical skill but poor probabilistic calibration. Reading these together provides a
          diagnostic portrait of model behavior.
        </p>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Family</th>
              <th style={th}>Metrics</th>
              <th style={th}>Question answered</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={td}>Categorical</td>
              <td style={td}>Contingency matrix, MCC, HSS</td>
              <td style={td}>Did the forecast correctly classify the event severity?</td>
            </tr>
            <tr>
              <td style={td}>Timing</td>
              <td style={td}>Peak timing error, threshold crossing</td>
              <td style={td}>Did the forecast get the timing right?</td>
            </tr>
            <tr>
              <td style={td}>Accuracy</td>
              <td style={td}>KGE', r, β, γ</td>
              <td style={td}>How close was the forecast in magnitude and shape?</td>
            </tr>
            <tr>
              <td style={td}>Probabilistic</td>
              <td style={td}>CRPS</td>
              <td style={td}>Did the ensemble distribution cover the observation?</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2}>Temporal resolution</h2>

        <h3 style={h3}>The rule</h3>
        <p style={p}>
          Observations are uploaded by the user and can arrive at any sampling interval —
          15-minute, hourly, 3-hourly, daily. Forecasts arrive at whatever interval GEOGLOWS
          publishes. Every metric in this app therefore compares two series that may not share a
          clock, and the rule it follows is:
        </p>
        <p style={{ ...p, fontWeight: 600, color: '#1f2937' }}>
          Comparison happens at the coarser of the two resolutions. The finer series is aggregated
          down; the coarser series is never interpolated up.
        </p>
        <p style={p}>
          Interpolating upward would manufacture data. A daily record stretched to hourly invents
          23 values for every real measurement, and every metric would then count them as
          independent samples — inflating the sample size roughly 24-fold, smoothing the
          hydrograph, and quantising peak timing to whichever hour the daily value sits on while
          still reporting the answer in hours. Aggregating downward loses detail instead, which is
          honest, and keeps the pair count equal to the number of real observations.
        </p>

        <h3 style={h3}>Mean or maximum</h3>
        <p style={p}>
          How values are combined inside a bin depends on the question, so the app uses both:
        </p>
        <ul style={ul}>
          <li>
            <strong>Bin mean</strong> for error and distribution metrics (CRPS, CRPSS, KGE' and its
            components), which are about volume and shape.
          </li>
          <li>
            <strong>Bin maximum</strong> for the categorical and threshold families (contingency
            matrix, MCC, HSS, peak timing, threshold crossing), which are about how high the flow
            got. A daily <em>mean</em> can fall below a return-period threshold that the day's
            actual flow crossed, which would erase the exceedance the metric exists to detect.
          </li>
        </ul>
        <p style={p}>
          These answer different questions and are labelled accordingly — "daily maximum discharge"
          is not "daily mean discharge".
        </p>

        <h3 style={h3}>Consequences worth knowing</h3>
        <ul style={ul}>
          <li>
            Aggregation snaps timestamps onto exact bin boundaries. Before this, matching required
            exact millisecond equality, so a gauge reporting at five past the hour matched nothing
            at all and every metric silently returned zero pairs.
          </li>
          <li>
            Gaps stay gaps. An empty bin produces no forecast/observation pair rather than a filled
            value.
          </li>
          <li>
            Coarse observations mean few pairs. Daily data over a four-day event yields four pairs
            per lead day, which is not enough for the correlation-based scores (r, γ, KGE') to mean
            anything, however confident the box plots look.
          </li>
          <li>
            Peak timing can only resolve to the grid interval. On daily data, Δt<sub>peak</sub> is
            really answering "which day", not "which hour".
          </li>
        </ul>

        <h3 style={h3}>What your current data looks like</h3>
        {obsCadence || fcstCadence ? (
          <ResolutionNotice obs={obsCadence} fcst={fcstCadence} grid={grid} />
        ) : (
          <p style={p}>
            Upload an event CSV on the Setup tab and download forecasts on the Forecast tab, and
            the detected resolutions and the resulting comparison grid will be reported here.
          </p>
        )}
      </section>

      <section style={sectionStyle}>
        <h2 style={h2}>The dual-threshold design</h2>

        <h3 style={h3}>Motivation</h3>
        <p style={p}>
          A fundamental challenge in verifying global hydrological forecasts is that the model's{' '}
          <em>climatology</em> differs from the observed climatology. GEOGLOWS produces streamflow
          using a hydrological model forced by numerical weather prediction output. Return-period
          thresholds derived from this simulated climatology are systematically different from
          those derived from observed gauge records.
        </p>
        <p style={p}>
          If the observed 2-year return period is 82 m³/s but the simulated 2-year return period
          is 33 m³/s, classifying both the observation and the forecast against the same threshold
          would introduce a systematic bias into every categorical metric.
        </p>

        <h3 style={h3}>Implementation</h3>
        <p style={p}>The framework uses a dual-threshold approach:</p>
        <ul style={ul}>
          <li>
            <strong>Observations</strong> are classified using return periods computed from the
            observed annual maxima series, fitted with a Gumbel distribution.
          </li>
          <li>
            <strong>Forecasts</strong> are classified using return periods computed from the
            GEOGLOWS retrospective daily simulation, also fitted with a Gumbel distribution.
          </li>
        </ul>

        <h3 style={h3}>Return-period categories</h3>
        <p style={p}>
          The contingency matrix uses categories defined dynamically based on the magnitude of the
          observed event. The number of categories is determined by the maximum return period
          exceeded during the event.
        </p>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Category</th>
              <th style={th}>Observed threshold</th>
              <th style={th}>Forecast threshold</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={td}>&lt; 2 yr</td>
              <td style={td}>Flow &lt; Q₂,obs</td>
              <td style={td}>Flow &lt; Q₂,sim</td>
            </tr>
            <tr>
              <td style={td}>2–5 yr</td>
              <td style={td}>Q₂,obs ≤ Flow &lt; Q₅,obs</td>
              <td style={td}>Q₂,sim ≤ Flow &lt; Q₅,sim</td>
            </tr>
            <tr>
              <td style={td}>5–10 yr</td>
              <td style={td}>Q₅,obs ≤ Flow &lt; Q₁₀,obs</td>
              <td style={td}>Q₅,sim ≤ Flow &lt; Q₁₀,sim</td>
            </tr>
            <tr>
              <td style={td}>… up to ≥ 100 yr</td>
              <td style={td}>Flow ≥ Q₁₀₀,obs</td>
              <td style={td}>Flow ≥ Q₁₀₀,sim</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2}>Forecast reorganization by lead time</h2>

        <h3 style={h3}>The challenge: multiple initialization dates</h3>
        <p style={p}>
          GEOGLOWS issues a new ensemble forecast every day. For a flood event spanning, say, 4
          days, the system has issued forecasts initialized on each of the preceding 15 days plus
          the event days themselves. Each initialization produces a 15-day ensemble covering a
          different temporal window.
        </p>
        <p style={p}>
          To verify forecast skill <em>as a function of lead time</em>, all these forecasts must
          be reorganized. Instead of asking "what did the forecast initialized on date X
          predict?", the framework asks "what did all forecasts at <em>d</em> days of lead time
          predict for this event?"
        </p>

        <h3 style={h3}>Lead-time definition</h3>
        <p style={pMono}>d = ⌈ (t − t₀) / 24 h ⌉</p>
        <p style={p}>
          The lead time <em>d</em> of a forecast timestep <em>t</em> with respect to
          initialization time t₀ uses ceiling-based 24-hour windows:
        </p>
        <ul style={ul}>
          <li>
            <strong>Lead 0</strong>: the initialization timestep itself (t = t₀).
          </li>
          <li>
            <strong>Lead 1</strong>: the interval (0 h, 24 h] after initialization — the first
            forecast day.
          </li>
          <li>
            <strong>Lead d</strong>: the interval ((d−1)·24 h, d·24 h].
          </li>
        </ul>

        <h3 style={h3}>Procedure</h3>
        <p style={p}>
          The reorganization iterates over all initialization dates and assigns each forecast
          timestep to its corresponding lead-day bucket. For a given lead day, the contributions
          from all initialization dates are then concatenated into a single dataframe. That
          dataframe is what feeds the verification metrics.
        </p>
        <p style={p}>
          Before reorganization, the 3-hourly ensemble members are interpolated to hourly
          resolution using linear interpolation, aligning them with the hourly observed gauge
          record. Linear interpolation fills the intervals between 3-hourly values along a
          straight line — it cannot produce values higher or lower than the original 3-hourly
          points, so the peak of the interpolated series equals the peak of the native output.
        </p>

        <h3 style={h3}>Initialization window</h3>
        <p style={p}>
          For each event, the forecast download covers a window of <strong>15 days before the
          event start</strong> through the event end, ensuring that all lead times from 0 to 15
          days have at least one initialization contributing data. An event spanning D days yields
          15 + D initialization dates — longer events produce larger sample sizes within each
          lead-day bucket.
        </p>

        <h3 style={h3}>Interpretation caveat: initialization pooling</h3>
        <p style={p}>
          When the reorganization concatenates all initialization dates for a given lead day, a
          single observed timestep may appear <em>more than once</em> in the resulting dataframe
          — once for each initialization whose lead-<em>d</em> window covers that timestep. The
          flood peak, for example, falls within the lead-3 window of one initialization, the
          lead-4 window of the next, and so on. All of these forecast values are compared against
          the same observed value at that timestep.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2}>Metrics</h2>

        <h3 style={h3}>Categorical — Contingency matrix</h3>
        <p style={p}>
          A K × K table where K is the number of return-period categories. Element C
          <sub>ij</sub> counts timesteps where the observation fell in category{' '}
          <em>i</em> (row) and the forecast in category <em>j</em> (column). A perfect forecast
          produces non-zero values only on the diagonal.
        </p>
        <ul style={ul}>
          <li>
            <strong>Lower triangle</strong> (i &gt; j): observation in a higher category than the
            forecast → underestimation.
          </li>
          <li>
            <strong>Upper triangle</strong> (i &lt; j): observation in a lower category than the
            forecast → overestimation.
          </li>
        </ul>
        <p style={p}>
          Following the WMO/WWRP framework and Hewson (2007), all off-diagonal elements are treated
          as errors, analogous to "misses + false alarms" in a binary table.
        </p>

        <h3 style={h3}>Categorical — Matthews Correlation Coefficient (MCC)</h3>
        <p style={pMono}>
          MCC = (N·c − Σ tₖpₖ) / √[(N² − Σ pₖ²)(N² − Σ tₖ²)]
        </p>
        <p style={p}>
          The multi-category MCC (Gorodkin, 2004; Jurman et al., 2012) generalizes the binary MCC.
          Every term comes from the contingency matrix: N is the total count, c is the diagonal
          sum (hits), tₖ is the row sum for category k (observed marginals), pₖ is the column sum
          (forecast marginals). The numerator is the excess hits above what a random forecast with
          the same marginals would achieve; the denominator normalizes the result to [−1, 1].
        </p>
        <p style={p}>
          MCC = 1 is perfect agreement, MCC = 0 is no better than random, MCC &lt; 0 is systematic
          disagreement. A model that always predicts "&lt; 2 yr" during a flood event will have
          many hits but an MCC near zero — desirable behavior for a flood-skill metric.
        </p>

        <h3 style={h3}>Categorical — Heidke Skill Score (HSS)</h3>
        <p style={pMono}>HSS = (N·c − Σ tₖpₖ) / (N² − Σ tₖpₖ)</p>
        <p style={p}>
          HSS answers: by how much does the forecast improve over what a random forecast would
          achieve? Equivalently, HSS = (PC − PC<sub>ref</sub>) / (1 − PC<sub>ref</sub>), where PC
          is the proportion correct and PC<sub>ref</sub> is the proportion correct expected by
          chance.
        </p>
        <p style={p}>
          MCC and HSS share the same numerator. The difference is the denominator: HSS gives more
          credit to correctly classifying the most frequent category (normal flow), while MCC is
          more demanding and rewards correctly classifying rare extreme categories. Report both:
          if they agree, the conclusion is robust; if MCC ≪ HSS, the model is achieving apparent
          skill mainly on normal flow rather than the extreme event.
        </p>

        <h3 style={h3}>Timing — Peak timing error (Δt<sub>peak</sub>)</h3>
        <p style={pMono}>Δt_peak = t_peak,forecast − t_peak,observed  [hours]</p>
        <p style={p}>
          Δt<sub>peak</sub> &lt; 0 means the forecast peak arrives early; &gt; 0 means late.{' '}
          <strong>It is independent of magnitude</strong>: a member that predicts the peak at the
          right time has Δt = 0 even if the magnitude is far off. Use the median Δt across members
          as the primary statistic and the IQR as a measure of ensemble timing spread. An early
          bias is often preferable operationally — it gives communities more preparation time.
        </p>

        <h3 style={h3}>Timing — Threshold crossing</h3>
        <p style={pMono}>Δt_RP = t_crossing,forecast − t_crossing,observed  [hours]</p>
        <p style={p}>
          For each return-period threshold Q<sub>RP</sub>, the first ascending crossing — the
          first timestep where streamflow transitions from below to at-or-above the threshold —
          defines t<sub>crossing</sub>. This is operationally more relevant than peak timing,
          because flood early-warning systems issue alerts based on threshold exceedance, not peak
          arrival.
        </p>
        <p style={p}>Two quantities are reported separately:</p>
        <ul style={ul}>
          <li>
            <strong>Detection rate</strong>: fraction of members that crossed both the observed
            and forecast thresholds (and therefore have a computable Δt<sub>RP</sub>).
          </li>
          <li>
            <strong>Conditional timing error</strong>: Δt<sub>RP</sub> computed only for members
            that did detect the crossing.
          </li>
        </ul>
        <p style={p}>
          As the threshold increases, the detection rate typically decreases, revealing the limits
          of the ensemble's probabilistic coverage of extreme events.
        </p>

        <h3 style={h3}>Accuracy — Kling–Gupta Efficiency (KGE')</h3>
        <p style={pMono}>KGE' = 1 − √[(r − 1)² + (β − 1)² + (γ − 1)²]</p>
        <p style={p}>
          Gupta et al. (2009) decomposed the MSE into three orthogonal components, refined by
          Kling et al. (2012):
        </p>
        <ul style={ul}>
          <li>
            <strong>Correlation r</strong> — Pearson correlation between forecast and observation.
            Perfect value 1; lower values indicate poor timing or shape.
          </li>
          <li>
            <strong>Bias ratio β</strong> = mean(forecast) / mean(observed). Perfect value 1;
            &gt; 1 is an overestimation bias, &lt; 1 underestimation.
          </li>
          <li>
            <strong>Variability ratio γ</strong> = CV<sub>f</sub> / CV<sub>o</sub>. Perfect value
            1; &gt; 1 overestimates variability, &lt; 1 underestimates.
          </li>
        </ul>
        <p style={p}>
          The dominant error source is the component furthest from 1. Performance bands: &gt; 0.75
          good, 0.50–0.75 intermediate, 0.00–0.50 poor, −0.41–0.00 very poor, ≤ −0.41
          unacceptable. The −0.41 benchmark corresponds to using the observed mean flow as the
          forecast for every timestep; below it, the model provides no useful information beyond
          climatology.
        </p>

        <h3 style={h3}>Probabilistic — Continuous Ranked Probability Score (CRPS)</h3>
        <p style={pMono}>
          CRPS = (1/M) Σ |Xₘ − Q_obs| − (1/2M²) Σ Σ |Xₘ − Xₘ'|
        </p>
        <p style={p}>
          CRPS evaluates the ensemble as a probability distribution, not member by member. Using
          the energy-score form (Gneiting & Raftery, 2007) the two terms have direct physical
          meaning: the first is the mean absolute error of the members against the observation
          (penalizes bias); the second is half the mean pairwise absolute difference between
          members (rewards spread). The result has the same units as discharge (m³/s).
        </p>
        <ul style={ul}>
          <li>
            <strong>Perfect score</strong> CRPS = 0; <strong>lower is better</strong>; no upper
            bound for poor forecasts.
          </li>
          <li>
            <strong>Proper scoring rule</strong>: a forecaster cannot game CRPS by over- or
            under-dispersing the ensemble.
          </li>
          <li>
            CRPS produces a single value per lead day. Because it is averaged over all timesteps,
            extreme peak timesteps can be diluted by many normal-flow timesteps — a moderate CRPS
            may still hide a catastrophic failure at the flood peak.
          </li>
        </ul>
      </section>
    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  marginBottom: '2rem',
  padding: '1rem 1.25rem',
  border: '1px solid #ddd',
  borderRadius: 8,
  background: '#fff',
};
const h2: React.CSSProperties = { marginTop: 0, fontSize: '1.15rem' };
const h3: React.CSSProperties = { marginTop: '1.25rem', marginBottom: '0.4rem', fontSize: '1rem' };
const p: React.CSSProperties = { margin: '0.5rem 0', lineHeight: 1.55, color: '#222' };
const pMono: React.CSSProperties = {
  margin: '0.5rem 0',
  padding: '0.5rem 0.75rem',
  background: '#f6f7f9',
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.95rem',
};
const ul: React.CSSProperties = { margin: '0.4rem 0 0.6rem 1.25rem', lineHeight: 1.55, color: '#222' };
const table: React.CSSProperties = { borderCollapse: 'collapse', marginTop: '0.5rem', width: '100%' };
const th: React.CSSProperties = {
  textAlign: 'left',
  borderBottom: '1px solid #ccc',
  padding: '6px 8px',
  background: '#f6f7f9',
};
const td: React.CSSProperties = { borderBottom: '1px solid #eee', padding: '6px 8px', verticalAlign: 'top' };
