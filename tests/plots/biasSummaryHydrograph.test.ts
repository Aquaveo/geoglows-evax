import { describe, expect, it } from 'vitest'
import {
  biasSummaryHydrographFigure,
  summaryFromMembers,
  type SummaryBand,
} from '../../src/plots/biasSummaryHydrograph'

const H = 3600e3
const t0 = Date.UTC(2024, 9, 29)

function band(n: number, scale: number): SummaryBand {
  const time = Array.from({ length: n }, (_, i) => new Date(t0 + i * 3 * H))
  return {
    time,
    median: time.map((_, i) => scale * (10 + Math.sin(i / 6))),
    lower: time.map((_, i) => scale * (8 + Math.sin(i / 6))),
    upper: time.map((_, i) => scale * (12 + Math.sin(i / 6))),
  }
}

describe('biasSummaryHydrographFigure', () => {
  const fig = biasSummaryHydrographFigure(band(40, 1), band(40, 3), {
    label: '2024-10-29',
    riverId: 210265545,
  })

  it('places each band as an invisible lower edge immediately before its filled upper edge', () => {
    // `fill: 'tonexty'` fills to the IMMEDIATELY PRECEDING trace. If anything is
    // ever inserted between the two edges of a band, the fill silently reaches
    // for the wrong series and the shading becomes nonsense. This pins adjacency.
    const idx = fig.data
      .map((d, i) => ({ d: d as Record<string, unknown>, i }))
      .filter(({ d }) => d.fill === 'tonexty')
    expect(idx).toHaveLength(2)
    for (const { i } of idx) {
      const prev = fig.data[i - 1] as Record<string, unknown>
      expect(prev.fill).toBeUndefined()
      expect((prev.line as { width: number }).width).toBe(0)
      expect(prev.showlegend).toBe(false)
    }
  })

  it('draws bands before any median line so shading never covers a line', () => {
    const lastBand = Math.max(
      ...fig.data
        .map((d, i) => ((d as Record<string, unknown>).fill === 'tonexty' ? i : -1))
        .filter((i) => i >= 0),
    )
    const firstMedian = fig.data.findIndex(
      (d) =>
        (d as { name?: string }).name === 'Original' ||
        (d as { name?: string }).name === 'Bias corrected',
    )
    expect(firstMedian).toBeGreaterThan(lastBand)
  })

  it('labels both series directly at their right-hand end', () => {
    const texts = (fig.layout.annotations ?? []).map((a) => String(a.text))
    expect(texts.some((t) => t.startsWith('Original'))).toBe(true)
    expect(texts.some((t) => t.startsWith('Bias corrected'))).toBe(true)
  })

  it('extends the x range past the data to make room for those labels', () => {
    const [, hi] = fig.layout.xaxis!.range as [string, string]
    const dataEnd = t0 + 39 * 3 * H
    expect(new Date(hi).getTime()).toBeGreaterThan(dataEnd)
  })

  it('renders gaps as null rather than zero', () => {
    const holed = band(6, 1)
    holed.median[2] = NaN
    const f = biasSummaryHydrographFigure(holed, band(6, 2), { label: 'x' })
    const med = f.data.find((d) => (d as { name?: string }).name === 'Original') as { y: unknown[] }
    expect(med.y[2]).toBeNull()
  })

  it('overlays observations when given, and omits the trace when not', () => {
    const obs = { time: [new Date(t0)], values: [42] }
    const withObs = biasSummaryHydrographFigure(band(4, 1), band(4, 2), {
      label: 'x',
      observed: obs,
    })
    expect(withObs.data.some((d) => (d as { name?: string }).name === 'Observed')).toBe(true)
    expect(fig.data.some((d) => (d as { name?: string }).name === 'Observed')).toBe(false)
  })
})

describe('summaryFromMembers', () => {
  it('takes percentiles across members at each timestep, not along time', () => {
    const time = [new Date(t0), new Date(t0 + 3 * H)]
    // Timestep 0 spans 0..100; timestep 1 is constant.
    const members = [
      [0, 5],
      [50, 5],
      [100, 5],
    ]
    const s = summaryFromMembers(time, members)
    expect(s.median[0]).toBe(50)
    expect(s.lower[0]).toBeCloseTo(20, 10)
    expect(s.upper[0]).toBeCloseTo(80, 10)
    expect(s.median[1]).toBe(5)
    expect(s.lower[1]).toBe(5)
  })

  it('ignores non-finite members instead of letting them poison the quantile', () => {
    const time = [new Date(t0)]
    const s = summaryFromMembers(time, [[10], [NaN], [20], [Infinity], [30]])
    expect(s.median[0]).toBe(20)
    expect(Number.isFinite(s.lower[0])).toBe(true)
  })

  it('reports NaN for a timestep where every member is missing', () => {
    const s = summaryFromMembers([new Date(t0)], [[NaN], [NaN]])
    expect(Number.isNaN(s.median[0])).toBe(true)
    expect(Number.isNaN(s.lower[0])).toBe(true)
  })
})
