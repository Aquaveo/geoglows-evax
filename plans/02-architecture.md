# 02 — Architecture

## Decision summary

| Area | Choice | Rationale |
|---|---|---|
| Frontend framework | React 19 + TypeScript + Vite | Matches aquiferx |
| Charting | **Plotly.js** via `react-plotly.js`; figures ported from [pygeoglows `_plots`](https://github.com/geoglows/pygeoglows/tree/master/geoglows/_plots) | The notebook reuses these Plotly figures directly (`geoglows.plots.forecast_stats`, retrospective); we reproduce the same compositions in JS so output matches |
| Maps | Leaflet with **ESRI World Imagery + boundaries** raster layers | Matches the notebook's `scatter_mapbox` styling — satellite basemap with reference labels, not the OSM default |
| CSV upload timezone | **UTC-required; no client-side tz conversion** | Notebook's `timezonefinder` shift assumes the gauge is in the reach's local tz and uses today's DST offset (subtle bug). Requiring UTC eliminates the dependency and the bug, and matches researcher norms |
| GEOGLOWS data client | **[`riverforecastsystem`](https://www.npmjs.com/package/riverforecastsystem) npm package** | Browser-side Zarr reads (`rfs.v2.forecast / retrospective / returnPeriods`); eliminates the need for a backend forecast proxy |
| Backend | **None for v1** (revisit only if metadata lookup forces it) | Package handles all forecast/retro/RP fetches client-side. Open Q on reach metadata (LINKNO → lat/lon) below |
| Metric compute | **In-browser, pure TS** | Notebook metrics are raw NumPy and translate cleanly to TS. CRPS O(51²)·T·leads ≈ tens of millions of ops — fine in JS |
| State mgmt | React `useState` + Context | Small state surface; no Redux/Zustand needed |
| Monorepo layout | Flat single-app Vite project | No backend → no workspace split needed |
| Package manager | npm | Matches aquiferx |
| Deployment | **Vercel** (static; serverless functions only if needed) | Confirmed target; no long-running server to provision |

## Where the work happens (a.k.a. "no backend" — what does that mean?)

The notebook is the *specification* for the methodology, not code we ship. The
deployable artifact is a single-page React app on Vercel; both data fetching
and metric computation run **in the user's browser**:

- **Data layer (browser).** The `riverforecastsystem` package reads GEOGLOWS
  RFS v2 Zarr stores directly from public S3. No proxy.
- **Compute layer (browser).** Every notebook function (CSV ingest, Gumbel,
  lead-day reorg, contingency / KGE / CRPS / timing metrics, alignment) is
  translated from NumPy to TypeScript modules under `src/lib/`. There is no
  Python runtime — the math is reimplemented once in TS.
- **Rendering (browser).** Plotly.js draws the figures (composed to match
  pygeoglows `_plots/plotly_forecasts.py` and `_plots/plotly_retrospective.py`)
  and Leaflet renders the reach map with ESRI World Imagery + boundaries
  raster layers.
- **Hosting (Vercel).** Serves the static bundle. Vercel serverless functions
  under `/api/` are *available* if we ever need to hide a credential, dodge
  CORS, or pre-aggregate something heavy — v1 is not expected to need them.

What this replaces from the original draft:

The `riverforecastsystem` package collapses what used to be three backend
responsibilities:

- **Forecast fetches** — `rfs.v2.forecast({riverId, date})` per init.
- **Retrospective fetches** — `rfs.v2.retrospective({riverId, resolution})`.
- **Simulated return periods** — `rfs.v2.returnPeriods({riverId})` returns the
  pre-fit Gumbel values, so we don't compute them from retro-daily ourselves.

What that leaves:

- **Reach metadata (LINKNO → lat/lon).** Not in the package. The notebook only
  reads `lat` and `lon` from the metadata parquet — nothing else — so the
  problem is small. Two viable options: (a) client-side parquet via `hyparquet`,
  or (b) a one-time build step that emits a slimmed `{LINKNO, lat, lon}` JSON
  (or columnar binary) served as a static asset. Decide before scaffolding
  (open Q below).
- **Caching.** Browser HTTP cache covers repeated runs; Zarr's chunked reads
  also make cold fetches small. No server-side cache needed.

All metric computation stays in the browser regardless.

## Repo layout

```
geoglows_evaluation_app/
├── src/
│   ├── components/             # React UI (panels, forms, charts wrappers)
│   ├── data/                   # GEOGLOWS data adapters
│   │   ├── rfs.ts              # Wraps rfs.v2.{forecast,retrospective,returnPeriods}
│   │   └── reachMetadata.ts    # LINKNO → lat/lon (see open Q below)
│   ├── lib/                    # Methodology port — pure TS, no React
│   │   ├── ingest/             # CSV parse, validate UTC, hourly resample
│   │   ├── gumbel.ts           # Gumbel-I RPs for the uploaded *observed* series
│   │   ├── leadBuckets.ts      # Reorganize ensembles by lead day (0–15)
│   │   ├── forecastSeries.ts   # Resolve ensemble_NN / stat_* selectors
│   │   ├── alignment.ts        # Forecast/obs window intersect idiom
│   │   └── metrics/
│   │       ├── contingency.ts  # build matrix, classify, MCC, HSS, DL
│   │       ├── timing.ts       # peak Δt, threshold crossing
│   │       ├── kge.ts          # r, β, γ, KGE'
│   │       └── crps.ts         # energy-score CRPS (51 members)
│   ├── plots/                  # Plotly figure builders (1:1 with pygeoglows _plots)
│   │   ├── forecasts.ts        # ← pygeoglows _plots/plotly_forecasts.py
│   │   ├── retrospective.ts    # ← pygeoglows _plots/plotly_retrospective.py
│   │   ├── inspectors.ts       # Per-metric "show the math" sub-views (MCC/HSS/KGE/CRPS/timing breakdowns)
│   │   └── helpers.ts          # ← pygeoglows _plots/{plotly_helpers,format_tools}.py
│   ├── state/                  # Context + reducers
│   ├── App.tsx
│   └── main.tsx
├── public/
├── api/                        # Vercel serverless functions (only if needed)
├── plans/
├── package.json
├── vite.config.ts
└── README.md
```

No workspaces, no `backend/`, no `shared/` — there's only one runtime
environment (the browser), so types live alongside the code that uses them.

## Frontend data flow

```
1. User enters riverId
   → data/reachMetadata → lat/lon, render Leaflet point map
   → rfs.v2.retrospective({riverId, resolution:'daily'}) for plotting context
   → rfs.v2.returnPeriods({riverId}) → simulatedRpThresholds (pre-fit Gumbel)

2. User uploads event obs CSV (must be UTC)
   → ingest/parseCsv → ingest/validateUtc → ingest/resampleHourly
   → store as hourly UTC-indexed series

3. User uploads historical obs CSV (must be UTC)
   → ingest/parseCsv → annual maxima → gumbel.computeReturnPeriods
   → store observedRpThresholds (2/5/10/25/50/100 yr)
   (Simulated RPs already came from rfs.v2.returnPeriods in step 1 —
    no client-side Gumbel fit on retro-daily.)

4. Frontend computes init-date list from event window
   (event_start − 15d … event_end, daily — typically 20–30 inits)
   → bounded-concurrency fetch (e.g. 4 at a time) for each date:
       rfs.v2.forecast({riverId, date}) → {time, discharge[51][T], stats}
   → progress bar; browser HTTP cache covers repeats

5. Compute pipeline (all in browser, pure TS):
   → leadBuckets.reorganize(allInits) → ensembleByLead[0..15]
   → for each lead × forecastSeries:
       align(forecast, obs) → metrics.{contingency, kge, crps, timing}
   → store resultsByLead = { [lead]: { [seriesKey]: { … } } }

6. UI renders:
   → Map panel (Leaflet + ESRI imagery, reach point)
   → Per-init inspector (init/lead/series dropdowns → single Plotly fig)
   → Metrics-vs-lead panels (one per metric family)
   → Contingency tables (size varies 3×3 → 7×7 with event_return_period)
   → "Show the math" sub-view per metric (MCC/HSS/KGE/CRPS/timing
     breakdowns, mirroring the notebook's display_*_breakdown helpers)
```

## Key porting risks (callouts for implementation)

1. **CRPS pairwise term memory.** Vectorized `|X[:,None] − X[None,:]|` at
   hourly resolution × 51 × 51 is fine per-timestep but tempting to do as one
   big tensor — port as a per-timestep loop in TS, not a single allocation.
2. **Dual-threshold classification.** Keep observed vs. simulated RP thresholds
   in separate variables threaded through `classify_series`. Merging them
   silently reintroduces the model-climatology bias the design avoids.
3. **Initialization pooling.** When concatenating per-init forecasts into a
   per-lead frame, repeated timestamps are intentional — do not dedupe.
4. **Gumbel constants (observed only).** For the *observed* RPs fit from the
   uploaded gauge history, use the moment estimators (`0.7797·σ`, `0.45·σ`)
   verbatim, not scipy MLE. Simulated RPs come pre-fit from
   `rfs.v2.returnPeriods` and should not be refit.
5. **Negative discharge clipping** to 0 at every ingest point.
6. **UTC-only timestamps.** Uploads are required to be in UTC; reject (or
   warn) on tz-aware datetimes that don't normalize to UTC. No `timezonefinder`
   port — the notebook's lat/lon-based shift had a DST-at-current-moment bug,
   and explicit UTC matches researcher norms.
7. **Window alignment idiom** (`max(min), min(max), index.intersection`) is
   used in every metric — implement once in `lib/alignment.ts`.
8. **Dynamic contingency matrix size.** Number of RP categories (3×3 to 7×7)
   is driven by `event_return_period`; both math and table renderer must
   handle the variable shape.
9. **Inspector parity.** Each metric's "show the math" sub-view must surface
   the same intermediate values the notebook prints (matrix counts, t_k/p_k,
   per-timestep CRPS, etc.). Treat these as first-class UI, not debug output.

## Things deferred (not v1)

- Authentication / multi-user.
- Saving / sharing verification runs.
- Multi-event or multi-reach batch mode.
- Bias correction (pygeoglows `plotly_bias_corrected.py` not ported).
- CSV / PNG / PDF export of results — researchers consume output in-app.
- Click-on-map → nearest reach (researchers paste a LINKNO).
- Local-time CSV uploads (UTC-only by contract).

## Open questions for this doc

Open as posed, with resolutions/status appended inline. Kept here so the doc
shows the full arc of decisions.

1. **Reach metadata lookup (LINKNO → lat/lon)** — two viable options:
   - **(a) Client-side parquet** with `hyparquet` — byte-range reads against
     the S3 parquet; no build-time step.
   - **(b) Static slimmed asset** — one-time build step emits a `{LINKNO,
     lat, lon}` JSON (or columnar binary) served from `public/`.

   **Status: deferred** (2026-05-22). v1 ships without metadata; the map
   section hides when lat/lon are null. The rest of the workflow does not
   depend on lat/lon. Revisit when we want the map back.
2. **CORS on RFS Zarr stores** — verify in-browser before scaffolding.

   **Status: resolved** (2026-05-21). The CORS smoke test and the live app
   both confirm browser-side Zarr reads work against the public S3 stores.
3. **Plotly bundle size** — accept the ~3 MB hit, or lazy-load Plotly only
   when the first chart is rendered? Recommend lazy-load via `React.lazy`.

   **Status: accepted as-is for v1.** First-draft bundle is ~5 MB total
   (Plotly + Leaflet + Zarr). Lazy-load is still on the table when we
   tighten the build.
4. **CSV ingest UX** — strict schema (`datetime`, `discharge` columns
   required) vs. auto-detect with a confirmation step?

   **Status: resolved — positional schema.** First column = datetime, second
   column = discharge. Header names are surfaced in the upload status line
   but not used for mapping. Simpler than the original "confirmation step"
   plan and unambiguous for researchers.
5. **Testing strategy for the metric port** — methodology-fidelity demands
   fixture-based parity tests: dump intermediate arrays from the notebook,
   assert TS output matches within a tolerance (e.g. `1e-9`). Where do
   fixtures live, and is one canonical `(river_id, event)` enough?

   **Status: still open.** Becomes blocking before we declare any metric
   "ported" beyond the first draft.

## Status — v1 first draft (2026-05-22)

Implemented at the project root:

- **Vite 8 + React 19 + TS 6** scaffold, deployable as a static bundle.
- **Data layer** — `src/data/rfs.ts` wraps `rfs.v2.*` with bounded-
  concurrency fanout; `src/data/reachMetadata.ts` is a no-op stub (returns
  null coords) per open Q §1.
- **Methodology port (`src/lib/`)** — `ingest/parseCsv`, `ingest/resampleHourly`,
  `gumbel`, `alignment`, `leadBuckets`, `forecastSeries`, `metrics/kge`.
  Notebook math reimplemented in TS for the KGE pipeline end-to-end.
- **Plots (`src/plots/`)** — `retrospective`, `forecasts` (per-init mean /
  median / IQR / min-max bands + RP color bands), `kgeVsLead` (distribution
  across the 51 members vs. lead day), plus `helpers` for the RP color
  palette.
- **UI** — three tabs (Setup / Forecast / Metrics) coordinated by
  `state/AppContext`. ESRI World Imagery + boundaries map layers wired but
  currently hidden.

Not yet built (carried forward from the deferred list):
- Metrics other than KGE′ (MCC, HSS, DL, peak Δt, threshold crossing, CRPS).
- Per-metric "show the math" inspector panels.
- Variable-size contingency tables.
- Reach map (lat/lon source pending).
- Notebook-parity fixture tests.

## Next steps

Roadmap, oldest → newest. Done items stay visible.

1. ~~Verify CORS on RFS Zarr buckets from a browser.~~ **Done.**
2. ~~Resolve the reach-metadata lookup approach.~~ **Deferred** — see
   open Q §1.
3. **Draft `03-data-flow.md`** — one section per notebook function,
   showing the TS module it maps to. *Not started; useful as
   after-the-fact documentation of the port.*
4. ~~Draft `04-ui-wireframes.md` — three screens: setup, run, results.~~
   **Skipped** — built directly as Setup / Forecast / Metrics tabs.
5. ~~Scaffold the Vite app and wire up `riverforecastsystem`.~~ **Done.**
6. ~~First-draft Setup / Forecast / Metrics tabs with KGE′ end-to-end.~~
   **Done.**
7. **Validate the KGE′ port against the notebook on a real event.** *Next.*
8. **Port the remaining three metric families** (categorical, timing,
   probabilistic).
9. **Add per-metric inspector panels.**
10. **Resolve reach metadata** (open Q §1) and re-enable the map.
11. **Fixture-based parity tests** (open Q §5).
12. **Bundle tightening** — lazy-load Plotly (open Q §3), code-split tabs.
