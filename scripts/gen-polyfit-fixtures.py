"""Fixtures pinning the TypeScript port of geoglows.bias.discharge_transform.

Runs the real installed package and records inputs alongside outputs, so the
port is checked against the reference rather than against my reading of it.
"""
import json
import os

import numpy as np
import pandas as pd
import geoglows

RIVERS = [210265545]
OUT = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures', 'bias')


def jsonable(x):
    """Serialise non-finite floats as sentinels rather than invalid JSON."""
    v = float(x)
    if np.isnan(v):
        return 'NaN'
    if np.isposinf(v):
        return 'Infinity'
    if np.isneginf(v):
        return '-Infinity'
    return v


def main():
    os.makedirs(OUT, exist_ok=True)
    cases = []

    for river in RIVERS:
        ds = geoglows.bias.polyfits(river_id=river)
        coefficients = {}
        for month in range(1, 13):
            coefficients[str(month)] = {
                'qrange': [jsonable(v) for v in ds['Qrange'].sel(month=month).values],
                'qtop': [jsonable(v) for v in ds['QtoP'].sel(month=month).values],
                'ptoq': [jsonable(v) for v in ds['PtoQ'].sel(month=month).values],
            }

        # Probe every month across and beyond its own Qrange, so the fixture
        # covers the clip branches at both ends rather than only the interior.
        probes = []
        for month in range(1, 13):
            qmax = float(ds['Qrange'].sel(month=month).values[1])
            grid = sorted(set(
                [0.0, 1e-6, 0.1, 1.0, 5.0, 10.0, 20.0, 50.0]
                + list(np.linspace(0, max(qmax, 1e-6), 40))
                + [qmax * 0.999, qmax, qmax * 1.001, qmax * 10, 1e6]
            ))
            index = pd.date_range(f'2024-{month:02d}-01', periods=len(grid), freq='h', tz='UTC')
            frame = pd.DataFrame({'q': grid}, index=index)
            out = geoglows.bias.discharge_transform(frame, river)
            for q, r in zip(grid, out['q'].values):
                probes.append({'month': month, 'input': jsonable(q), 'expected': jsonable(r)})

        cases.append({'riverId': river, 'coefficients': coefficients, 'probes': probes})

    with open(os.path.join(OUT, 'polyfit-transform.json'), 'w') as f:
        json.dump({'cases': cases}, f)
    print(f'wrote polyfit-transform.json: {len(cases)} rivers, '
          f'{sum(len(c["probes"]) for c in cases)} probe points')

    # A real forecast run end to end, exactly as the user runs it.
    river, date = 210265545, '20241025'
    fc = geoglows.data.forecast(river_id=river, date=date, format='df')
    bc = geoglows.bias.discharge_transform(fc, river)
    run = {
        'riverId': river,
        'date': date,
        'time': [t.isoformat() for t in fc.index],
        'columns': list(fc.columns),
        'original': {c: [jsonable(v) for v in fc[c].values] for c in fc.columns},
        'corrected': {c: [jsonable(v) for v in bc[c].values] for c in bc.columns},
    }
    with open(os.path.join(OUT, 'polyfit-run.json'), 'w') as f:
        json.dump(run, f)
    print(f'wrote polyfit-run.json: {len(fc)} rows x {len(fc.columns)} columns')


if __name__ == '__main__':
    main()
