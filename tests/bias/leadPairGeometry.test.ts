import { describe, expect, it } from 'vitest'

import { reorganizeByLead } from '../../src/lib/leadBuckets'
import { aggregateBucket, aggregateSeries } from '../../src/lib/ingest/grid'
import { countAlignedPairs } from '../../src/lib/alignment'
import { skillByLead } from '../../src/lib/metrics/skillSummary'
import type { ForecastRun, TimeSeries } from '../../src/lib/types'

const H = 3600_000
const D = 24 * H

/**
 * Regression for the corrected-variant pair-count collapse.
 *
 * reorganizeByLead gives each run one contiguous 24-hour block per lead, so the
 * pairs at a lead are a plain SUM of all-or-nothing per-run blocks. Excluding
 * whole runs therefore makes the per-lead count a step function over *which
 * init dates survived*, with no reason to be monotonic in lead — and it can be
 * exactly zero at a lead whose only contributing runs were excluded, while the
 * bucket itself is still non-empty.
 *
 * The numbers below were measured on the real event (8112_RT, 2024-10-28..31)
 * with the 19 real forecast runs, where bias correction excluded the six runs
 * nearest the flood because their forecasts exceeded the simulated October
 * maximum and mapped to infinity.
 */
const EVENT_START = Date.UTC(2024, 9, 28, 4) // 2024-10-28 04:00Z
const EVENT_END = Date.UTC(2024, 9, 31, 13) // 2024-10-31 13:00Z
const GRID = 3 * H

/** Hourly observations over the event, with the real 5-hour gap. */
function observations(): TimeSeries {
  const gapFrom = Date.UTC(2024, 9, 29, 19)
  const gapTo = Date.UTC(2024, 9, 29, 23)
  const time: Date[] = []
  const values: number[] = []
  for (let t = EVENT_START; t <= EVENT_END; t += H) {
    if (t >= gapFrom && t <= gapTo) continue // parser drops blank rows
    time.push(new Date(t))
    values.push(10 + Math.sin(t / 1e7))
  }
  return { time, values }
}

/** 19 daily runs, 3-hourly, 15-day horizon — the app's download window. */
function runs(excluded: Set<string>): Map<string, ForecastRun> {
  const out = new Map<string, ForecastRun>()
  const first = Date.UTC(2024, 9, 13)
  for (let i = 0; i < 19; i++) {
    const t0 = first + i * D
    const d = new Date(t0)
    const key = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(
      d.getUTCDate(),
    ).padStart(2, '0')}`
    if (excluded.has(key)) continue
    // The real client returns timesteps starting AT t0 (offsets 0, 3, 6 ...),
    // so reorganizeByLead's lead 0 gets exactly one row per run rather than
    // being empty. Verified against a live fetch.
    const time: Date[] = []
    for (let k = 0; k < 120; k++) time.push(new Date(t0 + k * 3 * H))
    out.set(key, {
      time,
      discharge: Array.from({ length: 51 }, () => time.map((_, j) => 5 + (j % 7))),
    })
  }
  return out
}

function pairsPerLead(excluded: Set<string>) {
  const obs = aggregateSeries(observations(), GRID, 'mean')
  const buckets = reorganizeByLead(runs(excluded), 15)
  const pairs: number[] = []
  const bucketRows: number[] = []
  for (let lead = 0; lead <= 15; lead++) {
    const g = aggregateBucket(buckets[lead], GRID, 'mean')
    pairs.push(countAlignedPairs(g.time, obs))
    bucketRows.push(g.time.length)
  }
  return { pairs, bucketRows, obsBins: obs.time.length }
}

const EXCLUDED_BY_CORRECTION = new Set([
  '20241023',
  '20241025',
  '20241026',
  '20241027',
  '20241028',
  '20241029',
])

describe('per-lead pair geometry under whole-run exclusion', () => {
  it('with every run present, pairs equal the observation bins at all usable leads', () => {
    const { pairs, obsBins } = pairsPerLead(new Set())
    expect(obsBins, '3.4 days of hourly obs on a 3-hourly grid').toBe(27)
    // Leads 1..14 are fully covered; lead 0 holds exactly one t0 sample per run
    // and lead 15 is truncated by the download window.
    for (let lead = 1; lead <= 14; lead++) {
      expect(pairs[lead], `lead ${lead}`).toBe(27)
    }
  })

  it('excluding the six runs nearest the event reproduces the observed collapse', () => {
    const { pairs } = pairsPerLead(EXCLUDED_BY_CORRECTION)
    // Measured on the real data; leads 3 and 4 are exactly zero.
    expect(pairs.slice(0, 8)).toEqual([2, 12, 4, 0, 0, 8, 7, 16])
    expect(pairs.slice(10, 15)).toEqual([27, 27, 27, 27, 27])
  })

  it('a zero-pair lead still has a NON-EMPTY bucket, so the reason must say so', () => {
    // This is the discriminator: "only 0 overlapping timesteps" (the bucket has
    // rows, they just fall outside the event) versus "no forecast data".
    const { pairs, bucketRows } = pairsPerLead(EXCLUDED_BY_CORRECTION)
    expect(pairs[3]).toBe(0)
    expect(bucketRows[3], 'bucket is populated by runs outside the event window').toBeGreaterThan(0)

    const obs = aggregateSeries(observations(), GRID, 'mean')
    const buckets = reorganizeByLead(runs(EXCLUDED_BY_CORRECTION), 15)
    const gridded: Record<number, ReturnType<typeof aggregateBucket>> = {}
    for (let lead = 0; lead <= 15; lead++) gridded[lead] = aggregateBucket(buckets[lead], GRID, 'mean')
    const rows = skillByLead(gridded, obs, { minPairs: 10, maxLead: 15 })
    expect(rows[3].pairs).toBe(0)
    expect(rows[3].skipped).toMatch(/only 0 overlapping timesteps/)
    expect(rows[3].skipped).not.toMatch(/no forecast data/)
  })

  it('the collapse is non-monotonic in lead, which no coverage story explains', () => {
    const { pairs } = pairsPerLead(EXCLUDED_BY_CORRECTION)
    // 4 -> 0 -> 0 -> 8: rises after falling to zero. A step function over an
    // arbitrary subset of a sliding window has no reason to be monotone, which
    // is why this pattern is the signature of run exclusion rather than of
    // missing observations.
    expect(pairs[2]).toBeGreaterThan(pairs[3])
    expect(pairs[5]).toBeGreaterThan(pairs[4])
  })
})
