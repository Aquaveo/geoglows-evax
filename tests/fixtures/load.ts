import { expect } from 'vitest'

/** JSON cannot carry NaN/Infinity, so the generator emits sentinel strings. */
export function reviveNumber(v: unknown): number {
  if (typeof v === 'number') return v
  if (v === 'Infinity') return Infinity
  if (v === '-Infinity') return -Infinity
  if (v === 'NaN') return NaN
  throw new Error(`not a number or sentinel: ${JSON.stringify(v)}`)
}

export function reviveNumbers(vs: readonly unknown[]): number[] {
  return vs.map(reviveNumber)
}

export interface RawSeries {
  time: string[]
  values: unknown[]
}

/** Values of a stored series, and the calendar month of each timestamp (1-12). */
export function seriesValues(s: RawSeries): number[] {
  return reviveNumbers(s.values)
}

export function seriesMonths(s: RawSeries): number[] {
  // Fixture timestamps are naive ISO strings representing UTC instants.
  return s.time.map((t) => new Date(`${t}Z`).getUTCMonth() + 1)
}

/** Values falling in one calendar month, matching the reference's filter. */
export function monthlyValues(s: RawSeries, month: number): number[] {
  const vals = seriesValues(s)
  const months = seriesMonths(s)
  const out: number[] = []
  for (let i = 0; i < vals.length; i++) {
    if (months[i] === month && Number.isFinite(vals[i])) out.push(vals[i])
  }
  return out
}

/**
 * Bit-exact comparison. `Object.is` so NaN matches NaN and +0 does not match
 * -0; the failure message carries full precision plus hex, because the values
 * that matter here differ by one ULP.
 */
export function expectBitEqual(actual: number, expected: number, path: string): void {
  if (Object.is(actual, expected)) return
  const hex = (v: number) => (Number.isFinite(v) ? v.toString(16) : String(v))
  throw new Error(
    `${path}\n  actual   ${actual} (${hex(actual)})\n  expected ${expected} (${hex(expected)})` +
      (Number.isFinite(actual) && Number.isFinite(expected)
        ? `\n  delta    ${actual - expected}`
        : ''),
  )
}

export function expectArrayBitEqual(
  actual: readonly number[],
  expected: readonly number[],
  path: string,
): void {
  expect(actual.length, `${path}: length`).toBe(expected.length)
  for (let i = 0; i < expected.length; i++) {
    expectBitEqual(actual[i], expected[i], `${path}[${i}]`)
  }
}
