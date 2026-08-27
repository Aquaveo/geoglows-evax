import type { LeadBuckets } from '../types'
import type { PerLeadDistribution } from '../../plots/distributionVsLead'

/**
 * Per-lead distribution of (corrected − raw), across ensemble members.
 *
 * Matched on timestamp rather than by index: the corrected buckets hold a subset
 * of the raw ones, because excluded runs remove their timesteps entirely, so
 * positional differencing would silently compare unrelated instants.
 *
 * `pairs` counts the timesteps that produced a delta, not the corrected rows.
 * The two differ whenever a row is skipped for having no raw counterpart, or
 * yields nothing because every member is non-finite on one side. Note these are
 * NOT forecast/observation pairs — no observations enter this comparison — but
 * the field keeps its name so the plot's hover reads the same as every other
 * distribution's.
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
    /** Timesteps that actually produced at least one raw/corrected delta. */
    let contributing = 0

    if (rb && cb && rb.time.length > 0 && cb.time.length > 0) {
      const rawByTime = new Map<number, number[]>()
      for (let i = 0; i < rb.time.length; i++) rawByTime.set(rb.time[i].getTime(), rb.members[i])

      for (let i = 0; i < cb.time.length; i++) {
        const rawRow = rawByTime.get(cb.time[i].getTime())
        if (!rawRow) continue
        const corrRow = cb.members[i]
        const n = Math.min(rawRow.length, corrRow.length)
        const before = deltas.length
        for (let m = 0; m < n; m++) {
          const a = rawRow[m]
          const b = corrRow[m]
          if (Number.isFinite(a) && Number.isFinite(b)) deltas.push(b - a)
        }
        // Only a row that produced at least one delta is evidence behind this
        // box. Counting `cb.time.length` instead counted rows that contributed
        // nothing: a row whose timestamp has no raw counterpart is skipped
        // above, and a row where every member is non-finite on one side yields
        // no delta at all — which is exactly what a failed mapping looks like.
        // Measured on a 3-row corrected bucket with one all-NaN row, it reported
        // 3 timesteps behind a box built from 2.
        if (deltas.length > before) contributing += 1
      }
    }

    out.values.push(deltas)
    out.pairs!.push(contributing)
  }

  return out
}
