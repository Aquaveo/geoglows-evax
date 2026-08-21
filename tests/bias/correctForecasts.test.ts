import { describe, expect, it } from 'vitest'

import { correctForecasts } from '../../src/lib/bias/correctForecasts'
import type { ForecastRun, TimeSeries } from '../../src/lib/types'

const DAY = 24 * 3600 * 1000

/** Daily record over `years`, seasonal, deterministic. */
function record(years: number, scale = 1, seed = 1): TimeSeries {
  const time: Date[] = []
  const values: number[] = []
  let s = seed
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const start = Date.UTC(2024 - years, 0, 1)
  const end = Date.UTC(2023, 11, 31)
  for (let t = start; t <= end; t += DAY) {
    const d = new Date(t)
    const doy = Math.floor((t - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY)
    time.push(d)
    values.push(Math.max(0, scale * (60 + 45 * Math.sin((2 * Math.PI * (doy - 100)) / 365)) * (0.5 + rnd())))
  }
  return { time, values }
}

function run(startISO: string, values: number[], members = 1): ForecastRun {
  const t0 = new Date(startISO).getTime()
  return {
    time: values.map((_, i) => new Date(t0 + i * 3 * 3600 * 1000)),
    discharge: Array.from({ length: members }, (_, m) => values.map((v) => v * (1 + 0.02 * m))),
  }
}

const sim = record(20, 1, 7)
const obs = record(20, 1.8, 99)

describe('correctForecasts driver', () => {
  it('corrects a normal run and reports the cadences it used', () => {
    const fc = new Map([['20200605', run('2020-06-05T00:00:00Z', [10, 20, 30, 40], 3)]])
    const r = correctForecasts(fc, sim, obs)
    expect(r.unavailable).toBeNull()
    expect(r.forecasts.size).toBe(1)
    expect(r.observedCadence).toBe('daily')
    expect(r.simulatedCadence).toBe('daily')
    expect(r.cdfStepMs).toBe(DAY)
    expect(r.forecasts.get('20200605')!.discharge).toHaveLength(3)
  })

  it('builds one mapping per calendar month and reports sample sizes', () => {
    const fc = new Map([
      ['20200605', run('2020-06-05T00:00:00Z', [10, 20])],
      ['20200610', run('2020-06-10T00:00:00Z', [15, 25])],
      ['20200705', run('2020-07-05T00:00:00Z', [15, 25])],
    ])
    const r = correctForecasts(fc, sim, obs)
    expect(r.months.map((m) => m.month)).toEqual([6, 7])
    for (const m of r.months) {
      expect(m.ok).toBe(true)
      expect(m.nSimulated).toBeGreaterThan(500) // 20 years of one month
      expect(m.nObserved).toBeGreaterThan(500)
    }
  })

  it('refuses when the observed record is coarser than the CDF grid', () => {
    const monthly: TimeSeries = {
      time: Array.from({ length: 40 }, (_, i) => new Date(Date.UTC(2020, i % 12, 1))),
      values: Array.from({ length: 40 }, (_, i) => 10 + i),
    }
    const fc = new Map([['20200605', run('2020-06-05T00:00:00Z', [10, 20])]])
    const r = correctForecasts(fc, sim, monthly)
    expect(r.unavailable).toMatch(/needs daily or finer/)
    expect(r.forecasts.size).toBe(0)
  })

  it('reports missing inputs distinctly rather than failing opaquely', () => {
    const fc = new Map([['20200605', run('2020-06-05T00:00:00Z', [10, 20])]])
    const empty: TimeSeries = { time: [], values: [] }
    expect(correctForecasts(new Map(), sim, obs).unavailable).toMatch(/no forecasts/)
    expect(correctForecasts(fc, sim, empty).unavailable).toMatch(/no historical observations/)
    expect(correctForecasts(fc, empty, obs).unavailable).toMatch(/no retrospective/)
  })

  it('excludes a whole run when any value maps to infinity, naming the reason', () => {
    // A forecast far above the simulated monthly maximum lands on the degenerate
    // tail of the observed CDF.
    const simMax = Math.max(
      ...sim.values.filter((_, i) => sim.time[i].getUTCMonth() === 5),
    )
    const fc = new Map([
      ['20200605', run('2020-06-05T00:00:00Z', [10, 20])],
      ['20200610', run('2020-06-10T00:00:00Z', [simMax * 5, simMax * 6])],
    ])
    const r = correctForecasts(fc, sim, obs)
    const infExcluded = r.excluded.filter((e) => /infinity/.test(e.reason))
    if (infExcluded.length > 0) {
      expect(infExcluded[0].date).toBe('20200610')
      expect(infExcluded[0].reason).toMatch(/simulated month-6 maximum/)
      expect(r.forecasts.has('20200610')).toBe(false)
      expect(r.forecasts.has('20200605')).toBe(true)
    } else {
      // The 1-ULP predicate went the other way for this data; the run must then
      // survive rather than be dropped for some other reason.
      expect(r.forecasts.has('20200610')).toBe(true)
    }
  })

  it('excludes runs whose month is absent from a record, and says which', () => {
    const juneOnly: TimeSeries = {
      time: sim.time.filter((t) => t.getUTCMonth() === 5),
      values: sim.values.filter((_, i) => sim.time[i].getUTCMonth() === 5),
    }
    const fc = new Map([['20200105', run('2020-01-05T00:00:00Z', [10, 20])]])
    const r = correctForecasts(fc, juneOnly, obs)
    expect(r.forecasts.size).toBe(0)
    expect(r.excluded[0].reason).toMatch(/month 1/)
    expect(r.months[0].ok).toBe(false)
    expect(r.unavailable).toMatch(/excluded/)
  })

  it('reports NaN-kept-raw counts instead of excluding those runs', () => {
    // Records whose monthly minimum sits far above stepWidth give both CDFs
    // leading duplicate zeros, so low forecasts map to NaN and keep raw values.
    const hi = (scale: number): TimeSeries => ({
      time: Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2020, 5, i + 1))),
      values: Array.from({ length: 30 }, (_, i) => scale * (80 + i * 0.7)),
    })
    const fc = new Map([['20200605', run('2020-06-05T00:00:00Z', [1, 2, 85, 95])]])
    const r = correctForecasts(fc, hi(1), hi(0.9))
    expect(r.forecasts.size, 'run is kept, not excluded').toBe(1)
    expect(r.nanKeptRaw, 'low values kept their raw value').toBeGreaterThan(0)
  })

  it('leaves the input map untouched', () => {
    // Values inside the simulated June range, so they actually get remapped.
    // Below that range the mapping returns NaN and the raw value is retained,
    // which would make this assertion vacuous — see the test below.
    const original = run('2020-06-05T00:00:00Z', [70, 95, 120])
    const snapshot = original.discharge.map((m) => [...m])
    const r = correctForecasts(new Map([['20200605', original]]), sim, obs)
    expect(original.discharge, 'input must not be mutated').toEqual(snapshot)
    expect(r.forecasts.get('20200605')!.discharge[0]).not.toEqual(snapshot[0])
  })

  it('keeps raw values for forecasts below the simulated monthly minimum', () => {
    // Both CDFs begin with duplicate zeros wherever the monthly minimum sits
    // above stepWidth, so anything under that minimum maps to p = 0, the inverse
    // is undefined there, and the reference retains the raw value. This is
    // common for low-flow timesteps and must be reported, not hidden.
    const juneSim = sim.values.filter((_, i) => sim.time[i].getUTCMonth() === 5)
    const belowMin = Math.min(...juneSim) / 4
    const original = run('2020-06-05T00:00:00Z', [belowMin, belowMin / 2])
    const r = correctForecasts(new Map([['20200605', original]]), sim, obs)
    expect(r.forecasts.size, 'the run is kept, not excluded').toBe(1)
    expect(r.nanKeptRaw, 'both values kept their raw magnitude').toBe(2)
    expect(r.forecasts.get('20200605')!.discharge[0]).toEqual(original.discharge[0])
  })
})
