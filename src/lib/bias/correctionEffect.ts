import type { LeadBuckets } from '../types'
import type { PerLeadDistribution } from '../../plots/distributionVsLead'

/**
 * Per-lead distribution of (corrected − raw), across ensemble members.
 *
 * Matched on timestamp rather than by index: the corrected buckets hold a subset
 * of the raw ones, because excluded runs remove their timesteps entirely, so
 * positional differencing would silently compare unrelated instants.
 *
 * Worth knowing what this can and cannot show. The transfer curve is
 * lead-independent — the simulated CDF comes from the retrospective, which has no
 * lead dimension — so any lead-dependence visible here comes purely from *where
 * each lead's forecast values land on that one curve*. A trend across leads
 * therefore says the leads occupy different parts of the flow distribution, not
 * that the correction treats them differently.
 */
export function correctionEffectByLead(
  raw: LeadBuckets,
  corrected: LeadBuckets,
  maxLead = 15,
): PerLeadDistribution {
  const out: PerLeadDistribution = { leads: [], values: [], pairs: [] }

  for (let lead = 0; lead <= maxLead; lead++) {
    out.leads.push(lead)
    const rb = raw[lead]
    const cb = corrected[lead]
    const deltas: number[] = []

    if (rb && cb && rb.time.length > 0 && cb.time.length > 0) {
      const rawByTime = new Map<number, number[]>()
      for (let i = 0; i < rb.time.length; i++) rawByTime.set(rb.time[i].getTime(), rb.members[i])

      for (let i = 0; i < cb.time.length; i++) {
        const rawRow = rawByTime.get(cb.time[i].getTime())
        if (!rawRow) continue
        const corrRow = cb.members[i]
        const n = Math.min(rawRow.length, corrRow.length)
        for (let m = 0; m < n; m++) {
          const a = rawRow[m]
          const b = corrRow[m]
          if (Number.isFinite(a) && Number.isFinite(b)) deltas.push(b - a)
        }
      }
    }

    out.values.push(deltas)
    out.pairs!.push(cb ? cb.time.length : 0)
  }

  return out
}
