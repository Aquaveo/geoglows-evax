import { describe, expect, it } from 'vitest'

// Smoke test for the harness itself: confirms tests run, that the bit-exact
// comparison idiom the bias fixtures depend on behaves as expected, and that
// modules under src/ are importable from tests/ despite the extensionless
// relative imports used throughout the app.
import { describeStep } from '../src/lib/ingest/cadence'

describe('test harness', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })

  it('can import from src/', () => {
    expect(describeStep(3 * 3600 * 1000)).toBe('3-hourly')
  })

  it('Object.is treats NaN as equal to itself (the fixture comparison idiom)', () => {
    expect(Object.is(NaN, NaN)).toBe(true)
    // toBe uses Object.is, so NaN assertions work; strict === would not.
    expect(NaN).toBe(NaN)
  })

  it('distinguishes +0 from -0, which === does not', () => {
    expect(Object.is(0, -0)).toBe(false)
  })

  it('round-trips non-finite sentinels the way the fixture loader will', () => {
    const revive = (v: unknown) =>
      v === 'Infinity' ? Infinity : v === '-Infinity' ? -Infinity : v === 'NaN' ? NaN : v
    expect(revive('Infinity')).toBe(Infinity)
    expect(revive('-Infinity')).toBe(-Infinity)
    expect(Object.is(revive('NaN'), NaN)).toBe(true)
    expect(revive(1.5)).toBe(1.5)
  })
})
