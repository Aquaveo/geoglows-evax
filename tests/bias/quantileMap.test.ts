import { describe, expect, it } from 'vitest'

import {
  buildMonthlyCdf,
  flowToProbability,
  probabilityToFlow,
} from '../../src/lib/bias/quantileMap'
import { expectArrayBitEqual, expectBitEqual, reviveNumbers, seriesValues } from '../fixtures/load'
import arithmetic from '../fixtures/bias/cdf-arithmetic.json'
import probes from '../fixtures/bias/interp-probes.json'

// Layer 1: every intermediate of the CDF build, bit-for-bit against the values
// the real Python package actually used (the generator asserts its recomputed
// arrays equal the returned interp1d's own .x/.y before writing them out).
describe(`CDF build parity (geoglows ${arithmetic.versions.geoglows})`, () => {
  for (const c of arithmetic.cases) {
    it(c.name, () => {
      const got = buildMonthlyCdf(seriesValues(c.input))

      expect(got.n, 'n').toBe(c.n)
      expect(got.numberOfClasses, 'numberOfClasses').toBe(c.numberOfClasses)
      expect(got.degenerateRange, 'degenerateRange').toBe(c.degenerateRange)
      expectBitEqual(got.minVal, c.minVal, `${c.name}: minVal`)
      expectBitEqual(got.maxVal, c.maxVal, `${c.name}: maxVal`)
      expectBitEqual(got.stepWidth, c.stepWidth, `${c.name}: stepWidth`)

      expectArrayBitEqual(got.bins, reviveNumbers(c.bins), `${c.name}: bins`)
      expectArrayBitEqual(got.counts, reviveNumbers(c.counts), `${c.name}: counts`)
      expectArrayBitEqual(got.binEdges, reviveNumbers(c.binEdges), `${c.name}: binEdges`)
      expectArrayBitEqual(got.cdf, reviveNumbers(c.cdf), `${c.name}: cdf`)
    })

    it(`${c.name}: cdf[last] matches to the bit`, () => {
      // This single scalar decides whether the inverse mapping later yields a
      // finite ceiling or +Infinity, so it gets its own assertion.
      const got = buildMonthlyCdf(seriesValues(c.input))
      const last = got.cdf[got.cdf.length - 1]
      const expected = reviveNumbers(c.cdf)[c.cdf.length - 1]
      expectBitEqual(last, expected, `${c.name}: cdf[last]`)
    })
  }
})

// Layer 2: the interpolator, probed at every knot, one ULP either side of every
// knot, segment midpoints, and beyond both ends.
describe('interpolation parity', () => {
  for (const c of probes.cases) {
    it(c.name, () => {
      const cdf = buildMonthlyCdf(seriesValues(c.input))
      const inputs = reviveNumbers(c.inputs)
      const expected = reviveNumbers(c.expected)
      const evaluate = c.direction === 'toProbability' ? flowToProbability : probabilityToFlow
      for (let i = 0; i < inputs.length; i++) {
        expectBitEqual(
          evaluate(cdf, inputs[i]),
          expected[i],
          `${c.name} @ input[${i}]=${inputs[i]}`,
        )
      }
    })
  }

  it('probes actually exercise the non-finite results the reference produces', () => {
    const all = probes.cases.flatMap((c) => reviveNumbers(c.expected))
    expect(all.some((v) => !Number.isFinite(v))).toBe(true)
  })
})
