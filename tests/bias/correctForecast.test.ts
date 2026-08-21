import { describe, expect, it } from 'vitest'

import { BiasCorrectionError } from '../../src/lib/bias/quantileMap'
import { correctForecastLike } from '../../src/lib/bias/correctForecast'
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
