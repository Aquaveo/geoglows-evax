#!/usr/bin/env python
"""Generate bias-correction parity fixtures from the REAL geoglows package.

Run manually (needs ~/miniconda3 with geoglows installed); not wired into npm,
since CI has no Python. Synthetic cases are seeded and fully reproducible with
no network. The real-data anchor recomputes from inputs committed alongside it,
so regeneration never depends on S3 still serving a given forecast date.

    python scripts/gen-bias-fixtures.py
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bias_reference import (  # noqa: E402
    capture_cdf,
    capture_probes,
    dump,
    series_json,
    versions,
)
from geoglows.bias import correct_forecast  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tests", "fixtures", "bias")
DAY = pd.Timedelta(days=1)


def synth(seed: int, years: int, scale: float = 1.0, sigma: float = 0.4) -> pd.DataFrame:
    """Seasonal lognormal daily record. Deterministic per (seed, years)."""
    rng = np.random.default_rng(seed)
    days = pd.date_range(f"{2024 - years}-01-01", "2023-12-31", freq="D")
    seasonal = 60 + 45 * np.sin(2 * np.pi * (days.dayofyear.values - 100) / 365.0)
    return pd.DataFrame(
        {"q": np.clip(scale * seasonal * rng.lognormal(0, sigma, len(days)), 0, None)},
        index=days,
    )


def monthly_of(df: pd.DataFrame, month: int) -> pd.DataFrame:
    return df[df.index.month == month].dropna()


def fc_frame(values_by_member: list[list[float]], start: str, freq: str = "3h") -> pd.DataFrame:
    n = len(values_by_member[0])
    idx = pd.date_range(start, periods=n, freq=freq)
    return pd.DataFrame(
        {f"ensemble_{i + 1:02d}": v for i, v in enumerate(values_by_member)}, index=idx
    )


RECORDS: dict[str, dict] = {}


def trim_months(df: pd.DataFrame, months) -> pd.DataFrame:
    """correct_forecast filters both records by calendar month, so keeping only
    the months a case exercises is exactly equivalent and keeps fixtures small."""
    return df[df.index.month.isin(list(months))]


def put_record(df: pd.DataFrame) -> str:
    """Deduplicate identical series so a shared 20-year record is stored once."""
    j = series_json(df)
    key = f"r{len(RECORDS)}"
    for k, v in RECORDS.items():
        if v == j:
            return k
    RECORDS[key] = j
    return key


def run_case(name, desc, sim, obs, fc, use_month=0, expect_raises=False, keep_months=None):
    rec = {
        "name": name,
        "description": desc,
        "versions": versions(),
        "useMonth": use_month,
        "simulatedRef": put_record(trim_months(sim, keep_months) if keep_months else sim),
        "observedRef": put_record(trim_months(obs, keep_months) if keep_months else obs),
        "forecast": {
            "time": [t.isoformat() for t in fc.index],
            "members": [[float(x) for x in fc[c].to_numpy()] for c in fc.columns],
            "memberNames": list(fc.columns),
        },
    }
    if keep_months:
        sim, obs = trim_months(sim, keep_months), trim_months(obs, keep_months)
    month = int(fc.index[use_month].month)
    rec["month"] = month
    if expect_raises:
        try:
            correct_forecast(fc, sim, obs, use_month=use_month)
        except Exception as e:  # noqa: BLE001 - recording the reference's own failure
            rec["raises"] = type(e).__name__
            rec["raisesMessage"] = str(e)[:200]
            return rec
        raise AssertionError(f"{name}: expected the reference to raise, it did not")

    ms, mo = monthly_of(sim, month), monthly_of(obs, month)
    rec["simulatedCdf"] = capture_cdf(ms, "toProbability")
    rec["observedCdf"] = capture_cdf(mo, "toFlow")
    out = correct_forecast(fc, sim, obs, use_month=use_month)
    rec["expected"] = {
        "time": [t.isoformat() for t in out.index],
        "members": [[float(x) for x in out[c].to_numpy()] for c in out.columns],
    }
    v = out.to_numpy(dtype=float)
    rec["summary"] = {
        "posInf": int(np.isposinf(v).sum()),
        "negInf": int(np.isneginf(v).sum()),
        "nan": int(np.isnan(v).sum()),
        "rawNan": int(np.isnan(fc.to_numpy(dtype=float)).sum()),
        "size": int(v.size),
    }
    return rec


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    print("versions:", versions())

    # ---------- layer 1: CDF build arithmetic ----------
    print("\ncdf-arithmetic")
    arith = {"versions": versions(), "cases": []}

    def add_arith(name, desc, values, index=None, direction="toProbability"):
        idx = index if index is not None else pd.date_range("2020-06-01", periods=len(values), freq="D")
        df = pd.DataFrame({"q": np.asarray(values, dtype=float)}, index=idx)
        arith["cases"].append(
            {"name": name, "description": desc, "input": series_json(df), **capture_cdf(df, direction)}
        )

    base = synth(0, 20)
    add_arith("june-20yr", "typical monthly sample", monthly_of(base, 6)["q"].to_numpy())
    add_arith("n1", "single sample: log10(1)=0 -> 1 class", [42.0])
    add_arith("n2", "two samples", [10.0, 40.0])
    add_arith("degenerate-range", "max == min triggers maxVal += 0.1", [7.0] * 12)
    add_arith("all-zero", "dry gauge month collapses the mapping", [0.0] * 30)
    add_arith("max-exact-integer", "max is an integer -> value lands in the closed last bin", [1.0, 2.5, 7.25, 12.0])
    add_arith("min-integer-positive", "minVal feeds stepWidth but never the bin start", [5.0, 9.5, 14.0, 22.0])
    add_arith("on-interior-edge", "value exactly on an interior bin edge", [0.0, 2.0, 4.0, 6.0, 8.0, 10.0])
    # log10 ULP boundary sweep: numberOfClasses = ceil(1 + 3.322*log10(n))
    for n in (10, 100, 511, 512, 513, 1000, 1023, 1024, 1025):
        rng = np.random.default_rng(1000 + n)
        add_arith(f"log10-n{n}", f"numberOfClasses boundary probe at n={n}", rng.uniform(1, 100, n))
    dump(os.path.join(OUT, "cdf-arithmetic.json"), arith)

    # ---------- layer 2: interpolation probes ----------
    print("\ninterp-probes")
    probes = {"versions": versions(), "cases": []}
    for label, vals in (
        ("june-20yr", monthly_of(base, 6)["q"].to_numpy()),
        ("small-10", [12.0, 15.0, 22.0, 31.0, 44.0, 47.0, 51.0, 58.0, 63.0, 70.0]),
        ("leading-gap", [80.0, 85.0, 90.0, 95.0, 99.0, 100.0]),
    ):
        df = pd.DataFrame({"q": np.asarray(vals, dtype=float)},
                          index=pd.date_range("2020-06-01", periods=len(vals), freq="D"))
        for direction in ("toProbability", "toFlow"):
            probes["cases"].append({"name": f"{label}:{direction}",
                                    "input": series_json(df), **capture_probes(df, direction)})
    dump(os.path.join(OUT, "interp-probes.json"), probes)

    # ---------- layer 3: full correct_forecast ----------
    print("\ncorrect-forecast")
    cases = []
    sim20, obs20 = synth(0, 20), synth(1, 20, scale=1.8, sigma=0.5)

    smax = float(monthly_of(sim20, 6)["q"].max())
    ramp = list(np.linspace(5.0, smax * 0.9, 24))
    cases.append(run_case("baseline", "forecast inside the simulated range, 4 members",
                          sim20, obs20, fc_frame([ramp, [v * 1.1 for v in ramp],
                                                  [v * 0.9 for v in ramp], [v * 1.05 for v in ramp]],
                                                 "2020-06-05"), keep_months=[6]))
    cases.append(run_case("above-sim-max", "forecast exceeds the simulated monthly max -> the +Inf path",
                          sim20, obs20, fc_frame([list(np.linspace(5.0, smax * 1.6, 24))], "2020-06-05"), keep_months=[6]))

    # inf / finite-ceiling pair, differing only in the 1-ULP predicate
    for seed, years, tag in ((3, 5, "a"), (0, 10, "b"), (1, 20, "c"), (0, 2, "d"), (1, 10, "e")):
        s, o = synth(seed, years), synth(seed + 100, years, scale=1.8, sigma=0.5)
        mx = float(monthly_of(s, 6)["q"].max())
        cases.append(run_case(
            f"ulp-race-{tag}-seed{seed}-{years}yr",
            "1-ULP predicate simCdf[last] > obsCdf[last] decides +Inf vs a finite ceiling",
            s, o, fc_frame([list(np.linspace(mx * 0.2, mx * 1.5, 20))], "2020-06-05"), keep_months=[6]))

    zero_edge = float(monthly_of(sim20, 6)["q"].min())
    cases.append(run_case("low-tail", "zero, negative and below-first-edge forecast values",
                          sim20, obs20,
                          fc_frame([[0.0, -0.5, zero_edge * 0.01, zero_edge, 1e-9, 0.0]], "2020-06-05"), keep_months=[6]))
    cases.append(run_case("nan-member", "NaN inside one member must not shift the others",
                          sim20, obs20,
                          fc_frame([[10.0, 20.0, float("nan"), 40.0],
                                    [11.0, 21.0, 31.0, 41.0]], "2020-06-05"), keep_months=[6]))

    # THE silent-corruption case. Records whose monthly minimum sits far above
    # stepWidth leave many LEADING empty bins, so both CDFs begin with duplicate
    # zeros. A low forecast maps to p == 0 exactly, to_flow(0) divides by zero and
    # yields NaN, and pandas `update` then KEEPS THE RAW VALUE -- an uncorrected
    # number sitting in "corrected" output, looking entirely plausible.
    hi_idx = pd.date_range("2020-06-01", periods=10, freq="D")
    hi_sim = pd.DataFrame({"q": [80., 82., 85., 88., 90., 92., 95., 97., 99., 100.]}, index=hi_idx)
    hi_obs = pd.DataFrame({"q": [70., 73., 76., 80., 84., 88., 91., 94., 97., 99.]}, index=hi_idx)
    cases.append(run_case(
        "nan-mapping-keeps-raw",
        "finite raw value whose mapping is NaN: pandas update retains the RAW value",
        hi_sim, hi_obs, fc_frame([[1.0, 2.0, 85.0, 95.0]], "2020-06-05"), keep_months=[6]))

    simn = sim20.copy(); simn.iloc[5:9, 0] = np.nan
    obsn = obs20.copy(); obsn.iloc[3:7, 0] = np.nan
    cases.append(run_case("nan-records", "NaN in sim/obs dropped before the CDF, so n is post-drop",
                          simn, obsn, fc_frame([[10.0, 20.0, 30.0, 40.0]], "2020-06-05"), keep_months=[6]))

    cases.append(run_case("month-boundary-first", "run spans Jun->Jul, useMonth=0 uses June for every step",
                          sim20, obs20, fc_frame([list(np.linspace(10, 90, 120))], "2020-06-25"), use_month=0, keep_months=[6, 7]))
    cases.append(run_case("month-boundary-last", "same run, useMonth=-1 uses July for every step",
                          sim20, obs20, fc_frame([list(np.linspace(10, 90, 120))], "2020-06-25"), use_month=-1, keep_months=[6, 7]))
    cases.append(run_case("utc-midnight", "timestamps exactly 00:00Z prove getUTCMonth not getMonth",
                          sim20, obs20, fc_frame([[15.0, 25.0, 35.0]], "2020-02-01", freq="D"), keep_months=[2]))
    cases.append(run_case("feb-29", "leap-day start", sim20, obs20,
                          fc_frame([[15.0, 25.0, 35.0]], "2020-02-29", freq="D"), keep_months=[2]))

    unsorted_fc = fc_frame([[10.0, 20.0, 30.0, 40.0]], "2020-06-05")
    unsorted_fc = unsorted_fc.iloc[[2, 0, 3, 1]]
    cases.append(run_case("unsorted-index", "sort_index() reorders the output", sim20, obs20, unsorted_fc, keep_months=[6]))

    rng = np.random.default_rng(9)
    members51 = [list(np.linspace(5, smax * 0.9, 120) * (0.7 + 0.012 * m) + rng.normal(0, 0.4, 120))
                 for m in range(51)]
    cases.append(run_case("full-51-member", "production shape: 51 members x 120 timesteps",
                          sim20, obs20, fc_frame(members51, "2020-06-05"), keep_months=[6]))

    # month absent from a record -> the reference raises
    sim_no_jun = sim20[sim20.index.month != 6]
    obs_no_jun = obs20[obs20.index.month != 6]
    cases.append(run_case("missing-month-sim", "June absent from the simulated record",
                          sim_no_jun, obs20, fc_frame([[10.0, 20.0]], "2020-06-05"), expect_raises=True, keep_months=[6, 7]))
    cases.append(run_case("missing-month-obs", "June absent from the observed record",
                          sim20, obs_no_jun, fc_frame([[10.0, 20.0]], "2020-06-05"), expect_raises=True, keep_months=[6, 7]))

    dump(os.path.join(OUT, "correct-forecast.json"),
         {"versions": versions(), "records": RECORDS, "cases": cases})

    n_inf = sum(c.get("summary", {}).get("posInf", 0) > 0 for c in cases)
    print(f"\n{len(cases)} correct_forecast cases; {n_inf} produce +Inf; "
          f"{sum('raises' in c for c in cases)} raise")





def gen_histogram_fixture() -> None:
    """Direct np.histogram cases for histogramCounts.

    buildMonthlyCdf can never place a value on the final bin edge (its bins
    overshoot the data by ~2 steps), so the closed-last-bin rule is unreachable
    through the fixtures above. histogramCounts is a general np.histogram port,
    so it is verified here directly instead.
    """
    cases = []

    def add(name, desc, values, bins):
        v = np.asarray(values, dtype=float)
        b = np.asarray(bins, dtype=float)
        counts, edges = np.histogram(v, bins=b)
        cases.append({
            "name": name, "description": desc,
            "values": v.tolist(), "bins": b.tolist(),
            "counts": counts.tolist(),
            "edgesReturned": edges.tolist(),
        })

    add("last-edge-closed", "value exactly on the final edge falls in the LAST bin",
        [0.0, 1.0, 2.0, 3.0, 2.999999], [0.0, 1.0, 2.0, 3.0])
    add("interior-edge-right-open", "value on an interior edge goes to the UPPER bin",
        [1.0, 2.0], [0.0, 1.0, 2.0, 3.0])
    add("first-edge", "value exactly on the first edge is counted",
        [0.0, 0.5], [0.0, 1.0, 2.0])
    add("outside-dropped", "values outside the range are not counted at all",
        [-5.0, 0.5, 99.0], [0.0, 1.0, 2.0])
    add("negative-bins", "bins starting below zero, as buildMonthlyCdf always does",
        [-0.5, 0.0, 0.4, 1.2], [-1.0, 0.0, 1.0, 2.0])
    add("single-bin", "one bin, closed at both ends", [0.0, 0.5, 1.0], [0.0, 1.0])
    add("all-outside", "nothing lands in range", [10.0, 20.0], [0.0, 1.0, 2.0])

    dump(os.path.join(OUT, "histogram.json"), {"versions": versions(), "cases": cases})
    print(f"  {len(cases)} histogram cases")


if __name__ == "__main__":
    main()
    print("\nhistogram")
    gen_histogram_fixture()
