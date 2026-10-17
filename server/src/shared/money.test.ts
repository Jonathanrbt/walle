import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DomainError } from './errors.ts'
import {
  add,
  compare,
  formatDecimal,
  isZero,
  money,
  parseDecimal,
  rescale,
  subtract,
} from './money.ts'

const COP = 'COP'
const USDC = 'USDC'

describe('money', () => {
  it('formats scale 2 without trailing garbage', () => {
    expect(formatDecimal(money(2427n, USDC, 2))).toBe('24.27')
    expect(formatDecimal(money(10000000n, COP, 2))).toBe('100000.00')
    expect(formatDecimal(money(10n, USDC, 2))).toBe('0.10')
    expect(formatDecimal(money(0n, USDC, 2))).toBe('0.00')
    expect(formatDecimal(money(24n, USDC, 0))).toBe('24')
  })

  it('parses a strict decimal and pads missing fractional digits', () => {
    expect(parseDecimal('24.27', USDC, 2)).toEqual(money(2427n, USDC, 2))
    expect(parseDecimal('24', USDC, 2)).toEqual(money(2400n, USDC, 2))
    expect(parseDecimal('24.2', USDC, 2)).toEqual(money(2420n, USDC, 2))
    expect(parseDecimal('00.50', COP, 2)).toEqual(money(50n, COP, 2))
    expect(parseDecimal('24.2700', USDC, 2)).toEqual(money(2427n, USDC, 2))
    expect(parseDecimal('10.100', USDC, 2)).toEqual(money(1010n, USDC, 2))
  })

  it('rejects malformed amounts and extra non-zero fractional digits', () => {
    for (const text of ['', '24.', '.27', '-1', '1e2', '24.27.1', ' 24.27', '24,27']) {
      expect(() => parseDecimal(text, USDC, 2)).toThrow(DomainError)
      expect(codeOf(() => parseDecimal(text, USDC, 2))).toBe('invalid_amount')
    }
    expect(codeOf(() => parseDecimal('24.271', USDC, 2))).toBe('invalid_amount')
    expect(codeOf(() => parseDecimal('10.101', USDC, 2))).toBe('invalid_amount')
  })

  it('rejects a negative amount, a negative scale, and an empty asset', () => {
    expect(codeOf(() => money(-1n, USDC, 2))).toBe('invalid_amount')
    expect(codeOf(() => money(1n, USDC, -1))).toBe('invalid_amount')
    expect(codeOf(() => parseDecimal('1', USDC, -1))).toBe('invalid_amount')
    expect(codeOf(() => money(1n, USDC, 1.5))).toBe('invalid_amount')
    expect(codeOf(() => money(1n, '', 2))).toBe('invalid_amount')
  })

  it('adds and subtracts the same asset, and refuses a negative result', () => {
    const a = money(2427n, USDC, 2)
    const b = money(100n, USDC, 2)
    expect(add(a, b)).toEqual(money(2527n, USDC, 2))
    expect(subtract(a, b)).toEqual(money(2327n, USDC, 2))
    expect(subtract(a, a)).toEqual(money(0n, USDC, 2))
    expect(codeOf(() => subtract(b, a))).toBe('invalid_amount')
  })

  it('compares and detects zero only for the same asset and scale', () => {
    const low = money(1n, COP, 2)
    const high = money(2n, COP, 2)
    expect(compare(low, high)).toBe(-1)
    expect(compare(high, low)).toBe(1)
    expect(compare(low, money(1n, COP, 2))).toBe(0)
    expect(isZero(money(0n, COP, 2))).toBe(true)
    expect(isZero(low)).toBe(false)
    expect(codeOf(() => add(low, money(1n, USDC, 2)))).toBe('asset_mismatch')
    expect(codeOf(() => subtract(low, money(1n, USDC, 2)))).toBe('asset_mismatch')
    expect(codeOf(() => compare(low, money(1n, USDC, 2)))).toBe('asset_mismatch')
    expect(codeOf(() => add(low, money(1n, COP, 0)))).toBe('invalid_amount')
  })

  it('rescales by floor, ceil, and exact', () => {
    const fine = money(242701n, USDC, 4)
    expect(rescale(fine, 2, 'floor')).toEqual(money(2427n, USDC, 2))
    expect(rescale(fine, 2, 'ceil')).toEqual(money(2428n, USDC, 2))
    expect(codeOf(() => rescale(fine, 2, 'exact'))).toBe('invalid_amount')

    const even = money(242700n, USDC, 4)
    expect(rescale(even, 2, 'exact')).toEqual(money(2427n, USDC, 2))
    expect(rescale(even, 2, 'ceil')).toEqual(money(2427n, USDC, 2))
    expect(rescale(money(2427n, USDC, 2), 4, 'floor')).toEqual(money(242700n, USDC, 4))
    expect(rescale(money(2427n, USDC, 2), 4, 'ceil')).toEqual(money(242700n, USDC, 4))
    expect(rescale(money(2427n, USDC, 2), 4, 'exact')).toEqual(money(242700n, USDC, 4))
    expect(rescale(money(0n, USDC, 4), 2, 'ceil')).toEqual(money(0n, USDC, 2))
    expect(codeOf(() => rescale(fine, -1, 'floor'))).toBe('invalid_amount')
  })
})

describe('money properties', () => {
  const amountArb = fc.bigInt({ min: 0n, max: 10n ** 18n })
  const scaleArb = fc.integer({ min: 0, max: 8 })

  it('round-trips format and parse', () => {
    fc.assert(
      fc.property(amountArb, scaleArb, fc.constantFrom(COP, USDC), (amount, scale, code) => {
        const original = money(amount, code, scale)
        const text = formatDecimal(original)
        const parsed = parseDecimal(text, code, scale)
        expect(parsed).toEqual(original)
        expect(formatDecimal(parsed)).toBe(text)
      }),
    )
  })

  it('treats add and subtract as inverses', () => {
    fc.assert(
      fc.property(amountArb, amountArb, (left, right) => {
        const a = money(left, USDC, 2)
        const b = money(right, USDC, 2)
        const sum = add(a, b)
        expect(subtract(sum, b)).toEqual(a)
        expect(subtract(sum, a)).toEqual(b)
        if (left >= right) {
          expect(subtract(a, b).amount).toBe(left - right)
        } else {
          expect(codeOf(() => subtract(a, b))).toBe('invalid_amount')
        }
      }),
    )
  })

  it('never increases the amount on a floor rescale round trip', () => {
    fc.assert(
      fc.property(amountArb, scaleArb, fc.integer({ min: 0, max: 8 }), (amount, scale, drop) => {
        const original = money(amount, COP, scale)
        const lower = Math.max(0, scale - drop)
        const floored = rescale(original, lower, 'floor')
        const back = rescale(floored, scale, 'exact')
        expect(back.amount <= original.amount).toBe(true)
        expect(back.assetCode).toBe(COP)
        expect(back.assetScale).toBe(scale)

        const ceiled = rescale(original, lower, 'ceil')
        const ceiledBack = rescale(ceiled, scale, 'exact')
        expect(ceiledBack.amount >= original.amount).toBe(true)
      }),
    )
  })
})

function codeOf(run: () => void): string {
  try {
    run()
  } catch (error) {
    if (error instanceof DomainError) return error.code
    throw error
  }
  throw new Error('expected DomainError')
}
