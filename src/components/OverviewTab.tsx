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
        <h2 style={h2}>Categorical metrics</h2>

        <h3 style={h3}>Contingency matrix</h3>
        <p style={p}>
          A K × K table of timestep counts for one lead: observed category down the rows, forecast
          category across the columns. A perfect forecast is non-zero only on the diagonal; below it
          is underestimation, above it overestimation.
        </p>
        <p style={p}>
          This is the one panel that reduces the ensemble to a single series. The selector takes an
          ensemble statistic, the median by default, or any single member. The maximum asks whether{' '}
          <em>any</em> member crossed — a different question rather than a stricter one. Every other
          score in this family reads all 51 members.
        </p>

        <h3 style={h3}>MCC and HSS</h3>
        <p style={pMono}>
          MCC = (N·c − Σ tₖpₖ) / √[(N² − Σ pₖ²)(N² − Σ tₖ²)]{'\n'}
          HSS = (N·c − Σ tₖpₖ) / (N² − Σ tₖpₖ)
        </p>
        <p style={p}>
          Both grade all K categories against chance: 1 is perfect, 0 no better than a random
          forecast with the same marginals. They share a numerator — excess hits over chance — and
          differ only in the denominator: MCC normalises by the marginal spreads, HSS by the gap
          between chance and perfection. Each member is scored separately; the line is their median,
          the band their interquartile range.
        </p>
        <p style={p}>
          That shared numerator fixes their order by sign. Better than chance puts MCC at or above
          HSS, worse than chance the reverse, with no exception across a deterministic
          60,000-matrix sweep kept as a test. Their agreement is arithmetic, not corroboration.
        </p>
        <p style={p}>
          Both count correct negatives, so both move when a window is padded with quiet days — on a
          forecast running one category low, that shift can reverse the verdict. Never read them
          across events of different window length.
        </p>

        <h3 style={h3}>Ranked probability score (RPS, RPSS)</h3>
        <p style={pMono}>
          RPS = Σₖ (CDF_forecast(k) − CDF_observed(k))²{'\n'}
          RPSS = 1 − RPS / RPS_climatology
        </p>
        <p style={p}>
          The only categorical score here that knows the categories are <strong>ordered</strong>.
          Differencing cumulative probabilities makes the penalty grow with distance: one category
          low costs 1, three low costs 3, where MCC and HSS return the same value for all three. It
          reads the members as a distribution over categories, so a spread straddling the truth beats
          confident error. Quiet days drag raw RPS toward zero whatever the skill; compare across
          events with RPSS.
        </p>
        <p style={p}>
          RPSS and CRPSS follow one rule, not one reference:
        </p>
        <ul style={ul}>
          <li>Observed, never modelled, and never taken from the event being scored.</li>
          <li>
            Season-restricted to ±15 calendar days of the event's days: every reading of every year
            in that window. A filter, not an average.
          </li>
          <li>
            Aggregated to the same grid and bin summary as the observations it is scored against.
            That is where the two part company — the categorical reference follows the chosen bin
            summary, the continuous one uses bin means.
          </li>
          <li>
            Withheld with a stated reason, not estimated: no record uploaded, fewer than 30
            in-season values, or nothing crossing even the lowest threshold. RPS and CRPS need no
            reference and are reported anyway.
          </li>
        </ul>

        <h3 style={h3}>Scores per exceedance threshold</h3>
        <p style={pMono}>
          POD = a/(a+c)   FAR = b/(a+b)   CSI = a/(a+b+c)   bias = (a+b)/(a+c){'\n'}
          a hits · b false alarms · c misses · d correct negatives
        </p>
        <p style={p}>
          Probability of detection, false-alarm ratio, CSI and frequency bias, each from a two-by-two
          table dichotomising the matrix at one threshold: K−1 rows. Read down the rows for skill
          decaying as severity climbs. None uses the correct-negative cell, so quiet timesteps cannot
          move them.
        </p>
        <p style={p}>
          Frequency bias is not a skill score: forecast exceedances over observed ones, so 1.0 means
          the right <em>number</em> of warnings, not the right days. For magnitude bias, read the bias
          ratio under Accuracy instead — the dual thresholds mean a uniformly low model crosses its
          own thresholds about as often as observations cross theirs.
        </p>

        <h3 style={h3}>CSI by lead day</h3>
        <p style={p}>
          Its own panel, because it is the window-invariant score: hits over hits plus false alarms
          plus misses, correct negatives never entering. If the chance-corrected scores look
          healthier, quiet timesteps are flattering them.
        </p>
        <p style={p}>
          CSI is defined only on a two-by-two table, hence the threshold selector and no shared axis
          with MCC and HSS. "At or above the 2-year level" is an easier question than grading every
          category, so CSI reads higher for that reason alone. It is scored on the members{' '}
          <strong>pooled</strong> into one table per lead, not as a median of separate member scores.
          Sample size is distinct observed exceedance timesteps — the same three flood days seen by
          51 members is three events, not 153 — and leads with fewer than three are drawn hollow.
        </p>
        <p style={p}>
          It is not a skill score: 0 means no hits were scored, not "no better than chance". A level
          with nothing observed and nothing forecast reads n/a.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2}>Timing metrics</h2>
        <p style={p}>Both are signed differences in hours: negative is early, positive late.</p>

        <h3 style={h3}>Peak timing error</h3>
        <p style={pMono}>Δt_peak = t_peak,forecast − t_peak,observed  [hours]</p>
        <p style={p}>
          The time of a member's maximum minus the time of the observed maximum. No threshold decides
          what counts as a peak, and magnitude never enters: a member that misses the flow but times
          the crest exactly scores zero, so read it separately from the accuracy scores. The median
          across members is the headline, the whisker is member disagreement.
        </p>
        <p style={p}>
          A peak can only be placed on a sample that exists, and a run publishes coarser samples late
          in its horizon. A bar whose median falls within its own row's sample spacing is drawn{' '}
          <strong>hollow</strong>. Hollow is not a measured bias: a perfect forecast produces hollow
          bars wherever the spacing coarsens.
        </p>
        <p style={p}>
          A member contributes no timing in two cases, both facts about its shape rather than its
          quality:
        </p>
        <ul style={ul}>
          <li>
            Flat throughout, so there is no maximum to time. Counted as predicting no peak, and at
            long lead that count is the finding.
          </li>
          <li>
            Maximum on its own first or last sample, so the real peak probably lies outside the
            series and the difference is a bound rather than a measurement.
          </li>
        </ul>
        <p style={p}>
          Nothing is dropped for forecasting badly: a noisy member is scored, and its scatter is the
          finding. The counts travel with every chart.
        </p>

        <h3 style={h3}>Threshold crossing</h3>
        <p style={pMono}>Δt_RP = t_crossing,forecast − t_crossing,observed  [hours]</p>
        <p style={p}>
          For each return-period level, the first timestep at or above it on the forecast side minus
          the same on the observed side, each against its own threshold. This is warning-time error:
          alerts fire on exceedance, not on peak arrival. A series already above at its first sample
          counts as crossing there, so a record starting mid-flood can read zero. Unlike peak timing
          it depends on magnitude, and a member that runs low never crosses.
        </p>
        <p style={p}>
          Only members that crossed on both sides have an error, so read the detection table too. Per
          lead it counts members, crossings on both sides, crossings seen only in the observations —
          missed warnings the plot cannot show — cases with no observed crossing, and the detection
          rate. Detection falls as the level rises, but at the highest levels the observations usually
          never crossed either: severity, not an ensemble limit.
        </p>
        <p style={p}>
          The whole crossing family needs the <strong>historical observations</strong> upload, which
          supplies the observed-side thresholds. Without it the panel is absent rather than
          approximate.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2}>Accuracy metrics</h2>

        <h3 style={h3}>Kling–Gupta efficiency (KGE′)</h3>
        <p style={pMono}>KGE' = 1 − √[(r − 1)² + (β − 1)² + (γ − 1)²]</p>
        <p style={p}>
          Gupta et al. (2009) decomposed mean squared error into three components, refined by Kling
          et al. (2012). Each is perfect at 1:
        </p>
        <ul style={ul}>
          <li>
            <strong>Correlation r</strong> — Pearson correlation of forecast and observation; lower
            means poor timing or shape.
          </li>
          <li>
            <strong>Bias ratio β</strong> — mean forecast over mean observed; above 1 overestimation,
            below 1 underestimation.
          </li>
          <li>
            <strong>Variability ratio γ</strong> — forecast CV over observed CV; above 1 too much
            variability, below 1 too little.
          </li>
        </ul>
        <p style={p}>The component furthest from 1 dominates.</p>
        <p style={p}>
          Each component is guarded on what it alone needs, so a member can appear in the bias-ratio
          panel and not in KGE′. A flat forecast — every timestep the same value — still has a mean,
          so β is reported; it has no variability, so γ reads 0; correlation is undefined, so r and
          KGE′ are withheld. That case is live: the corrected variants go flat wherever the transform
          saturates or the negative clamp bites.
        </p>

        <h3 style={h3}>Nash–Sutcliffe efficiency (NSE)</h3>
        <p style={pMono}>NSE = 1 − Σ(f − o)² / Σ(o − ō)²</p>
        <p style={p}>
          The mean-squared-error skill score against the observed average, dominated by the largest
          errors — on a flood window, the peak. NSE needs only the observations to vary, so it
          survives the flat-forecast case that withholds KGE′, and the two medians on one row can rest
          on different member sets. Each bar carries its own count.
        </p>
        <p style={p}>
          Read a row across the pair: strong on KGE′ and weak on NSE usually means the shape was right
          and the magnitude was not, since NSE punishes squared error at the peak while KGE′ spreads
          it over three components.
        </p>

        <h3 style={h3}>Reading the coloured bars</h3>
        <p style={p}>
          Each bar is the median across members for one lead day or one forecast run. Members without
          enough overlapping points of their own are left out.
        </p>
        <p style={p}>
          Colour is the performance band. KGE′ uses the published ladder — Good above 0.75,
          Intermediate 0.50–0.75, Poor 0.00–0.50 — from{' '}
          <a href="https://doi.org/10.5194/hess-19-3365-2015" style={link} target="_blank" rel="noreferrer">
            Thiemig et al. (2015)
          </a>
          . Below 0 that source has a single band; splitting it at −0.41 into Very poor and
          Unacceptable is this app's own extension.
        </p>
        <p style={p}>
          −0.41 is the mean-flow benchmark (
          <a href="https://doi.org/10.5194/hess-23-4323-2019" style={link} target="_blank" rel="noreferrer">
            Knoben, Freer &amp; Woods, 2019
          </a>
          ; stated for KGE′ by{' '}
          <a href="https://doi.org/10.5194/essd-12-2043-2020" style={link} target="_blank" rel="noreferrer">
            Harrigan et al., 2020
          </a>
          ): the score of a forecast equal to the observed mean at every timestep. So a KGE′ of −0.2
          still beats the observed mean. Read "below the benchmark" as worse than a flat line, not
          worse than climatology, which is a different and generally better forecast.
        </p>
        <p style={p}>
          NSE is keyed to 0 instead, already normalised by the observed variance, so it has four bands
          where KGE′ has five, on its own palette and legend. The KGE′ ladder does not carry across.
        </p>
        <p style={p}>
          Band names shift with the window you chose: these scores normalise by the window's observed
          variability, not the river's. Bars far off the left of the axis are compressed into a strip
          and labelled with their true value.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2}>Probabilistic metrics</h2>

        <h3 style={h3}>Continuous ranked probability score (CRPS, CRPSS)</h3>
        <p style={pMono}>
          CRPS = (1/M) Σ |Xₘ − Q_obs| − (1/2M²) Σ Σ |Xₘ − Xₘ'|
        </p>
        <p style={p}>
          CRPS scores the ensemble as a distribution, not member by member. The first term is the
          members' mean absolute error against the observation; the second is half their mean pairwise
          difference, which credits spread. Units are discharge. Zero is perfect, lower is better, no
          upper bound. Over- or under-spreading the ensemble does not improve it.
        </p>
        <p style={p}>
          One value per lead day, averaged over every timestep where forecast and observation overlap.
          That average dilutes the peak among ordinary flows, so a moderate CRPS can still hide a bad
          miss at the crest.
        </p>
        <p style={p}>
          CRPSS normalises that against a climatological forecast: 1 is perfect, 0 means the ensemble
          was worth no more than quoting the season's long-term record, below 0 worse. Its reference
          is built by the rule set out under Ranked probability score above and scored on exactly the
          timesteps the forecast was, and all three variants share it, so a difference between
          variants is a difference in the forecast. No uploaded record, no CRPSS; CRPS still shows.
        </p>
        <p style={p}>
          Beyond the bin summary, the continuous reference departs from the categorical one in one
          way: it follows the comparison grid rather than flooring at daily.
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
