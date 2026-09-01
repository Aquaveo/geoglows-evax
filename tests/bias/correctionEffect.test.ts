import { describe, expect, it } from 'vitest'
import { correctionEffectByLead } from '../../src/lib/bias/correctionEffect'
import type { LeadBuckets } from '../../src/lib/types'

const t = (h: number) => new Date(Date.UTC(2019, 5, 1) + h * 3600e3)

describe('correctionEffectByLead', () => {
  it('differences on timestamp, not on position', () => {
    const raw: LeadBuckets = {
      1: { time: [t(3), t(6), t(9)], members: [[10, 20], [30, 40], [50, 60]] },
    }
    // Corrected is missing the FIRST timestamp, so positional differencing would
    // compare t(6)'s corrected values against t(3)'s raw ones.
    const corrected: LeadBuckets = {
      1: { time: [t(6), t(9)], members: [[33, 44], [55, 66]] },
    }
    const eff = correctionEffectByLead(raw, corrected, 1)
    expect(eff.values[1].sort((a, b) => a - b)).toEqual([3, 4, 5, 6])
  })

  it('counts timesteps that produced a delta, not corrected rows', () => {
    // The defect: pairs was cb.time.length, so it counted rows contributing
    // nothing. Here the middle row is all-NaN — what a failed mapping looks
    // like — so 3 corrected rows rest on only 2 timesteps of evidence.
    const raw: LeadBuckets = {
      1: { time: [t(3), t(6), t(9)], members: [[10, 11], [20, 21], [30, 31]] },
    }
    const corrected: LeadBuckets = {
      1: { time: [t(3), t(6), t(9)], members: [[12, 13], [NaN, NaN], [33, 34]] },
    }
    const eff = correctionEffectByLead(raw, corrected, 1)
    expect(eff.values[1]).toHaveLength(4)
    expect(eff.pairs![1]).toBe(2)
  })

  it('does not count a corrected timestamp with no raw counterpart', () => {
    // Skipped by the differencing loop already; the counter has to agree with it.
    const raw: LeadBuckets = { 1: { time: [t(3)], members: [[10, 11]] } }
    const corrected: LeadBuckets = {
      1: { time: [t(3), t(99)], members: [[12, 13], [1, 2]] },
    }
    const eff = correctionEffectByLead(raw, corrected, 1)
    expect(eff.values[1]).toHaveLength(2)
    expect(eff.pairs![1]).toBe(1)
  })

  it('reports zero for a lead with no corrected data', () => {
    const raw: LeadBuckets = { 1: { time: [t(3)], members: [[10]] } }
    const eff = correctionEffectByLead(raw, {}, 1)
    expect(eff.values[1]).toEqual([])
    expect(eff.pairs![1]).toBe(0)
  })
})
