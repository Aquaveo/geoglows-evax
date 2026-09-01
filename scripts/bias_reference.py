"""Shared capture helpers for bias-correction fixtures.

Everything here drives the REAL installed `geoglows` package. The point of the
fixtures is to prove the TypeScript port matches the package, so nothing in this
file may reimplement the algorithm -- it may only recompute intermediates and
assert they agree with what the package actually built.
"""
from __future__ import annotations

import json
import math

import numpy as np
import pandas as pd
from scipy import interpolate

import geoglows
from geoglows.bias import _flow_and_probability_mapper


def versions() -> dict:
    import scipy
    return {
        "geoglows": geoglows.__version__,
        "numpy": np.__version__,
        "scipy": scipy.__version__,
        "pandas": pd.__version__,
    }


def capture_cdf(monthly: pd.DataFrame, direction: str) -> dict:
    """Recompute _flow_and_probability_mapper's intermediates and PROVE they are
    the ones the package used, by comparing against the returned interp1d's own
    .x/.y arrays.

    direction: 'toProbability' -> interp1d(binEdges, cdf)
               'toFlow'        -> interp1d(cdf, binEdges)
    """
    to_prob = direction == "toProbability"
    f = _flow_and_probability_mapper(
        monthly, to_probability=to_prob, to_flow=not to_prob, extrapolate=True
    )

    # --- recomputation, mirroring the package's expressions exactly ---
    max_val = math.ceil(np.max(monthly.max()))
    min_val = math.floor(np.min(monthly.min()))
    degenerate = max_val == min_val
    if degenerate:
        max_val += 0.1
    number_of_points = len(monthly.values)
    number_of_classes = math.ceil(1 + (3.322 * math.log10(number_of_points)))
    step_width = (max_val - min_val) / number_of_classes
    bins = np.arange(-np.min(step_width), max_val + 2 * np.min(step_width), np.min(step_width))
    counts, bin_edges = np.histogram(monthly, bins=bins)
    bin_edges = bin_edges[1:]
    counts = counts.astype(float) / monthly.size
    cdf = np.cumsum(counts)

    # The assertion that makes these intermediates trustworthy: whichever array
    # the package used as its interpolation x-axis must match ours exactly.
    if to_prob:
        assert np.array_equal(bin_edges, f.x), "recomputed binEdges != package interp1d.x"
        assert np.array_equal(cdf, f.y), "recomputed cdf != package interp1d.y"
    else:
        assert np.array_equal(cdf, f.x), "recomputed cdf != package interp1d.x"
        assert np.array_equal(bin_edges, f.y), "recomputed binEdges != package interp1d.y"

    return {
        "direction": direction,
        "n": int(monthly.size),
        "numberOfPoints": int(number_of_points),
        "minVal": min_val,
        "maxVal": max_val,
        "degenerateRange": bool(degenerate),
        "numberOfClasses": int(number_of_classes),
        "stepWidth": step_width,
        "stepWidthHex": float(step_width).hex(),
        "bins": bins.tolist(),
        "counts": counts.tolist(),
        "binEdges": bin_edges.tolist(),
        "cdf": cdf.tolist(),
        # One scalar per CDF decides the whole +Infinity branch; record it in hex
        # so a 1-ULP accumulation difference is diagnosable at a glance.
        "cdfLastHex": float(cdf[-1]).hex(),
        "trailingFlatSegments": int(np.sum(np.diff(cdf) == 0)),
    }


def probe_points(f: interpolate.interp1d) -> list[float]:
    """Probe grid that pins searchsorted sides, extrapolation on both ends, and
    the degenerate tail."""
    x = np.asarray(f.x, dtype=float)
    pts: list[float] = []
    for v in x:
        pts += [float(v), float(np.nextafter(v, -np.inf)), float(np.nextafter(v, np.inf))]
    pts += [float((x[i] + x[i + 1]) / 2) for i in range(len(x) - 1)]
    span = float(x[-1] - x[0]) or 1.0
    pts += [float(x[0] - span), float(x[-1] + span), 0.0]
    # dedupe, keep order stable
    seen, out = set(), []
    for p in pts:
        k = float(p).hex()
        if k not in seen:
            seen.add(k)
            out.append(float(p))
    return out


def capture_probes(monthly: pd.DataFrame, direction: str) -> dict:
    to_prob = direction == "toProbability"
    f = _flow_and_probability_mapper(
        monthly, to_probability=to_prob, to_flow=not to_prob, extrapolate=True
    )
    pts = probe_points(f)
    with np.errstate(divide="ignore", invalid="ignore"):
        vals = [float(f(p)) for p in pts]
    return {"direction": direction, "inputs": pts, "expected": vals}


class Enc(json.JSONEncoder):
    """Bare NaN/Infinity tokens are invalid JSON and JSON.parse rejects them, so
    non-finite values are emitted as sentinel strings the TS loader revives."""

    def default(self, o):
        if isinstance(o, (np.integer,)):
            return int(o)
        if isinstance(o, (np.floating,)):
            return self.default(float(o))
        if isinstance(o, np.ndarray):
            return o.tolist()
        return super().default(o)


def sanitize(o):
    if isinstance(o, float):
        if math.isnan(o):
            return "NaN"
        if math.isinf(o):
            return "Infinity" if o > 0 else "-Infinity"
        return o
    if isinstance(o, (np.floating,)):
        return sanitize(float(o))
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, np.ndarray):
        return [sanitize(x) for x in o.tolist()]
    if isinstance(o, dict):
        return {k: sanitize(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [sanitize(x) for x in o]
    return o


def dump(path, obj) -> None:
    with open(path, "w") as fh:
        json.dump(sanitize(obj), fh, allow_nan=False, indent=1)
    print(f"  wrote {path}")


def series_json(df: pd.DataFrame) -> dict:
    idx = df.index
    if getattr(idx, "tz", None) is not None:
        idx = idx.tz_localize(None)
    return {
        "time": [t.isoformat() for t in idx],
        "values": [float(v) for v in df.iloc[:, 0].to_numpy()],
    }
