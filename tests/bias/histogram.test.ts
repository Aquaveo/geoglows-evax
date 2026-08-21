import { describe, expect, it } from 'vitest'

import { arange, histogramCounts } from '../../src/lib/bias/quantileMap'
import { reviveNumbers } from '../fixtures/load'
import fixture from '../fixtures/bias/histogram.json'

// buildMonthlyCdf's bins always overshoot the data, so the closed-last-bin rule
// is unreachable through the CDF fixtures. histogramCounts is a general
// np.histogram port, so it is pinned directly here.
describe(`np.histogram parity (numpy ${fixture.versions.numpy})`, () => {
  for (const c of fixture.cases) {
    it(`${c.name}: ${c.description}`, () => {
      const got = histogramCounts(reviveNumbers(c.values), reviveNumbers(c.bins))
      expect(got).toEqual(c.counts)
    })
  }
})

describe('arange parity', () => {
  it('length is ceil((stop - start) / step)', () => {
    expect(arange(-47, 541 + 2 * 47, 47).length).toBe(15)
    expect(arange(-0.1, 1.2, 0.1).length).toBe(13)
  })

  it('computes start + i*step rather than accumulating', () => {
    // Accumulation drifts; this value is exact only with multiplication.
    const a = arange(-0.1, 1.2, 0.1)
    expect(a[10]).toBe(-0.1 + 10 * 0.1)
  })

  it('returns empty for non-positive spans', () => {
    expect(arange(5, 5, 1)).toEqual([])
    expect(arange(5, 1, 1)).toEqual([])
  })
})
