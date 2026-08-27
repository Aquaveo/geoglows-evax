import { describe, expect, it } from 'vitest'

import { BiasCorrectionError, buildMonthlyCdf } from '../../src/lib/bias/quantileMap'
import { correctForecastLike, correctForecastRun } from '../../src/lib/bias/correctForecast'
import type { ForecastRun } from '../../src/lib/bias/correctForecast'
import { expectBitEqual, reviveNumbers, seriesValues } from '../fixtures/load'
import fixture from '../fixtures/bias/correct-forecast.json'

type RawSeries = { time: string[]; values: unknown[] }
const records = fixture.records as unknown as Record<string, RawSeries>

const toTimeSeries = (r: RawSeries) => ({
  // Fixture timestamps are naive ISO strings denoting UTC instants.
  time: r.time.map((t) => new Date(`${t}Z`)),
  values: seriesValues(r),
})

describe(`correct_forecast parity (geoglows ${fixture.versions.geoglows})`, () => {
  for (const c of fixture.cases) {
    const sim = toTimeSeries(records[c.simulatedRef])
    const obs = toTimeSeries(records[c.observedRef])
    const run: ForecastRun = {
      time: c.forecast.time.map((t) => new Date(`${t}Z`)),
      discharge: c.forecast.members.map((m) => reviveNumbers(m)),
    }
    const useMonth = c.useMonth as 0 | -1

    if ('raises' in c) {
      it(`${c.name}: throws where the reference raises (${c.raises})`, () => {
        expect(() => correctForecastLike(run, sim, obs, useMonth)).toThrow(BiasCorrectionError)
      })
      continue
    }

    it(`${c.name}: ${c.description}`, () => {
      const got = correctForecastLike(run, sim, obs, useMonth)

      expect(got.month, 'month used for the mapping').toBe(c.month)
      expect(got.time.map((d) => d.toISOString().replace('.000Z', '')), 'sorted time').toEqual(
        c.expected.time.map((t) => t.replace(/(\.000)?$/, '')),
      )
      expect(got.discharge.length, 'member count').toBe(c.expected.members.length)

      for (let m = 0; m < c.expected.members.length; m++) {
        const expected = reviveNumbers(c.expected.members[m])
        expect(got.discharge[m].length, `${c.name} member ${m}: length`).toBe(expected.length)
        for (let i = 0; i < expected.length; i++) {
          expectBitEqual(got.discharge[m][i], expected[i], `${c.name} member ${m}[${i}]`)
        }
      }
    })

    it(`${c.name}: non-finite accounting matches the reference`, () => {
      const got = correctForecastLike(run, sim, obs, useMonth)
      const flat = c.expected.members.flatMap((m) => reviveNumbers(m))
      expect(got.positiveInfinite, 'posInf').toBe(flat.filter((v) => v === Infinity).length)
      expect(got.rawNonFinite, 'rawNonFinite').toBe(c.summary.rawNan)
    })
  }

  it('the suite actually exercises both branches and the retained-raw rule', () => {
    const withInf = fixture.cases.filter((c) => c.summary && c.summary.posInf > 0)
    expect(withInf.length, 'cases producing +Infinity').toBeGreaterThan(0)
    expect(fixture.cases.some((c) => 'raises' in c), 'cases that raise').toBe(true)
    const keepsRaw = fixture.cases.find((c) => c.name === 'nan-mapping-keeps-raw')
    expect(keepsRaw, 'the silent-corruption fixture must exist').toBeTruthy()
  })
})

describe('below the simulated minimum — both reference outcomes', () => {
  // The mapping extrapolates off the bottom of the observed CDF there, and which
  // of two very different things happens is decided by whether the observed
  // month has anything in its lowest bin. Both are faithful to geoglows; the
  // point of these tests is that the app reports which one occurred.
  const sim = Array.from({ length: 600 }, (_, i) => 50 + 150 * ((i * 37) % 100) / 100);
  const obsClean = Array.from({ length: 600 }, (_, i) => 60 + 180 * ((i * 53) % 100) / 100);

  const runOf = (v: number) => ({
    time: [new Date(Date.UTC(2024, 5, 10))],
    discharge: [[v]],
  });
  const mappingFor = (obs: number[]) => ({
    month: 6,
    simulated: buildMonthlyCdf(sim),
    observed: buildMonthlyCdf(obs),
  });

  it('keeps the raw value when the observed lowest bin is EMPTY', () => {
    const r = correctForecastRun(runOf(20), mappingFor(obsClean) as never);
    expect(r.discharge[0][0]).toBe(20);
    expect(r.nanKeptRaw).toBe(1);
    expect(r.zeroedBelowRange).toBe(0);
  });

  it('zeroes it when the observed month holds a single 0', () => {
    // parseCsv manufactures this by clamping a negative gauge reading to 0.
    const withZero = [...obsClean.slice(0, 599), 0];
    const r = correctForecastRun(runOf(20), mappingFor(withZero) as never);
    expect(r.discharge[0][0]).toBe(0);
    expect(r.nanKeptRaw).toBe(0);
    // Without this counter the banner reported nothing at all for that flip.
    expect(r.zeroedBelowRange).toBe(1);
  });

  it('does not count a zero that was already zero in the raw forecast', () => {
    const withZero = [...obsClean.slice(0, 599), 0];
    const r = correctForecastRun(runOf(0), mappingFor(withZero) as never);
    expect(r.zeroedBelowRange).toBe(0);
  });

  it('leaves in-range values untouched by either path', () => {
    const withZero = [...obsClean.slice(0, 599), 0];
    for (const obs of [obsClean, withZero]) {
      const r = correctForecastRun(runOf(120), mappingFor(obs) as never);
      expect(r.discharge[0][0]).toBeGreaterThan(100);
      expect(r.zeroedBelowRange).toBe(0);
      expect(r.nanKeptRaw).toBe(0);
    }
  });
});

describe('B11 — dropna() drops NaN, not infinities', () => {
  // The defect: the drop test was !Number.isFinite, so +-Infinity took the
  // dropna path and skipped BOTH the mapping and clip(lower=0). The pandas
  // reference this ports drops NaN and keeps +-inf, so -inf is mapped and then
  // clipped to 0, and +inf reaches the output where the diagnostics can see it.
  // Measured before the fix: [[-Inf, Inf, 100, 110]] came out as
  // [-Infinity, +Infinity, ...] with positiveInfinite 0 — a negative discharge
  // published, and the infinity uncounted.
  const sim = Array.from({ length: 600 }, (_, i) => 50 + 150 * ((i * 37) % 100) / 100)
  const obs = Array.from({ length: 600 }, (_, i) => 60 + 180 * ((i * 53) % 100) / 100)
  const mapping = {
    month: 6,
    simulated: buildMonthlyCdf(sim),
    observed: buildMonthlyCdf(obs),
  }
  const runOf = (vals: number[]) => ({
    time: vals.map((_, i) => new Date(Date.UTC(2024, 5, 10, i))),
    discharge: [vals],
  })

  it('never publishes a negative discharge for -Infinity', () => {
    const r = correctForecastRun(runOf([-Infinity]), mapping as never)
    expect(r.discharge[0][0]).toBe(0)
    expect(r.negativeClipped).toBe(1)
  })

  it('counts +Infinity instead of passing it through unseen', () => {
    const r = correctForecastRun(runOf([Infinity]), mapping as never)
    expect(r.positiveInfinite).toBe(1)
  })

  it('still drops a genuine NaN, and counts it as such', () => {
    const r = correctForecastRun(runOf([Number.NaN]), mapping as never)
    expect(r.discharge[0][0]).toBeNaN()
    expect(r.rawNonFinite).toBe(1)
    // An infinity is no longer counted as a dropped input.
    const inf = correctForecastRun(runOf([Infinity]), mapping as never)
    expect(inf.rawNonFinite).toBe(0)
  })
})
