# GEOGLOWS Evaluation App

A browser-based tool for verifying **RFS** (River Forecast System) ensemble streamflow
forecasts against observed gauge data, for one river reach and one flood event.

RFS is the hydrological model delivered through GEOGLOWS and forced by ECMWF numerical
weather prediction. This app scores its forecasts across lead times of 0–15 days and all
51 ensemble members, using four families of metrics — categorical, timing, accuracy and
probabilistic.

Everything runs client-side. There is no server, no API key and no account: forecasts are
fetched directly from the public RFS endpoints and cached in your browser's IndexedDB, and
your uploaded gauge data never leaves the machine.

## Running it

You need **Node 20 or newer**.

```bash
git clone https://github.com/Aquaveo/geoglows-evax.git
cd geoglows-evax
npm install
npm run dev
```

Vite prints a local URL — usually <http://localhost:5173>. Open it in a browser.

## Using it

The four tabs are meant to be worked left to right.

**Overview** explains what each metric measures and how to read it. Worth skimming first;
it is also where the design decisions and their limits are written down.

**Setup** is where the data goes in. You need two things:

- a **9-digit reach ID** from RFS, identifying the river segment
- a **CSV of observed discharge** for that gauge

Upload a long historical record if you have one — it is what return-period thresholds are
fitted to, and it gates the skill scores (RPSS, CRPSS) and the local bias correction. You
can then either give the dates of an event, or upload a separate CSV containing just the
event.

**Forecast** downloads the ensemble runs covering your event. The app fetches every
initialization from 15 days before the event start through the end, so a 31-day event
pulls 46 runs. The event window is capped at 31 days.

**Metrics** is the output: five collapsible blocks, each with a Compute button. Nothing is
drawn until you ask for it, because the charts are the expensive part.

## CSV format

Two columns, in this order — the names do not matter, the **order does**:

| column | contents |
|---|---|
| 1 | datetime |
| 2 | discharge in m³/s |

```csv
datetime,discharge
1977-08-01,12.4
1977-08-02,15.1
```

Dates may be ISO (`1977-08-01`, `1977-08-01 06:00`) or slash-formatted (`8/1/1977`,
`8/1/1977 06:00`). Slash dates are read as month/day/year or day/month/year based on the
whole file — a value above 12 in either position settles it. If nothing in the file settles
it, the app says so and shows the date range it assumed, so check that before trusting the
results.

Times are read as **UTC** unless the value carries an explicit offset. Negative readings
are clamped to 0 and counted, because a clamped negative is indistinguishable downstream
from a real zero and the two mean opposite things.

## Development

```bash
npm test          # vitest, 360 tests
npm run build     # tsc -b && vite build
npm run lint      # eslint
```

The test suite is the specification for most of the metric behaviour: where a defect was
fixed, there is usually a test that fails against the previous version and says so in its
comment.
