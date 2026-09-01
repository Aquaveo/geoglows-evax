import { describe, expect, it } from 'vitest'

import { skillByLead, skillByRun } from '../../src/lib/metrics/skillSummary'
import type { LeadBuckets, TimeSeries } from '../../src/lib/types'

const H = 3600 * 1000

function obsSeries(n: number): TimeSeries {
  const t0 = Date.UTC(2024, 5, 5)
  return {
    time: Array.from({ length: n }, (_, i) => new Date(t0 + i * 3 * H)),
    values: Array.from({ length: n }, (_, i) => 100 + 40 * Math.sin(i / 3)),
  }
}

/**
 * A bucket where every member has full coverage EXCEPT the last, which is mostly
 * NaN. This is the real shape of a fetched ensemble: cadences are union-joined
 * onto one index and padded, so members do not share coverage.
 */
function bucketWithSparseLastMember(n: number, members: number): LeadBuckets {
  const t0 = Date.UTC(2024, 5, 5)
  const time = Array.from({ length: n }, (_, i) => new Date(t0 + i * 3 * H))
  const rows = Array.from({ length: n }, (_, i) =>
    Array.from({ length: members }, (_, m) => {
      if (m === members - 1 && i > 1) return NaN // last member: 2 usable points
      return 60 + 30 * Math.sin(i / 3) + m * 0.1
    }),
  )
  return { 0: { time, members: rows } }
}

describe('skillByLead pair accounting', () => {
  it('does not let one sparse member exclude a well-covered lead', () => {
    const obs = obsSeries(40)
    const buckets = bucketWithSparseLastMember(40, 51)
    const [row] = skillByLead(buckets, obs, { minPairs: 10, maxLead: 0 })

    // Before the fix, `pairs` took the LAST member's count (2) and the whole
    // lead was dropped as "only 2 pairs" despite 50 members having 40 points.
    expect(row.skipped, 'lead must not be skipped').toBeUndefined()
    expect(row.pairs, 'pairs is the timestamp overlap, not one member').toBe(40)
    expect(row.members, 'the sparse member is excluded, the rest are scored').toBe(50)
    expect(Number.isFinite(row.nse)).toBe(true)
  })

  it('reports the timestamp overlap even when no member clears the bar', () => {
    const obs = obsSeries(40)
    // Every member sparse: 2 usable points each.
    const t0 = Date.UTC(2024, 5, 5)
    const time = Array.from({ length: 40 }, (_, i) => new Date(t0 + i * 3 * H))
    const rows = Array.from({ length: 40 }, (_, i) =>
      Array.from({ length: 51 }, () => (i > 1 ? NaN : 80)),
    )
    const [row] = skillByLead({ 0: { time, members: rows } }, obs, { minPairs: 10, maxLead: 0 })
    expect(row.members).toBe(0)
    expect(row.pairs, 'overlap is still reported honestly').toBe(40)
    expect(row.skipped).toMatch(/no member had 10 usable pairs \(best 2\)/)
  })

  it('distinguishes too-few-timesteps from too-few-usable-members', () => {
    const obs = obsSeries(4)
    const buckets = bucketWithSparseLastMember(4, 51)
    const [row] = skillByLead(buckets, obs, { minPairs: 10, maxLead: 0 })
    expect(row.skipped, 'genuinely short overlap says so').toMatch(/only 4 overlapping timesteps/)
  })

  it('excludes members whose own sample is too small from the median', () => {
    // 25 members with full coverage, 26 with only 5 points. A member with 5
    // points yields a noisy score that must not enter the median.
    const obs = obsSeries(40)
    const t0 = Date.UTC(2024, 5, 5)
    const time = Array.from({ length: 40 }, (_, i) => new Date(t0 + i * 3 * H))
    const rows = Array.from({ length: 40 }, (_, i) =>
      Array.from({ length: 51 }, (_, m) => {
        if (m >= 25 && i >= 5) return NaN
        return 60 + 30 * Math.sin(i / 3)
      }),
    )
    const [row] = skillByLead({ 0: { time, members: rows } }, obs, { minPairs: 10, maxLead: 0 })
    expect(row.members, 'only the 25 well-covered members are scored').toBe(25)
  })
})

describe('skillByRun pair accounting', () => {
  it('applies the same member-independent counting', () => {
    const obs = obsSeries(40)
    const t0 = Date.UTC(2024, 5, 5)
    const time = Array.from({ length: 40 }, (_, i) => new Date(t0 + i * 3 * H))
    const discharge = Array.from({ length: 51 }, (_, m) =>
      Array.from({ length: 40 }, (_, i) =>
        m === 50 && i > 1 ? NaN : 60 + 30 * Math.sin(i / 3),
      ),
    )
    const [row] = skillByRun(new Map([['20240605', { time, discharge }]]), obs, { minPairs: 10 })
    expect(row.skipped).toBeUndefined()
    expect(row.pairs).toBe(40)
    expect(row.members).toBe(50)
  })
})
