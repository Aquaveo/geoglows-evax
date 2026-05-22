# 01 — Overview & Scoping

## Goal

Port the **GEOGLOWS ensemble flood-event forecast verification** methodology
from the reference Colab notebook into a web app, so that researchers
evaluating GEOGLOWS skill can run the same analysis consistently without
writing Python.

- Reference notebook: `Copy_of_Forecast_Verification_Web_App.ipynb` at the
  repo root (also Google Drive ID `16M6y7LTxs4cnk0Sat3ZzkmDx7oqphj2p`).
- Reference app for stack & feel: <https://github.com/geoglows/aquiferx>.

## What the methodology does

For a single river reach and a single observed flood event, evaluate the
**51-member ECMWF-driven GEOGLOWS v2 ensemble** against an uploaded gauge
time series, reporting skill **as a function of lead day 0–15** across four
metric families:

1. **Categorical** — multi-class contingency matrix (return-period bins),
   MCC, HSS, Deterministic Limit (Hewson 2007).
2. **Timing** — peak Δt, threshold-crossing detection rate + conditional Δt.
3. **Accuracy** — KGE' (Kling 2012) with r / β / γ components.
4. **Probabilistic** — CRPS via energy-score decomposition.

Notable design choice: **dual-threshold classification** — observed values
are classified against return periods derived from the gauge's own
historical record; forecast values are classified against return periods
derived from the retrospective simulation. This removes model-climatology
bias from the categorical metrics.

## Audience & purpose

- **Who:** GEOGLOWS researchers evaluating forecast skill for historical
  events. *Not* operational forecasters.
- **Why:** Methodology fidelity. Two researchers analyzing different
  reaches or events should be running identical math.
- **What they bring:**
  1. A 9-digit `river_id` (LINKNO).
  2. An event-window observation CSV (datetime + discharge; UTC).
  3. A historical observation CSV (datetime + discharge; UTC) for
     Gumbel-fit observed return periods.
- **What they get back:** the notebook's diagnostic figures and tables,
  rendered in-browser. No file exports in v1.

## Inputs

| Input | Source | Notes |
|---|---|---|
| `river_id` | text input | Any 9-digit integer the GEOGLOWS libraries recognize |
| Event obs CSV | upload | datetime + discharge; **must be UTC** |
| Historical obs CSV | upload | annual maxima → observed Gumbel RPs |
| Init date | dropdown | one of the daily inits in `event_start − 15d` … `event_end` |
| Forecast series | dropdown | `ensemble_01`…`51` or `stat_{median,mean,p25,p75,min,max}` (stats recomputed from the 51 members) |

## External data

GEOGLOWS RFS v2 data is fetched browser-side via the
[`riverforecastsystem`](https://www.npmjs.com/package/riverforecastsystem)
npm package, which reads public S3-hosted Zarr directly. Three calls cover
everything we need: retrospective discharge, pre-computed simulated return
periods, and per-init forecasts. No backend proxy.

The one piece *not* covered by the package is reach metadata (LINKNO →
lat/lon). v1 ships without it; the map panel is hidden until we resolve a
lat/lon source. See `02-architecture.md`.

## Non-goals (v1)

- Bias-correction or model re-training.
- Multi-event or multi-reach batch verification.
- User accounts, saved sessions, sharing.
- Mobile / small-screen UX (desktop browser only).
- CSV / PNG / PDF exports — researchers consume output in-app.
- Click-on-map → nearest reach (researchers paste a LINKNO).
- Local-time CSV uploads (UTC-only by contract).
- High-res `ensemble_52` member (being retired by GEOGLOWS).

## Tech stack

- **Frontend:** React 19 + TypeScript + Vite (single static bundle).
- **Charts:** Plotly.js, figure compositions ported from
  [pygeoglows `_plots/`](https://github.com/geoglows/pygeoglows/tree/master/geoglows/_plots).
- **Maps:** Leaflet with ESRI World Imagery + boundaries tiles (wired but
  hidden until lat/lon source lands).
- **GEOGLOWS data:** `riverforecastsystem` (`rfs.v2.*`).
- **Compute:** every notebook function reimplemented in TypeScript under
  `src/lib/`. No Python runtime.
- **Deployment:** Vercel (static; serverless functions available but not
  needed for v1).

## v1 first-draft status

Built:
- **Setup tab** — river_id input, two CSV uploaders (event + historical),
  observed/simulated RP table side-by-side, retrospective daily-discharge
  plot.
- **Forecast tab** — auto-computed init-date list from the event window,
  bounded-concurrency download of all inits, init dropdown driving a
  per-init forecast plot (mean / median / IQR / min-max bands + RP color
  bands).
- **Metrics tab** — KGE' computed for each of the 51 members per lead day
  0–15, aggregated to a distribution (median + IQR + min-max bands) plotted
  against lead day.

Not yet built / deferred:
- MCC, HSS, CRPS, peak Δt, threshold crossing, deterministic limit.
- Per-metric "show the math" inspector panels (mirroring the notebook's
  `display_*_breakdown` helpers).
- Variable-size contingency tables (3×3 → 7×7).
- Reach map (lat/lon source pending).
- Fixture-based parity tests against notebook intermediate values.

## Open questions (with resolutions)

Original scoping questions and where they landed. Kept here so the doc shows
the full arc of decisions, not just the snapshot.

1. **Backend or static?** — **Resolved: fully static.** Browser-side Zarr
   reads via `riverforecastsystem` cover the data layer; metrics run in TS;
   no parquet metadata is needed for v1.
2. **Charting library** — **Resolved: Plotly.js.** Confirmed; figures are
   composed to match pygeoglows `_plots/`.
3. **Reach selection UX** — **Resolved: text input only.** Click-on-map →
   nearest reach is an explicit non-goal (researchers paste a LINKNO).
4. **CSV schema** — **Resolved: positional (first two columns).** Column 0
   is the datetime, column 1 is the discharge; header names are read but
   not auto-mapped. Stricter than original, but unambiguous.
5. **Performance budget for CRPS** — **Deferred.** CRPS not in v1; revisit
   when we port it.
6. **Deployment target** — **Resolved: Vercel.** Static-only; serverless
   functions available but not needed.
7. **Export needs** — **Resolved: no exports in v1.** Researchers consume
   output in-app.

## Roadmap

Tracking the full process, oldest → newest. Completed items stay visible.

1. ~~Confirm tech stack direction (especially Plotly + backend-or-not).~~
   **Done** — see Open Questions §1, §2.
2. ~~Draft `02-architecture.md`.~~ **Done.**
3. **Draft `03-data-flow.md` mapping notebook functions → TS modules.**
   *Not started.* The first-draft port went directly from notebook to TS;
   this doc would still be useful for documenting the mapping after the
   fact.
4. ~~Draft `04-ui-wireframes.md` for the screens.~~ **Skipped** — we
   committed to a tabs layout (Setup / Forecast / Metrics) and built
   directly. A wireframes doc could still be written if the UI grows.
5. **Scaffold Vite + React + TS app at the project root.** **Done.**
6. **Wire `riverforecastsystem` and prove browser-side Zarr reads work.**
   **Done** (CORS smoke test succeeded; live in the app).
7. **First-draft Setup / Forecast / Metrics tabs with KGE′.** **Done** —
   see "v1 first-draft status" above.
8. **Validate the KGE′ port end-to-end against the notebook on a real
   event.** *Next.*
9. **Port the remaining three metric families** (categorical: MCC / HSS /
   DL; timing: peak Δt + threshold crossing; probabilistic: CRPS).
10. **Add per-metric "show the math" inspector panels** mirroring the
    notebook's `display_*_breakdown` helpers.
11. **Resolve reach metadata (LINKNO → lat/lon)** and turn the map back
    on. See open Q #1 in `02-architecture.md`.
12. **Fixture-based parity tests** against notebook intermediate values.
