import { useApp } from '../state/appState';
import { PROSE_MAX } from '../prose';
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
        <p style={p}>
          To use it you need two things: a nine-digit reach ID identifying the river segment in RFS,
          and observed discharge for that gauge. Upload as long a historical record as you have — it
          is what the return-period thresholds are fitted to, and it gates the skill scores and the
          local bias correction. The event itself can come either from dates you enter or from a
          separate file covering just that period.
        </p>

        <h3 style={h3}>Why ensemble verification is different</h3>
        <p style={p}>
          A deterministic forecast gives one value; an ensemble gives a{' '}
          <em>distribution</em> of possible futures — 51 perturbed members:
        </p>
        <ul style={ul}>
          <li>
            Some metrics evaluate <strong>each member independently</strong> as a deterministic
            forecast, then summarise those 51 scores — MCC, HSS, NSE, KGE′, peak timing error.
          </li>
          <li>
            Others evaluate the <strong>ensemble as a collective distribution</strong> — CRPS, and
            RPS, which reads the fraction of members in each severity category as a probability. A
            spread that straddles the truth is rewarded over confident error, which no per-member
            score can express.
          </li>
          <li>
            <strong>Spread is a result, not a defect.</strong> Members disagreeing is the forecast
            stating how certain it is; the failure case is the opposite, a narrow spread around the
            wrong answer. Only the collective scores can see it.
          </li>
        </ul>

        <h3 style={h3}>Structure of the verification framework</h3>
        <p style={p}>
          This web application divides the forecast evaluation into four families of metrics. None
          alone tells the whole story — good timing can accompany poor magnitude, good categorical
          skill poor probabilistic calibration — so read them together as a diagnostic portrait of
          model behavior.
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

        <h3 style={h3}>Handling mismatched resolutions</h3>
        <p style={p}>
          Uploaded observations arrive at any interval — 15-minute, hourly, daily; RFS publishes at
          its own. Comparison happens at the coarser of the two: the finer series is aggregated down,
          the coarser never interpolated up. Interpolating up would invent samples the data does not
          contain and let every metric count them as evidence.
        </p>

        <h3 style={h3}>RFS Forecast</h3>
        <p style={p}>
          The forecast's spacing changes partway through its horizon — finer early, coarser late,
          with all 51 members sharing one time index. The comparison grid is taken from lead 1, the
          densest day a run publishes. So later leads carry fewer pairs, because fewer values were
          published rather than worse ones, and each lead is gated on its own count — long leads
          blank out first. A peak at a coarse lead can only be placed on a sample that exists, so
          timing bars there are drawn hollow when the difference is smaller than the spacing.
        </p>

        <h3 style={h3}>How a bin is summarised</h3>
        <p style={p}>
          When several timesteps fall in one grid bin they have to become one number. The error and
          distribution metrics — CRPS, CRPSS, NSE, KGE′ — always use the mean, which preserves volume
          and shape. The categorical and timing families use your choice, defaulting to the median.
        </p>
        <p style={p}>
          That choice matters because your return-period thresholds are fitted to the record you
          upload, at whatever resolution it arrived in: a daily record gives a threshold on daily
          means, a 15-minute record one on instantaneous peaks. Neither extreme is safe — the
          maximum over-counts exceedances on an ordinary bin, while the median and mean erase a
          short, sharp peak. The median is the default because it puts the same kind of quantity on
          both sides of the comparison. If the choice would change your event's classification, the
          Categorical block says so.
        </p>
        <p style={p}>
          None of this matters unless your data is finer than the grid: on a daily gauge with a daily
          grid every bin holds one value and all three agree.
        </p>

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
          The categorical metrics need no correction. Their <strong>dual-threshold design</strong> —
          explained below — compares observations against observed return periods and forecasts
          against simulated ones, so magnitude bias cancels out. Correcting the forecasts as well
          would apply the same adjustment twice. The contingency matrix, MCC, HSS, CSI, the
          per-threshold scores, RPS and the timing metrics are therefore left raw, and corrected
          variants appear only under <strong>Accuracy</strong> and <strong>Probabilistic</strong>.
        </p>

        <h3 style={h3}>Bias Correction Methods</h3>
        <p style={p}>
          Both blocks offer <strong>Raw</strong> plus two corrected options. Raw is the forecasts you
          would normally receive from RFS.
        </p>
        <p style={p}>
          Both fit on the retrospective against observations, then apply that transform to forecasts
          — assuming both share the same error. This is not an accurate assumption in all cases.
        </p>
        <ul style={ul}>
          <li>
            <strong>Local Bias Correction</strong> — the classic GEOGLOWS method, monthly flow
            duration curve quantile mapping (MFDC-QM), evaluated in{' '}
            <a href="https://doi.org/10.1016/j.envsoft.2024.106235" style={link} target="_blank" rel="noreferrer">
              Sanchez Lozano et al. (2025)
            </a>. Fitted to your reach from the record you upload, and inheriting that record's
            sparsity. Detailed below.
          </li>
          <li>
            <strong>SABER</strong> — Stream Analysis for Bias Estimation and Reduction, the RFS
            "Global Bias Correction", as described in{' '}
            <a href="https://doi.org/10.3390/hydrology9070113" style={link} target="_blank" rel="noreferrer">
              Hales et al. (2022)
            </a>. Same premise, fitted centrally: simulated against observed curves at gauged
            reaches, watersheds clustered by flow behaviour so <em>ungauged</em> reaches borrow from
            gauged ones, coefficients published per river and calendar month. It needs nothing from
            you. It is still experimental.
          </li>
        </ul>
        <p style={p}>
          <strong>Both use gauge data</strong>; the difference is <em>whose</em>. Local Bias
          Correction uses your uploaded record — directly relevant, as sparse as it is. SABER's
          gauges are chosen centrally, possibly at a <em>different, clustered</em> reach: better
          sampled, not necessarily this river.
        </p>

        <h3 style={h3}>Learning more</h3>
        <p style={p}>
          To learn more about how bias correction works, visit the GEOGLOWS training materials:{' '}
          <a href="https://training.geoglows.org/rfs/bias-correction/bias-correction/" style={link} target="_blank" rel="noreferrer">
            bias correction
          </a>{' '}
          generally,{' '}
          <a href="https://training.geoglows.org/rfs/bias-correction/forecasted-bias-correction/" style={link} target="_blank" rel="noreferrer">
            forecasted bias correction
          </a>{' '}
          for forecasts.
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
          Nothing is interpolated up. Comparison happens at the <em>coarser</em> of the two
          cadences and the finer series is aggregated down, as the Temporal resolution section
          above describes — upsampling would manufacture samples that were never measured and let
          every metric count them as evidence.
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
          Within a single lead day the windows are disjoint — 24 hours wide, initializations 24
          hours apart — so a timestep belongs to exactly one initialization there. The reuse is{' '}
          <em>across</em> leads: the flood peak falls in the lead-3 window of one initialization,
          the lead-4 window of the previous one, and so on, so the same observed value is scored
          again at every lead. Lead days are therefore not independent samples of the same event,
          and a run of them agreeing is not sixteen confirmations.
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
        <p style={p}>
          <strong>This is the one panel that reduces the ensemble to a single series</strong>, since
          a K×K table needs one forecast category per timestep. The{' '}
          <em>Forecast series</em> selector chooses how: the ensemble median by default, or its mean,
          p25, p75, min, max, or any individual member. Reducing to the{' '}
          <strong>maximum</strong> asks "did <em>any</em> member cross", which with 51 members
          crosses far more readily than the median — a different question, not a stricter version of
          the same one. Every other categorical score on this page reads all 51 members, so this
          selector moves the matrix and nothing else.
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
          <p style={{ maxWidth: PROSE_MAX, margin: 0 }}>
            <strong>Both scores move with the length of the uploaded window.</strong> Quiet
            timesteps pile into the "both below the lowest threshold" cell and dominate the
            marginals. At fixed forecast skill, padding with quiet days lifts both scores
            substantially — enough to carry a forecast that is <em>systematically one category
            low</em> throughout from correctly damning to apparently skilful. Slow-rising events suffer most: long limbs below
            threshold while the river is plainly doing something. Read these alongside the pair
            count and base rate, never as headline numbers, never across events of different window
            length.
          </p>
          <p style={{ maxWidth: PROSE_MAX, margin: '0.5rem 0 0' }}>
            <strong>Nor are they independent checks.</strong> The MCC and HSS formulae share the
            numerator N·c − Σ tₖpₖ and differ only in denominator: they cannot disagree on sign, so
            agreement is arithmetic, not corroboration. The multi-category MCC also has no floor of
            −1 — the bound depends on category count and marginals — so negative values have no
            fixed reference.
          </p>
          <p style={{ maxWidth: PROSE_MAX, margin: '0.5rem 0 0' }}>
            Only scores that exclude the correct-negative cell are invariant to window length. Of
            those shown here that means CSI = a/(a+b+c), POD, FAR and frequency bias. Rare-event
            scores built on the false-alarm <em>rate</em> are not invariant — padding drives that
            rate to zero and they climb toward 1 regardless of skill — which is one reason none is
            offered.
          </p>
        </div>

        <h3 style={h3}>Categorical — Heidke Skill Score (HSS)</h3>
        <p style={pMono}>HSS = (N·c − Σ tₖpₖ) / (N² − Σ tₖpₖ)</p>
        <p style={p}>
          HSS measures improvement over a random forecast: HSS = (PC − PC<sub>ref</sub>) / (1 − PC
          <sub>ref</sub>), PC the proportion correct, PC<sub>ref</sub> that expected by chance.
        </p>
        <p style={p}>
          Its denominator is the gap between a perfect forecast and chance, N² − Σtₖpₖ, so HSS is
          the fraction of that gap the forecast closes. Note "perfect" here is the unconstrained
          ideal, not the best attainable given these marginals — with mismatched marginals a
          forecast cannot reach 1 however well it ranks. MCC
          divides instead by the geometric mean of the two marginal spreads, making it the
          correlation between forecast and observed category.
        </p>
        <div style={caution}>
          <p style={{ maxWidth: PROSE_MAX, margin: 0 }}>
            <strong>Their order is fixed by the sign, not by where the skill came from.</strong>{' '}
            MCC's denominator is never larger than HSS's, so any forecast better than chance has
            MCC ≥ HSS necessarily, and any forecast worse than chance has MCC ≤ HSS. Across
            60,000 contingency matrices it held without exception, and MCC fell below HSS while both
            were positive in zero cases — a deterministic sweep kept as a test in this repository, so
            the figure is reproducible rather than remembered. So "MCC much lower than HSS" cannot indicate skill earned
            on normal flow rather than the extreme — it cannot happen at all unless the forecast is
            already worse than chance, where MCC simply reports the failure more sharply.
          </p>
          <p style={{ maxWidth: PROSE_MAX, margin: '0.5rem 0 0' }}>
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
          reference absorbs the same easy timesteps, so the ratio moves far less. It is still not
          window-invariant: only the scores that omit the correct-negative cell are, as{' '}
          <em>Scores per exceedance threshold</em> sets out below.
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
            would partly reward the forecast for knowing what month it is.
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
          "at or above this return period" against "below" — giving one row per threshold rather
          than a single number. There are K−1 rows for K categories: the lowest band gets no row,
          because "at or above the bottom of the scale" is everything. The trend down the rows is the point: hit rate falling and false-alarm
          ratio rising as severity climbs is skill decaying with magnitude, which any collapsed
          number hides.
        </p>
        <p style={p}>
          <strong>None of the four uses d</strong>, the correct-negative cell, so all four are
          exactly invariant to window length: adding 100,000 quiet timesteps leaves every value
          unchanged to twelve decimals, while MCC and HSS drift substantially. They are the antidote
          to the window sensitivity described above.
        </p>
        <p style={p}>
          <strong>Exactly invariant to padding, not to re-windowing.</strong> Those are different
          experiments and the distinction matters. Adding pure quiet timesteps cannot move a score
          that ignores the correct-negative cell — that is algebra, not measurement. Genuinely
          <em>extending</em> a window adds timesteps that get classified, some as hits or false
          alarms, so even these scores move a little. They move far less than MCC and HSS do, which
          is the property that makes them the antidote.
        </p>
        <p style={p}>
          <strong>Frequency bias is not a skill score</strong>, and that is what makes it useful.
          It is how many exceedances were forecast divided by how many occurred, so 1.0 means the
          right <em>number</em> of warnings whether or not they landed on the right days. It is also
          what the gap between MCC and HSS measures indirectly: matched category frequencies make
          those two scores identical, and skewed ones separate them.
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
          CSI gets a panel of its own, with a threshold selector, because it is the{' '}
          <strong>window-invariant</strong> score given a by-lead view. Padding an event with quiet
          days adds only correct negatives, and a/(a+b+c) never touches that cell. POD, FAR and
          frequency bias share that property — see <em>Scores per exceedance threshold</em> — but
          CSI is the one that combines hits, misses and false alarms into a single number, which is
          what makes it worth plotting against lead. If the chance-corrected scores look healthier
          than this one, quiet timesteps are flattering them.
        </p>
        <p style={p}>
          It sits apart rather than on the MCC/HSS axis because it is a different kind of quantity.
          CSI is <strong>only defined on a two-by-two table</strong> — there is no accepted
          multi-category version, and the standard practice is one value per exceedance threshold,
          which is what the selector chooses. MCC and HSS grade all K categories at once. Collapsing
          to "at or above the 2-year level" is an easier question, and CSI reads higher for that
          reason alone, so sharing an axis invited a false comparison. Every line in its own panel is the same kind of quantity, so that axis is fair.
        </p>
        <p style={p}>
          Scored on the 51 members <strong>pooled into one table per lead</strong>, not as the median
          of 51 separate scores. The median construction collapses at the high thresholds, where most
          members produce the same degenerate table — its ability to rank a known-better forecast on
          a single event is close to chance. Sample size is reported as{' '}
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
          IQR as ensemble timing spread. An early bias is often preferable operationally — more
          preparation time for communities.
        </p>
        <p style={p}>
          <strong>Read the resolution band before reading a bias.</strong> A peak can only be placed
          on a sample that exists, and a run publishes coarser samples at long lead, so at those
          leads the nearest available instant may be hours from the true crest. The panels shade
          that spacing as a grey band and draw a bar hollow when its median falls inside. This is not
          a theoretical caveat: on a <em>perfect</em> forecast against 3-hourly observations, a run
          coarsening after day 7 reports Δt = 0 through lead 7 and then a unanimous three-hour
          offset at leads 8–15. Tight box, clean step, entirely the lattice.
        </p>
        <p style={p}>
          <strong>Which members are excluded, and why it is never about quality.</strong> A member
          contributes no Δt in exactly two cases, both facts about the shape of its own series:
        </p>
        <ul style={ul}>
          <li>
            <strong>Flat throughout</strong> — the series attains its maximum at every timestep, so
            there is no argmax to time. Counted as "predicted no peak" rather than scored, and at
            long lead that count is the finding, not a timing number.
          </li>
          <li>
            <strong>Maximum on its own first or last sample</strong> — the real peak is probably
            outside the series, so Δt would be a bound rather than a measurement. Censored.
          </li>
        </ul>
        <p style={p}>
          Nothing is dropped for forecasting badly. A member that runs 55% low but times the crest
          perfectly still scores 0, which is exactly what makes this worth reading separately from
          KGE′. A member with a noisy, incoherent shape <em>is</em> scored, and its scatter is the
          finding rather than something to hide — so a wide band at long lead usually means the
          ensemble had no peak to agree on. The counts travel with every chart, because excluding
          anything without saying so is survivorship bias.
        </p>
        <p style={p}>
          A crest with a flat top is timed at its <strong>first</strong> sample, not its midpoint.
          Time-to-peak is when the flow reaches its maximum; the rest of the plateau is the crest
          holding rather than arriving. It also has to match the other side of the subtraction, since
          the observed peak keeps the first of any ties — timing the forecast at a plateau's midpoint
          would bias every such Δt late by half the plateau's width, an offset produced by the
          estimator rather than the forecast.
        </p>

        <h3 style={h3}>Timing — Threshold crossing</h3>
        <p style={pMono}>Δt_RP = t_crossing,forecast − t_crossing,observed  [hours]</p>
        <p style={p}>
          For each return-period threshold Q<sub>RP</sub>, t<sub>crossing</sub> is the first
          ascending crossing — the first in-window timestep at or above the threshold. If a series
          is already above at its first sample it counts as crossing there, which matters when the
          record itself starts mid-flood: both sides then register at the window edge and Δt_RP
          reads 0 for a crossing neither actually witnessed. This beats peak timing operationally:
          flood early-warning systems alert on threshold exceedance, not peak arrival.
        </p>
        <p style={p}>
          The table splits the members four ways at each lead, because a missing Δt<sub>RP</sub> has
          more than one cause and they mean opposite things:
        </p>
        <ul style={ul}>
          <li>
            <strong>Crossed</strong> — members crossing both thresholds, so having a computable
            Δt<sub>RP</sub>. The conditional timing error is taken over these alone.
          </li>
          <li>
            <strong>Observed crossed, forecast did not</strong> — a genuine miss.
          </li>
          <li>
            <strong>Observations never crossed</strong> — nothing to time against, and not a
            forecast failure at all.
          </li>
          <li>
            <strong>Total members</strong>, as the denominator for the other three.
          </li>
        </ul>
        <p style={p}>
          Detection rate falls as the threshold rises, but read the third column before drawing a
          conclusion from that. At the 50- and 100-year levels the observations usually never
          crossed either, so the fall is showing the event's severity rather than a limit of the
          ensemble.
        </p>
        <p style={p}>
          The whole crossing family needs the <strong>historical observations</strong> upload, since
          it compares observed return periods against simulated ones and the observed set is fitted
          to that record. Without it the panel is absent rather than approximate.
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
        <p style={p}>
          <strong>Each component is guarded on what it alone needs</strong>, which is why a member
          can appear in the β panel and not the KGE′ one. A forecast that is flat — every timestep
          the same value — still has a real mean, so β is reported; it has no variability, so γ reads
          0; and correlation is undefined, so r and KGE′ are withheld rather than filled in. That
          case is not hypothetical: transform saturation maps a whole range of discharges onto one
          number, and the negative clamp maps to exactly zero, so flat members are what the corrected
          variants produce. The bars carry their own member counts for this reason — the NSE and KGE′
          medians on one row can rest on different member sets.
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
          observed mean at every timestep, established by{' '}
          <a
            href="https://doi.org/10.5194/hess-23-4323-2019"
            style={link}
            target="_blank"
            rel="noreferrer"
          >
            Knoben, Freer &amp; Woods (2019)
          </a>
          : "KGE values greater than −0.41 indicate that a model improves upon the mean flow
          benchmark — even if the model's KGE value is negative." That is the trap the bands exist
          to avoid: a KGE′ of −0.2 is not "bad", it beats doing nothing. It carries over from KGE to
          KGE′ because a flat forecast has zero variability either way, stated for KGE′ directly by{' '}
          <a
            href="https://doi.org/10.5194/essd-12-2043-2020"
            style={link}
            target="_blank"
            rel="noreferrer"
          >
            Harrigan et al. (2020)
          </a>
          . NSE is keyed to <strong>0</strong> instead, its own mean-flow benchmark, since it is
          already normalised by the observed variance — so the two panels are coloured on different
          scales, with different palettes and separate legends to say so. NSE therefore has{' '}
          <strong>four</strong> bands where KGE′ has five: with its benchmark at 0 there is no gap
          between Poor and the benchmark, so at or below 0 it is Unacceptable directly. Do not carry
          the KGE′ ladder across.
        </p>
        <p style={caution}>
          <strong>On one event, −0.41 is not the climatology line.</strong> It is the best score any{' '}
          <em>flat</em> forecast can reach, and only the flat forecast equal to{' '}
          <em>this window's own</em> observed mean reaches it — a hindsight quantity. The algebra is
          short: a constant forecast has zero variability, so γ = 0 and r is undefined and taken as
          0, leaving KGE′ = 1 − √[2 + (c/μ&#x2092; − 1)²], maximised at c = μ&#x2092; to give exactly
          1 − √2.
        </p>
        <p style={caution}>
          A real seasonal climatology is a different and generally better forecast, and its own score
          depends on the window it is scored over — narrow windows around a crest score far worse
          than the whole record does. The −0.41 line never moves. So read "below the benchmark" as{' '}
          <strong>worse than a flat line</strong>, which is what it means, rather than "worse than
          climatology", which does not follow. Band names shift with the window you chose for the
          same reason: the observed variability these scores normalise by is the window's, not the
          river's.
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
          <strong>CRPSS</strong> follows the reference rules set out under Ranked probability score
          above — observed rather than modelled, restricted to ±15 days of the event's calendar days,
          and withheld rather than estimated — and shares one implementation with RPSS for the
          season filter and the 30-value minimum, so those cannot drift apart again.
        </p>
        <p style={p}>
          <strong>The two references are not identical, and should not be.</strong> The rule both
          follow is that a reference is aggregated the same way as the observations it will be scored
          against — which makes them differ, because those observations differ. RPS categorises the
          chosen-summary grid, so its reference uses your bin summary; CRPS is an error magnitude
          scored on the bin-<em>mean</em> grid, so its reference uses the mean. Same grid step, same
          season, same minimum; different summary, because forcing one on both would break the rule
          for whichever metric lost.
        </p>
        <p style={p}>
          One correction, since an earlier version of this page said the two "share one
          implementation" without qualification: they share the season rule, not the aggregation. The
          CRPSS reference was also being floored at daily resolution while CRPS itself was scored on
          the sub-daily grid — a narrower reference is easier to beat, and that inflated CRPSS by up
          to 0.09 near the climatological median, most where the verdict is marginal. Fixed, and
          both references now live in one module.
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
const caution: React.CSSProperties = { maxWidth: PROSE_MAX,
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
const p: React.CSSProperties = { maxWidth: PROSE_MAX, margin: '0.5rem 0', lineHeight: 1.55, color: '#222' };
const pMono: React.CSSProperties = { maxWidth: PROSE_MAX,
  margin: '0.5rem 0',
  padding: '0.5rem 0.75rem',
  background: '#f6f7f9',
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.95rem',
};
const ul: React.CSSProperties = { maxWidth: PROSE_MAX, margin: '0.4rem 0 0.6rem 1.25rem', lineHeight: 1.55, color: '#222' };
const table: React.CSSProperties = { borderCollapse: 'collapse', marginTop: '0.5rem', width: '100%' };
const th: React.CSSProperties = {
  textAlign: 'left',
  borderBottom: '1px solid #ccc',
  padding: '6px 8px',
  background: '#f6f7f9',
};
const td: React.CSSProperties = { borderBottom: '1px solid #eee', padding: '6px 8px', verticalAlign: 'top' };
