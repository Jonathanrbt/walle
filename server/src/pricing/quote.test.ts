import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DomainError } from '../shared/errors.ts'
import { formatDecimal, money, parseDecimal, rescale, type Money } from '../shared/money.ts'
import { applySpread, quoteUsdc } from './quote.ts'

describe('quoteUsdc', () => {
  it('floors 100000.00 COP at 4017.00 to 24.89 USDC', () => {
    const cop = parseDecimal('100000.00', 'COP', 2)
    const copPerUsdc = parseDecimal('4017.00', 'COP', 2)
    const usdc = quoteUsdc({ cop, copPerUsdc })
    expect(usdc).toEqual(money(2489n, 'USDC', 2))
    expect(formatDecimal(usdc)).toBe('24.89')
  })

  it('floors a partial cent and returns zero when the rate does not buy one cent', () => {
    expect(
      quoteUsdc({ cop: money(401700n, 'COP', 2), copPerUsdc: money(401700n, 'COP', 2) }),
    ).toEqual(money(100n, 'USDC', 2))
    expect(
      quoteUsdc({ cop: money(401699n, 'COP', 2), copPerUsdc: money(401700n, 'COP', 2) }),
    ).toEqual(money(99n, 'USDC', 2))
    expect(quoteUsdc({ cop: money(1n, 'COP', 2), copPerUsdc: money(401700n, 'COP', 2) })).toEqual(
      money(0n, 'USDC', 2),
    )
  })

  it('rejects a zero rate and a mismatched asset', () => {
    expect(
      codeOf(() => quoteUsdc({ cop: money(1n, 'COP', 2), copPerUsdc: money(0n, 'COP', 2) })),
    ).toBe('invalid_amount')
    expect(
      codeOf(() => quoteUsdc({ cop: money(1n, 'USD', 2), copPerUsdc: money(1n, 'COP', 2) })),
    ).toBe('asset_mismatch')
    expect(
      codeOf(() => quoteUsdc({ cop: money(1n, 'COP', 2), copPerUsdc: money(1n, 'USD', 2) })),
    ).toBe('asset_mismatch')
    expect(
      codeOf(() => quoteUsdc({ cop: money(1n, 'COP', 0), copPerUsdc: money(1n, 'COP', 2) })),
    ).toBe('invalid_amount')
  })
})

describe('applySpread', () => {
  it('rounds the operator rate up to scale 2', () => {
    expect(formatDecimal(applySpread(parseDecimal('3900.00', 'COP', 2), '3'))).toBe('4017.00')
    expect(formatDecimal(applySpread(parseDecimal('3900.00', 'COP', 2), '2.5'))).toBe('3997.50')
    expect(formatDecimal(applySpread(parseDecimal('100.00', 'COP', 2), '3'))).toBe('103.00')
    expect(formatDecimal(applySpread(parseDecimal('100.01', 'COP', 2), '3'))).toBe('103.02')
    expect(applySpread(parseDecimal('3900.00', 'COP', 2), '0')).toEqual(money(390000n, 'COP', 2))
  })

  it('rejects a spread that is not a decimal percent', () => {
    const mid = money(390000n, 'COP', 2)
    for (const text of ['', '3%', '-1', '2,5', '3.', '.5']) {
      expect(codeOf(() => applySpread(mid, text))).toBe('invalid_amount')
    }
    expect(codeOf(() => applySpread(money(1n, 'USD', 2), '3'))).toBe('asset_mismatch')
  })
})

describe('quote properties', () => {
  const minorArb = fc.bigInt({ min: 0n, max: 10n ** 14n })
  const rateArb = fc.bigInt({ min: 1n, max: 10n ** 12n })

  it('never gives more USDC than the cash is worth', () => {
    fc.assert(
      fc.property(minorArb, rateArb, (copMinor, rateMinor) => {
        const cop = money(copMinor, 'COP', 2)
        const copPerUsdc = money(rateMinor, 'COP', 2)
        const usdc = quoteUsdc({ cop, copPerUsdc })
        expect(usdc.assetCode).toBe('USDC')
        expect(usdc.assetScale).toBe(2)
        expect(usdc.amount * copPerUsdc.amount <= cop.amount * 100n).toBe(true)
        expect(usdc.amount).toBe((cop.amount * 100n) / copPerUsdc.amount)
      }),
    )
  })

  it('is monotonic in the COP amount', () => {
    fc.assert(
      fc.property(minorArb, minorArb, rateArb, (left, right, rateMinor) => {
        const low = left <= right ? left : right
        const high = left <= right ? right : left
        const rate = money(rateMinor, 'COP', 2)
        const cheaper = quoteUsdc({ cop: money(low, 'COP', 2), copPerUsdc: rate })
        const dearer = quoteUsdc({ cop: money(high, 'COP', 2), copPerUsdc: rate })
        expect(cheaper.amount <= dearer.amount).toBe(true)
      }),
    )
  })

  it('matches a ceil rescale when the spread is zero', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 12n }),
        fc.integer({ min: 0, max: 6 }),
        (amount, scale) => {
          const mid = money(amount, 'COP', scale)
          expect(applySpread(mid, '0')).toEqual(rescale(mid, 2, 'ceil'))
        },
      ),
    )
  })

  it('does not lower the rate when the spread increases', () => {
    const spreads = ['0', '1', '2.5', '3', '10']
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 10n }), (amount) => {
        const mid = money(amount, 'COP', 2)
        let previous: Money = applySpread(mid, spreads[0] ?? '0')
        for (const spread of spreads.slice(1)) {
          const next = applySpread(mid, spread)
          expect(previous.amount <= next.amount).toBe(true)
          previous = next
        }
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
