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
          Verification asks:{' '}
          <em>how good is the forecast?</em> In operational hydrology the answer sets when to issue
          warnings, how far to trust model output, and where to focus improvement.
        </p>
        <p style={p}>
          This app verifies ensemble streamflow forecasts from <strong>RFS</strong> (the River
          Forecast System), the hydrological model delivered through GEOGLOWS and forced by ECMWF
          numerical weather prediction. It scores one flood event's forecasts against observed
          gauge data across lead times of 0–15 days and all 51 members.
        </p>

        <h3 style={h3}>Why ensemble verification is different</h3>
        <p style={p}>
          A deterministic forecast gives one value; an ensemble gives a{' '}
          <em>distribution</em> of possible futures — 51 perturbed members:
        </p>
        <ul style={ul}>
          <li>
            Some metrics evaluate <strong>each member independently</strong> as a deterministic
            forecast, then summarise those 51 scores — MCC, HSS, CSI, NSE, KGE′, peak timing error.
          </li>
          <li>
            Others evaluate the <strong>ensemble as a collective distribution</strong> — CRPS, and
            RPS, which reads the fraction of members in each severity category as a probability. A
            spread that straddles the truth is rewarded over confident error, which no per-member
            score can express.
          </li>
          <li>Spread is itself informative — a wide spread at the right time is desirable.</li>
        </ul>

        <h3 style={h3}>Structure of the verification framework</h3>
        <p style={p}>
          Four families cover complementary aspects of forecast quality. None alone tells the whole
          story — good timing can accompany poor magnitude, good categorical skill poor
          probabilistic calibration — so read them together as a diagnostic portrait of model
          behavior.
        </p>
        <p style={p}>
          Two families are also affected by something other than forecast error: RFS is global and
          can run systematically high or low at a single reach — one running 40% low scores badly
          on magnitude however well it caught the event's shape and timing.{' '}
          <strong>Bias correction</strong> separates the two: the metrics section's Accuracy,
          Probabilistic and Skill-summary blocks each pair a raw view with two corrected ones — one
          fitted to your uploaded record, one from centrally published per-river coefficients —
          detailed in the <em>Bias correction</em> section below. Categorical and Timing need none:
          their dual-threshold design absorbs magnitude bias by construction, as their own section
          explains.
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
              <td style={td}>
                Contingency matrix, MCC, HSS, CSI, RPS and RPSS, per-threshold scores
              </td>
              <td style={td}>Did the forecast correctly classify the event severity?</td>
            </tr>
            <tr>
              <td style={td}>Timing</td>
              <td style={td}>Peak timing error, threshold crossing</td>
              <td style={td}>Did the forecast get the timing right?</td>
            </tr>
            <tr>
              <td style={td}>Accuracy</td>
              <td style={td}>NSE, KGE′ and its components r, β, γ</td>
              <td style={td}>How close was the forecast in magnitude and shape?</td>
            </tr>
            <tr>
              <td style={td}>Probabilistic</td>
              <td style={td}>CRPS, CRPSS</td>
              <td style={td}>Did the ensemble distribution cover the observation?</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2}>Temporal resolution</h2>

        <h3 style={h3}>The rule</h3>
        <p style={p}>
          Uploaded observations arrive at any interval — 15-minute, hourly, 3-hourly, daily;
          forecasts at whatever interval RFS publishes. Every metric therefore compares series that
          may not share a clock:
        </p>
        <p style={{ ...p, fontWeight: 600, color: '#1f2937' }}>
          Comparison happens at the coarser resolution: the finer series is aggregated down, the
          coarser never interpolated up.
        </p>
        <p style={p}>
          Interpolating upward manufactures data: a daily record stretched to hourly invents 23
          values per real measurement, all counted as independent samples — inflating sample size
          roughly 24-fold, smoothing the hydrograph, and quantising peak timing to the daily
          value's hour while still reporting hours. Aggregating down loses detail instead — honest,
          and pairs still equal real observations.
        </p>

        <h3 style={h3}>How a bin is summarised</h3>
        <p style={p}>
          When several timesteps fall in one grid bin they have to become one number, and that
          choice is not cosmetic — it decides how often the flow is counted as crossing a threshold.
        </p>
        <ul style={ul}>
          <li>
            <strong>Bin mean</strong>, always, for the error and distribution metrics (CRPS, CRPSS,
            KGE′ and its components). These are about volume and shape, and the mean is what
            preserves them.
          </li>
          <li>
            <strong>Your choice</strong> for the categorical and threshold families, defaulting to
            the <strong>median</strong>. The selector sits above the Compute button in the
            Categorical block, and also governs the reference RPSS is scored against.
          </li>
        </ul>
        <p style={p}>
          <strong>Why it is a choice rather than a fixed answer.</strong> A threshold can only be
          compared against a quantity of the same kind, and these thresholds inherit whatever you
          uploaded: <code>returnPeriodsFromSeries</code> fits Gumbel-I to annual maxima taken at the
          record's <em>native</em> resolution. A daily-values upload — which for most gauge services
          means daily <em>mean</em> discharge — therefore produces a threshold on daily means. A
          15-minute upload produces one on instantaneous peaks. Same code, two different kinds of
          threshold, and only you know which you have.
        </p>
        <p style={p}>
          The three differ sharply where it matters most. On a bin with realistic within-day shape,
          the maximum crosses a 10-year-ish level <strong>7.2×</strong> as often as the mean; at a
          2-year level the gap is only 1.3×. The distortion grows with severity, which is the end
          the flood metrics live at. The median is the default because it is the least distorting
          summary of the three: not dragged by a single extreme step the way the mean is, and not
          representing a whole day by its most extreme instant the way the maximum is.
        </p>
        <p style={p}>
          Note this is aggregation over <em>time</em>, applied to each ensemble member separately.
          It never combines members — a 51-member ensemble stays 51 trajectories through every one
          of these paths, and no metric here is computed from a maximum across the ensemble.
        </p>
        <p style={p}>
          It only bites when your data is finer than the comparison grid. With a daily gauge on a
          daily grid every bin holds one value and all three choices give the same number.
        </p>

        <h3 style={h3}>Consequences</h3>
        <ul style={ul}>
          <li>
            Aggregation snaps timestamps onto exact bin boundaries; matching previously required
            millisecond equality, so a gauge reporting five past the hour matched nothing and
            metrics silently returned zero pairs.
          </li>
          <li>
            Gaps stay gaps: an empty bin yields no forecast/observation pair, not a filled value.
          </li>
          <li>
            Coarse observations mean few pairs: a four-day event at daily resolution gives four per
            lead day, too few for the correlation-based scores (r, γ, KGE') however confident the box
            plots look.
          </li>
          <li>
            Peak timing resolves only to the grid interval: on daily data, Δt<sub>peak</sub> answers
            "which day", not "which hour".
          </li>
        </ul>

        <h3 style={h3}>Your current data</h3>
        {obsCadence || fcstCadence ? (
          <ResolutionNotice obs={obsCadence} fcst={fcstCadence} grid={grid} />
        ) : (
          <p style={p}>
            Upload an event CSV (Setup tab) and download forecasts (Forecast tab); detected
            resolutions and comparison grid appear here.
          </p>
        )}
      </section>

      <section style={sectionStyle}>
        <h2 style={h2}>Bias correction</h2>

        <h3 style={h3}>Why it exists, and which metrics need it</h3>
        <p style={p}>
          RFS is global and can run systematically high or low at a given reach. Raw-discharge
          metrics — NSE, KGE′ and its components, and CRPS — therefore measure that bias as much as
          skill: a model running 40% low shows β near 0.6 and a large squared-error penalty however
          well it captured shape and timing.
        </p>
        <p style={p}>
          The categorical metrics need no correction. Their{' '}
          <strong>dual-threshold design</strong> — explained below — compares observations against
          observed return periods and forecasts against simulated ones, so magnitude bias cancels
          out. Correcting the forecasts as well would apply the same adjustment twice. The
          contingency matrix, MCC, HSS, CSI, the per-threshold scores, RPS and the timing metrics
          are therefore left raw, and corrected variants appear only under{' '}
          <strong>Accuracy</strong>, <strong>Probabilistic</strong> and{' '}
          <strong>Skill summary</strong>.
        </p>
        <p style={p}>
          Where a corrected variant does exist, the Bias correction block opens with a table putting
          raw against both corrections on every one of those metrics at once. The charts below it
          show one correction at a time, so the table is the quickest way to see whether either
          helped. Read its <em>Best</em> column as movement <em>toward</em> each metric's ideal
          rather than upward: β and γ target 1 and can miss either way, so an over-correction from
          0.9 to 1.4 is not an improvement, and CRPS wants to fall.
        </p>

        <h3 style={h3}>Two methods, offered side by side</h3>
        <p style={p}>
          All three offer <strong>Raw</strong> plus two corrected options: the methods fail in
          opposite ways, neither reliably better.
        </p>
        <p style={p}>
          <strong>
            Both fit on the retrospective against observations, then apply that transform to
            forecasts — assuming both share the same error.
          </strong>{' '}
          They need not: retrospective meteorology is observed, forecast meteorology forecast, and
          nothing here measures the gap — a correction can be faithful and still wrong.
        </p>
        <ul style={ul}>
          <li>
            <strong>Local Bias Correction</strong> — the classic GEOGLOWS method, monthly flow
            duration curve quantile mapping (MFDC-QM), evaluated in{' '}
            <a href="https://doi.org/10.1016/j.envsoft.2024.106235" style={link} target="_blank" rel="noreferrer">
              Sanchez Lozano et al. (2025)
            </a>. Detailed below: fitted to your reach, inheriting the sparsity of the record you
            upload.
          </li>
          <li>
            <strong>SABER</strong> — Stream Analysis for Bias Estimation and Reduction, the RFS
            "Global Bias Correction", applied through{' '}
            <code>geoglows.bias.discharge_transform</code> and described in{' '}
            <a href="https://doi.org/10.3390/hydrology9070113" style={link} target="_blank" rel="noreferrer">
              Hales et al. (2022)
            </a>. Same premise, fitted centrally: simulated against observed curves at gauged
            reaches, watersheds clustered by flow behaviour so <em>ungauged</em> reaches borrow
            from gauged ones, a scalar published per month and exceedance probability. It needs
            nothing from you — the app reads those weights' polynomial form — and smooth fits, not
            empirical steps, leave no flat inverse: no infinities, no excluded runs. Still
            experimental, and the training material notes it is{' '}
            <strong>not applied to the forecast data end users receive</strong>: this app's
            downloads are uncorrected until you choose it.
          </li>
        </ul>
        <p style={p}>
          <strong>Both use gauge data</strong>; the difference is <em>whose</em>. Local Bias
          Correction uses your uploaded record — directly relevant, as sparse as it is. SABER's
          gauges are chosen centrally, maybe a <em>different, clustered</em> reach: better sampled,
          not necessarily this river. So a SABER ceiling can sit well below your record's maximum —
          it belongs to the reference curve, not your gauge.
        </p>
        <p style={p}>
          SABER's own failure is <strong>saturation</strong>: once the percentile clamps, larger
          discharges all map to one value and flood magnitudes stop being distinguishable; nor are
          the polynomial fits guaranteed monotonic. The banner above the corrected metrics counts
          both; the variant is withheld when essentially everything clamps. With no assignment for
          a reach, SABER's scalars are exactly 1.0 — an identity, so any movement is fitting error
          around a no-op.
        </p>
        <p style={p}>
          Which to prefer depends on the reach and shows in the diagnostics, not in advance: past
          the model's simulated range the local is withheld, leaving the global; with a long,
          well-spread record the local is better fitted.
        </p>

        <h3 style={h3}>The local FDC mapping, in detail</h3>
        <p style={p}>
          The GEOGLOWS training material covers both:{' '}
          <a href="https://training.geoglows.org/rfs/bias-correction/bias-correction/" style={link} target="_blank" rel="noreferrer">
            bias correction
          </a>{' '}
          generally,{' '}
          <a href="https://training.geoglows.org/rfs/bias-correction/forecasted-bias-correction/" style={link} target="_blank" rel="noreferrer">
            forecasted bias correction
          </a>{' '}
          for forecasts.
        </p>
        <p style={p}>
          A TypeScript port of <code>geoglows.bias.correct_forecast</code> (the Python package
          keeps the programme name), verified bit-for-bit against it. Monthly empirical quantile
          mapping:
        </p>
        <ul style={ul}>
          <li>
            Build a histogram CDF from the simulated retrospective for the forecast's calendar
            month; convert each forecast value to an exceedance probability.
          </li>
          <li>
            Build the uploaded observed record's CDF for the same month; read the flow back out at
            that probability.
          </li>
          <li>
            The forecast now sits on the observed distribution's scale, clipped at zero.
          </li>
        </ul>
        <p style={p}>
          Correction applies to raw forecast values <em>before</em> lead bucketing and grid
          aggregation: quantile mapping is nonlinear, so correcting a daily mean differs from
          averaging corrected sub-daily values.
        </p>
        <p style={p}>
          It needs the <strong>historical observations</strong> upload, not the event CSV: a few
          days cannot form a monthly distribution. It also gates CRPSS, which needs an observed
          climatological baseline.
        </p>

        <h3 style={h3}>Limits worth knowing</h3>
        <ul style={ul}>
          <li>
            <strong>Extreme forecasts can map to infinity.</strong> Bins deliberately extend past
            the data, so each CDF's top is flat and un-invertible: above the simulated monthly
            maximum a forecast can map to infinity on a floating-point margin between the two
            CDFs. Such runs are excluded whole with the reason shown; dropping only the offending
            timesteps would delete exactly the peaks and flatter the rest.
          </li>
          <li>
            <strong>Low flows keep their raw values:</strong> below the simulated monthly minimum
            the mapping is likewise undefined, so the reference implementation retains the original
            number. The banner reports the count: such values look entirely plausible.
          </li>
          <li>
            <strong>The distributions are daily.</strong> Forecasts are typically sub-daily, so
            their peaks compress toward the observed daily maximum: β and KGE′ can improve while
            peak magnitude degrades.
          </li>
          <li>
            <strong>A short observed record lowers the ceiling:</strong> the mapping cannot produce
            a flow larger than the record holds that month, so a few years of data visibly
            flattens extreme forecasts.
          </li>
          <li>
            <strong>The correction is in-sample:</strong> your observed record almost certainly
            contains the event verified, so corrected scores are optimistic by an unquantified
            amount.
          </li>
          <li>
            <strong>A dry month collapses the mapping.</strong> An all-zero observed month drives
            every corrected value to almost zero; the banner flags a flat record.
          </li>
        </ul>
        <p style={p}>
          Bias correction fixes magnitude, not skill: wrong timing or hydrograph shape — visible
          as low r — is beyond it, so distrust a corrected score that improves sharply while r
          stays poor.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2}>The dual-threshold design</h2>

        <h3 style={h3}>Motivation</h3>
        <p style={p}>
          Global hydrological forecasts are hard to verify because the model's{' '}
          <em>climatology</em> differs from the observed one. RFS produces streamflow by routing
          numerical weather prediction output through a hydrological model, so return-period
          thresholds from that simulated climatology differ systematically from those from observed
          gauge records.
        </p>
        <p style={p}>
          Classifying observation and forecast against the same threshold — observed 2-year return
          period 82 m³/s, simulated 33 m³/s — biases every categorical metric systematically.
        </p>

        <h3 style={h3}>Implementation</h3>
        <p style={p}>The framework uses a dual-threshold approach:</p>
        <ul style={ul}>
          <li>
            <strong>Observations</strong> — classified using return periods from the observed
            annual maxima series, Gumbel-fitted.
          </li>
          <li>
            <strong>Forecasts</strong> — classified using return periods from the RFS retrospective
            daily simulation, also Gumbel-fitted.
          </li>
        </ul>

        <h3 style={h3}>Return-period categories</h3>
        <p style={p}>
          The contingency matrix defines categories dynamically: the number follows the maximum
          return period the observed event exceeded.
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
        <p style={p}>
          <strong>Bands here, exceedances elsewhere.</strong> A matrix cell really is a band —
          "2–5 yr" means at or above the 2-year level and below the 5-year one. The per-threshold
          score table and the CSI panel are different: each of their rows is a{' '}
          <em>dichotomisation</em>, "at or above the k-th level", which lumps every band above k in
          with it. So a row labelled ≥2yr there includes the 100-year days too. The two labellings
          look similar and mean different things, which is why the rows are labelled ≥2yr, ≥5yr and
          so on rather than 2–5yr, 5–10yr.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2}>Forecast reorganization by lead time</h2>

        <h3 style={h3}>The challenge: multiple initialization dates</h3>
        <p style={p}>
          RFS issues a new ensemble forecast every day, each covering a different 15-day window,
          so a flood event spanning, say, 4 days is spanned by initializations from the preceding 15 days plus
          the event days.
        </p>
        <p style={p}>
          To verify skill <em>as a function of lead time</em>, the framework asks not what the
          forecast initialized on date X predicted, but what all forecasts at <em>d</em> days of
          lead time predicted.
        </p>

        <h3 style={h3}>Lead-time definition</h3>
        <p style={pMono}>d = ⌈ (t − t₀) / 24 h ⌉</p>
        <p style={p}>
          Lead time <em>d</em> of forecast timestep <em>t</em> relative to initialization time
          t₀ uses ceiling-based 24-hour windows:
        </p>
        <ul style={ul}>
          <li>
            <strong>Lead 0</strong>: the initialization timestep itself (t = t₀).
          </li>
          <li>
            <strong>Lead 1</strong>: (0 h, 24 h] after initialization — the first forecast day.
          </li>
          <li>
            <strong>Lead d</strong>: ((d−1)·24 h, d·24 h].
          </li>
        </ul>

        <h3 style={h3}>Procedure</h3>
        <p style={p}>
          Each forecast timestep goes into its lead-day bucket; buckets are concatenated across
          initialization dates into one dataframe per lead day, which feeds the verification
          metrics.
        </p>
        <p style={p}>
          Beforehand the 3-hourly ensemble members are linearly interpolated to hourly resolution,
          matching the hourly observed gauge record. Straight-line interpolation cannot overshoot
          or undershoot the original points, so the interpolated peak equals the native peak.
        </p>

        <h3 style={h3}>Event window limit</h3>
        <p style={p}>
          The event start and end on the Forecast tab are capped at{' '}
          <strong>31 days</strong> apart; the app fetches every initialization from 15 days before
          the start through the end, so a 31-day event pulls 46 runs. The cap exists because the
          download and every metric scale with that count, and because a window much longer than
          the flood dilutes the categorical scores: quiet timesteps pile up in the lowest category
          and inflate MCC and HSS (see those metrics).
        </p>

        <h3 style={h3}>Initialization window</h3>
        <p style={p}>
          The download spans <strong>15 days before the event start</strong> through the event
          end, giving every lead time from 0 to 15 days at least one contributing initialization.
          An event of D days yields 15 + D initialization dates — longer events, larger samples
          per lead-day bucket.
        </p>

        <h3 style={h3}>Interpretation caveat: initialization pooling</h3>
        <p style={p}>
          Pooling initialization dates means one observed timestep may appear{' '}
          <em>more than once</em> — once per initialization whose lead-<em>d</em> window covers
          it. The flood peak falls in the lead-3 window of one initialization, the lead-4 window
          of the next, and so on, all compared against the same observed value.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2}>Metrics</h2>

        <h3 style={h3}>Categorical — Contingency matrix</h3>
        <p style={p}>
          A K × K table, K being the number of return-period categories. Element C
          <sub>ij</sub> counts timesteps with observation in category{' '}
          <em>i</em> (row), forecast in category <em>j</em> (column).
        </p>
        <ul style={ul}>
          <li>
            <strong>Lower triangle</strong> (i &gt; j): observation above forecast →
            underestimation.
          </li>
          <li>
            <strong>Upper triangle</strong> (i &lt; j): observation below it → overestimation.
          </li>
        </ul>
        <p style={p}>
          A perfect forecast is non-zero only on the diagonal; following the WMO/WWRP framework and
          Hewson (2007), all off-diagonal elements count as errors — a binary table's "misses +
          false alarms".
        </p>

        <h3 style={h3}>Categorical — Matthews Correlation Coefficient (MCC)</h3>
        <p style={pMono}>
          MCC = (N·c − Σ tₖpₖ) / √[(N² − Σ pₖ²)(N² − Σ tₖ²)]
        </p>
        <p style={p}>
          The multi-category MCC (Gorodkin, 2004; Jurman et al., 2012) generalizes the binary MCC.
          From the contingency matrix: N total count, c diagonal sum (hits), tₖ row sum for category
          k (observed marginals), pₖ column sum (forecast marginals). The numerator is excess hits
          over a random forecast with the same marginals; the denominator normalizes it. The binary
          form spans [−1, 1]; the multi-category form reaches 1 but its lower bound depends on the
          category count and the marginals, so a negative value has no fixed reference.
        </p>
        <p style={p}>
          MCC = 1 is perfect agreement, 0 no better than random. A model always predicting{' '}
          "&lt; 2 yr" through a flood event scores exactly zero despite many hits: its forecast
          marginal collapses into one column, degenerating the denominator — desirable in a
          flood-skill metric.
        </p>
        <div style={caution}>
          <p style={{ margin: 0 }}>
            <strong>Both scores move with the length of the uploaded window.</strong> Quiet
            timesteps pile into the "both below the lowest threshold" cell and dominate the
            marginals. At fixed forecast skill, padding with quiet days lifts a forecast that
            captures the event from MCC 0.45 to 0.82, and one{' '}
            <em>systematically one category low</em> throughout from −0.50 to +0.35 — correctly
            damning to apparently skilful. Slow-rising events suffer most: long limbs below
            threshold while the river is plainly doing something. Read these alongside the pair
            count and base rate, never as headline numbers, never across events of different window
            length.
          </p>
          <p style={{ margin: '0.5rem 0 0' }}>
            <strong>Nor are they independent checks.</strong> The MCC and HSS formulae share the
            numerator N·c − Σ tₖpₖ and differ only in denominator: they cannot disagree on sign, so
            agreement is arithmetic, not corroboration. The multi-category MCC also has no floor of
            −1 — the bound depends on category count and marginals — so negative values have no
            fixed reference.
          </p>
          <p style={{ margin: '0.5rem 0 0' }}>
            Only scores that exclude correct negatives — the critical success index, a/(a+b+c), and
            F1 — are exactly invariant to window length. Rare-event scores, EDI and SEDI included,
            are <em>not</em>: padding drives their false-alarm rate to zero and they climb toward 1
            regardless of skill.
          </p>
        </div>

        <h3 style={h3}>Categorical — Heidke Skill Score (HSS)</h3>
        <p style={pMono}>HSS = (N·c − Σ tₖpₖ) / (N² − Σ tₖpₖ)</p>
        <p style={p}>
          HSS measures improvement over a random forecast: HSS = (PC − PC<sub>ref</sub>) / (1 − PC
          <sub>ref</sub>), PC the proportion correct, PC<sub>ref</sub> that expected by chance.
        </p>
        <p style={p}>
          Its denominator is the largest the shared numerator could be given the marginals, so HSS
          is the fraction of the gap between chance and perfection that the forecast closes. MCC
          divides instead by the geometric mean of the two marginal spreads, making it the
          correlation between forecast and observed category.
        </p>
        <div style={caution}>
          <p style={{ margin: 0 }}>
            <strong>Their order is fixed by the sign, not by where the skill came from.</strong>{' '}
            MCC's denominator is never larger than HSS's, so any forecast better than chance has
            MCC ≥ HSS necessarily, and any forecast worse than chance has MCC ≤ HSS. Across 60,000
            contingency matrices this held without exception, and MCC fell below HSS while both
            were positive in zero cases. So "MCC much lower than HSS" cannot indicate skill earned
            on normal flow rather than the extreme — it cannot happen at all unless the forecast is
            already worse than chance, where MCC simply reports the failure more sharply.
          </p>
          <p style={{ margin: '0.5rem 0 0' }}>
            What the gap between them does measure is <strong>frequency bias</strong>: how far the
            forecast's category frequencies sit from the observed ones. Matched marginals make the
            two denominators equal and the scores identical; skewed marginals separate them. That
            is a property of how often each category was issued, not of which flows the skill came
            from.
          </p>
        </div>

        <h3 style={h3}>Categorical — Ranked probability score (RPS, RPSS)</h3>
        <p style={pMono}>
          RPS = Σₖ (CDF<sub>forecast</sub>(k) − CDF<sub>observed</sub>(k))²{'\n'}
          RPSS = 1 − RPS / RPS<sub>climatology</sub>
        </p>
        <p style={p}>
          The only categorical score here that knows the categories are <strong>ordered</strong>.
          Differencing <em>cumulative</em> probabilities means the penalty grows with distance: on a
          four-category ladder a confident forecast one category low scores 1, two low scores 2,
          three low scores 3. MCC and HSS return the same value for all three, discarding the
          severity ladder the return-period design exists to express.
        </p>
        <p style={p}>
          It also reads the ensemble as an ensemble. MCC and HSS score each of the 51 members as a
          separate deterministic forecast and take the median of those scores; RPS uses the fraction
          of members in each category as a probability distribution, so a spread that straddles the
          truth is rewarded over confident error.
        </p>
        <p style={p}>
          Report <strong>RPSS</strong> when comparing across events. Raw RPS is a mean over
          timesteps, so quiet days drag it toward zero whatever the skill — but the climatological
          reference absorbs the same easy timesteps, so the ratio barely moves: measured drift is
          about 0.01 across an 800-fold increase in window length, against 0.37 for MCC.
        </p>
        <p style={p}>
          <strong>What the reference is, exactly.</strong> RPSS and CRPSS are both skill scores —
          the number means nothing without saying what it was compared against — so both use one
          rule, and it is worth stating in full:
        </p>
        <ul style={ul}>
          <li>
            <strong>Observed, never modelled.</strong> Built from the uploaded gauge record. A
            baseline carrying the model's own bias is too easy to beat.
          </li>
          <li>
            <strong>Season-restricted to ±15 days</strong> of the event's calendar days. Not an
            average of those days — a filter: every individual reading from every year whose day of
            year falls in that window, pooled into one distribution. A whole-record baseline would
            have to predict a wet-season flood from the dry season's distribution, so beating it
            would partly reward the forecast for knowing what month it is. Measured on a seasonal
            record, the two disagree fourfold on how often the 2-year threshold is crossed
            (0.0102 whole-record against 0.0419 in season). The window wraps across New Year.
          </li>
          <li>
            <strong>Aggregated the same way the scored observations are.</strong> Whatever bin
            summary the Categorical block is set to — median by default — the reference uses it too.
            A reference summarised differently is answering a different question: on a 15-minute
            record, one built from raw readings expects exceedance 96× less often than a matched
            one, because most readings within a day sit below that day's peak.
          </li>
          <li>
            <strong>Withheld rather than estimated.</strong> With no historical upload, or fewer
            than 30 values in season, no skill score is shown. The alternative is a baseline built
            from the very event being scored, which is circular. RPS and CRPS are proper scores and
            are still reported; only the skill scores need a reference.
          </li>
          <li>
            <strong>Withheld when the reference was never tested.</strong> If nothing in the window
            crossed even the lowest threshold, climatology is right by default, its score collapses
            toward zero, and the ratio explodes — measured RPSS of −3421 on an ordinary near-miss
            event, which then sets the panel's axis. RPSS is withheld there and says so.
          </li>
        </ul>

        <h3 style={h3}>Categorical — Scores per exceedance threshold</h3>
        <p style={pMono}>
          POD = a/(a+c)   FAR = b/(a+b)   CSI = a/(a+b+c)   bias = (a+b)/(a+c){'\n'}
          a hits · b false alarms · c misses · d correct negatives
        </p>
        <p style={p}>
          These are two-by-two scores, so the K-category matrix is dichotomised at each threshold —
          "at or above this return period" against "below" — giving one row per level rather than a
          single number. The trend down the rows is the point: hit rate falling and false-alarm
          ratio rising as severity climbs is skill decaying with magnitude, which any collapsed
          number hides.
        </p>
        <p style={p}>
          <strong>None of the four uses d</strong>, the correct-negative cell, so all are exactly
          invariant to window length — adding 100,000 quiet timesteps leaves every value unchanged
          to twelve decimals, while MCC and HSS drift substantially. They are the antidote to the
          window sensitivity described above.
        </p>
        <p style={p}>
          <strong>Frequency bias is not a skill score</strong>, and that is what makes it useful.
          It is how many exceedances were forecast divided by how many occurred, so 1.0 means the
          right <em>number</em> of warnings whether or not they landed on the right days. It is also
          what the gap between MCC and HSS measures indirectly: matched category frequencies make
          those two scores identical, and the correlation between their gap and |log bias| is 0.72.
        </p>
        <p style={p}>
          <strong>Read it as a warning-count check, not a magnitude-bias detector.</strong> Under a
          single threshold, a model running 40% low would read below 1 at every level and decay
          toward 0 at the top — the classic fingerprint of under-prediction. The dual-threshold
          design removes exactly that signal on purpose: the forecast is judged against its own
          simulated return periods, which are fitted to the same biased model, so a uniformly low
          model crosses its own thresholds about as often as the observations cross theirs and
          frequency bias reads near 1. What survives is a mismatch in <em>shape</em> rather than
          level — an ensemble too narrow to reach its own thresholds as often as reality reaches
          hers. For magnitude bias, read β in the Accuracy block instead.
        </p>
        <p style={p}>
          The equitable threat score is deliberately absent. ETS = HSS / (2 − HSS) exactly, so it is
          a monotone relabelling of a score already shown, and it inherits the same window drift.
        </p>

        <h3 style={h3}>Categorical — CSI by lead day</h3>
        <p style={p}>
          CSI gets a panel of its own, with a threshold selector, because it is the only score here
          that is <strong>essentially exactly invariant</strong> to how long a window you uploaded.
          Padding an event with quiet days adds only correct negatives, and a/(a+b+c) never touches
          that cell. Measured across an 800-fold increase in window length: CSI moves 0.003, RPSS
          0.028, MCC 0.070, HSS 0.074. If the chance-corrected scores look healthier than this one,
          quiet timesteps are flattering them.
        </p>
        <p style={p}>
          It sits apart rather than on the MCC/HSS axis because it is a different kind of quantity.
          CSI is <strong>only defined on a two-by-two table</strong> — there is no accepted
          multi-category version, and the standard practice is one value per exceedance threshold,
          which is what the selector chooses. MCC and HSS grade all K categories at once. Collapsing
          to "at or above the 2-year level" is an easier question, and on a severe event CSI reads
          about 0.08 to 0.12 higher for that reason alone, so sharing an axis invited a false
          comparison. Every line in its own panel is the same kind of quantity, so that axis is fair.
        </p>
        <p style={p}>
          Scored on the 51 members <strong>pooled into one table per lead</strong>, not as the median
          of 51 separate scores. The median construction collapses at the high thresholds, where most
          members produce the same degenerate table — its ability to rank a known-better forecast on
          a single event measures 0.576, a coin flip. Sample size is reported as{' '}
          <em>distinct observed exceedance timesteps</em>: 51 members scoring the same three flood
          days is three events, not 153, and leads with fewer than three are drawn hollow.
        </p>
        <p style={p}>
          It is not a skill score. 0 means no hits were scored, not "no better than chance". Where
          nothing was observed <em>and</em> nothing forecast at a level, it reads n/a rather than 0 —
          0 is the worst attainable value, and a lead where nothing happened has not earned it.
        </p>

        <h3 style={h3}>Timing — Peak timing error (Δt<sub>peak</sub>)</h3>
        <p style={pMono}>Δt_peak = t_peak,forecast − t_peak,observed  [hours]</p>
        <p style={p}>
          Δt<sub>peak</sub> &lt; 0 is an early forecast peak, &gt; 0 a late one.{' '}
          <strong>It is independent of magnitude</strong>: Δt = 0 for a member with correct timing
          and far-off magnitude. Take the median Δt across members as the headline statistic, the
          IQR as ensemble timing spread. An early bias is often preferable
          operationally — more preparation time for communities.
        </p>

        <h3 style={h3}>Timing — Threshold crossing</h3>
        <p style={pMono}>Δt_RP = t_crossing,forecast − t_crossing,observed  [hours]</p>
        <p style={p}>
          For each return-period threshold Q<sub>RP</sub>, t<sub>crossing</sub> is the first
          ascending crossing — the first timestep at-or-above the threshold after being below.
          This beats peak timing operationally: flood early-warning systems alert on threshold
          exceedance, not peak arrival.
        </p>
        <p style={p}>Reported separately:</p>
        <ul style={ul}>
          <li>
            <strong>Detection rate</strong>: fraction of members crossing both the observed and
            forecast thresholds, so having a computable Δt<sub>RP</sub>.
          </li>
          <li>
            <strong>Conditional timing error</strong>: Δt<sub>RP</sub> over only those members.
          </li>
        </ul>
        <p style={p}>
          Detection rate typically falls as the threshold rises, exposing the limits of the
          ensemble's probabilistic coverage of extremes.
        </p>

        <h3 style={h3}>Accuracy — Kling–Gupta Efficiency (KGE')</h3>
        <p style={pMono}>KGE' = 1 − √[(r − 1)² + (β − 1)² + (γ − 1)²]</p>
        <p style={p}>
          Gupta et al. (2009) decomposed the MSE into three orthogonal components, refined by
          Kling et al. (2012); each is perfect at 1:
        </p>
        <ul style={ul}>
          <li>
            <strong>Correlation r</strong> — Pearson correlation of forecast and observation; lower
            means poor timing or shape.
          </li>
          <li>
            <strong>Bias ratio β</strong> = mean(forecast) / mean(observed); &gt; 1 overestimation
            bias, &lt; 1 underestimation.
          </li>
          <li>
            <strong>Variability ratio γ</strong> = CV<sub>f</sub> / CV<sub>o</sub>; &gt; 1
            overestimates variability, &lt; 1 underestimates.
          </li>
        </ul>
        <p style={p}>
          The dominant error source is the component furthest from 1.
        </p>

        <h3 style={h3}>Accuracy — Nash–Sutcliffe Efficiency (NSE)</h3>
        <p style={pMono}>NSE = 1 − Σ(f − o)² / Σ(o − ō)²</p>
        <p style={p}>
          Shown beside KGE′ on the skill panels. It is the mean-squared-error skill score against
          the observed average, so it is dominated by the largest errors — which on a flood window
          means the peak. Reading a row across the two is the diagnosis: strong on KGE′ but weak on
          NSE usually means the shape was right and the magnitude was not, because NSE punishes
          squared error at the peak while KGE′ spreads the penalty across three components.
        </p>

        <h3 style={h3}>Performance bands, and what they rest on</h3>
        <p style={p}>
          The skill panels colour each bar by band. The KGE′ ladder is the published one — Good
          above 0.75, Intermediate 0.50–0.75, Poor 0.00–0.50 — from{' '}
          <a
            href="https://doi.org/10.5194/hess-19-3365-2015"
            style={link}
            target="_blank"
            rel="noreferrer"
          >
            Thiemig et al. (2015)
          </a>
          , citing Kling et al. (2012). Two honest caveats come with it.
        </p>
        <ul style={ul}>
          <li>
            <strong>The published ladder has four bands, not five.</strong> Its bottom band is Very
            poor at ≤ 0.00. Splitting that at −0.41 into Very poor and Unacceptable is this app's
            own extension, grafting the benchmark below onto Thiemig's scheme. No source publishes
            0.75/0.50 together with a −0.41 floor.
          </li>
          <li>
            <strong>It was calibrated on a different problem.</strong> Thiemig applied it to daily
            multi-year continuous simulation. For the <em>forecast</em> half of the same paper the
            authors used skill scores against explicit benchmarks and no KGE bands at all.
          </li>
        </ul>
        <p style={p}>
          <strong>−0.41 is the mean-flow benchmark</strong> — the score of a forecast equal to the
          observed mean at every timestep. Above it a model improves on that benchmark even when its
          score is negative, which is the trap the bands exist to avoid: a KGE′ of −0.2 is not
          "bad", it beats doing nothing. It transfers from KGE to KGE′ because a flat forecast has
          zero variability either way. NSE is keyed to <strong>0</strong> instead, its own mean-flow
          benchmark, since it is already normalised by the observed variance — so the two panels are
          coloured on different scales, with different palettes and separate legends to say so.
        </p>
        <p style={caution}>
          <strong>On one event, −0.41 is not the climatology line.</strong> It is the best score any
          flat forecast can reach, and only the flat forecast equal to <em>this window's</em>{' '}
          observed mean reaches it — a hindsight quantity. Real seasonal climatology scored over a
          21-day flood window measured KGE′ −0.22, over ±5 days around the crest 0.00, and over ten
          continuous years +0.42. The −0.41 line never moves and coincides with climatology at no
          window length. So read "below the benchmark" as "worse than a flat line", which is true,
          rather than "worse than climatology", which is not. Band names also shift with the window
          you chose: the same synthetic forecast reads Good over ±20 days and Poor over ±5 days
          around the crest, because the observed variability the scores normalise by is the
          window's.
        </p>

        <h3 style={h3}>Probabilistic — Continuous Ranked Probability Score (CRPS)</h3>
        <p style={pMono}>
          CRPS = (1/M) Σ |Xₘ − Q_obs| − (1/2M²) Σ Σ |Xₘ − Xₘ'|
        </p>
        <p style={p}>
          CRPS scores the ensemble as a probability distribution, not member by member. In the
          energy-score form (Gneiting &amp; Raftery, 2007) the first term is the members' mean
          absolute error against the observation (penalizes bias), the second half their mean
          pairwise absolute difference (rewards spread). Units: discharge (m³/s).
        </p>
        <ul style={ul}>
          <li>
            <strong>Perfect score</strong> CRPS = 0; <strong>lower is better</strong>; no upper
            bound.
          </li>
          <li>
            <strong>Proper scoring rule</strong>: a forecaster cannot game CRPS by over- or
            under-dispersing the ensemble.
          </li>
          <li>
            One value per lead day; averaging over all timesteps dilutes extreme peaks among many
            normal-flow timesteps, so a moderate CRPS may hide a catastrophic failure at the peak.
          </li>
        </ul>
        <p style={p}>
          <strong>CRPSS</strong> uses the same climatological reference rule as RPSS, set out under
          Ranked probability score above: observed rather than modelled, restricted to ±15 days of
          the event's calendar days, aggregated the way the scored observations are, and withheld
          rather than estimated when there is no record or too little of it falls in season. The two
          skill scores used to be built differently — CRPSS season-restricted and refused to guess,
          RPSS did neither — so the same app made two claims about what a fair baseline is. They now
          share one implementation.
        </p>
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
const caution: React.CSSProperties = {
  margin: '0.75rem 0',
  padding: '0.8rem 1rem',
  border: '1px solid #fcd34d',
  background: '#fffbeb',
  borderRadius: 6,
  fontSize: '0.9rem',
  lineHeight: 1.6,
  color: '#713f12',
};
const link: React.CSSProperties = { color: '#1d4ed8', textDecoration: 'underline' };
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
