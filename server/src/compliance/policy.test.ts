import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DomainError } from '../shared/errors.ts'
import { money, type Money } from '../shared/money.ts'
import { checkCashIn, type LimitReason, type Usage } from './policy.ts'

const TX = 10_000n
const DAY = 15_000n
const MONTH = 50_000n
const UIAF_TX = 1_000_000_000n
const UIAF_MONTH = 5_000_000_000n

function usdc(amount: bigint): Money {
  return money(amount, 'USDC', 2)
}

function cop(amount: bigint): Money {
  return money(amount, 'COP', 2)
}

function usage(usdcDay: bigint, usdcMonth: bigint, copMonth: bigint): Usage {
  return { usdcDay: usdc(usdcDay), usdcMonth: usdc(usdcMonth), copMonth: cop(copMonth) }
}

function reasonOf(copAmount: bigint, usdcAmount: bigint, used: Usage): LimitReason | 'ok' {
  const result = checkCashIn({ cop: cop(copAmount), usdc: usdc(usdcAmount), usage: used })
  if (result.ok) return 'ok'
  expect(result.detail.length > 0).toBe(true)
  return result.reason
}

describe('checkCashIn boundaries', () => {
  const none = usage(0n, 0n, 0n)

  it('accepts the inclusive USDC caps and the cent just under each UIAF threshold', () => {
    expect(reasonOf(1n, TX, none)).toBe('ok')
    expect(reasonOf(1n, 0n, usage(DAY, 0n, 0n))).toBe('ok')
    expect(reasonOf(1n, TX, usage(DAY - TX, 0n, 0n))).toBe('ok')
    expect(reasonOf(1n, 0n, usage(0n, MONTH, 0n))).toBe('ok')
    expect(reasonOf(1n, TX, usage(0n, MONTH - TX, 0n))).toBe('ok')
    expect(reasonOf(UIAF_TX - 1n, 1n, none)).toBe('ok')
    expect(reasonOf(UIAF_TX - 1n, 1n, usage(0n, 0n, UIAF_MONTH - (UIAF_TX - 1n) - 1n))).toBe('ok')
    expect(reasonOf(0n, 0n, usage(0n, 0n, UIAF_MONTH - 1n))).toBe('ok')
  })

  it('rejects the cent above each USDC cap and the UIAF thresholds themselves', () => {
    expect(reasonOf(1n, TX + 1n, none)).toBe('tx_limit')
    expect(reasonOf(1n, 1n, usage(DAY, 0n, 0n))).toBe('day_limit')
    expect(reasonOf(1n, TX, usage(DAY - TX + 1n, 0n, 0n))).toBe('day_limit')
    expect(reasonOf(1n, 1n, usage(0n, MONTH, 0n))).toBe('month_limit')
    expect(reasonOf(1n, TX, usage(0n, MONTH - TX + 1n, 0n))).toBe('month_limit')
    expect(reasonOf(UIAF_TX, 1n, none)).toBe('uiaf_tx')
    expect(reasonOf(UIAF_TX - 1n, 1n, usage(0n, 0n, UIAF_MONTH - (UIAF_TX - 1n)))).toBe(
      'uiaf_month',
    )
    expect(reasonOf(0n, 0n, usage(0n, 0n, UIAF_MONTH))).toBe('uiaf_month')
  })

  it('rejects a mismatched asset', () => {
    expect(
      codeOf(() =>
        checkCashIn({
          cop: money(1n, 'USD', 2),
          usdc: usdc(1n),
          usage: none,
        }),
      ),
    ).toBe('asset_mismatch')
    expect(
      codeOf(() =>
        checkCashIn({
          cop: cop(1n),
          usdc: money(1n, 'COP', 2),
          usage: none,
        }),
      ),
    ).toBe('asset_mismatch')
    expect(
      codeOf(() =>
        checkCashIn({
          cop: money(1n, 'COP', 0),
          usdc: usdc(1n),
          usage: none,
        }),
      ),
    ).toBe('invalid_amount')
  })
})

describe('checkCashIn properties', () => {
  it('matches the tier and UIAF rules for random usage', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: UIAF_TX + 100n }),
        fc.bigInt({ min: 0n, max: TX + 5_000n }),
        fc.bigInt({ min: 0n, max: DAY + 100n }),
        fc.bigInt({ min: 0n, max: MONTH + 100n }),
        fc.bigInt({ min: 0n, max: UIAF_MONTH }),
        (copAmount, usdcAmount, usdcDay, usdcMonth, copMonth) => {
          const used = usage(usdcDay, usdcMonth, copMonth)
          const expected = expectedReason(copAmount, usdcAmount, usdcDay, usdcMonth, copMonth)
          expect(reasonOf(copAmount, usdcAmount, used)).toBe(expected)
        },
      ),
    )
  })
})

function expectedReason(
  copAmount: bigint,
  usdcAmount: bigint,
  usdcDay: bigint,
  usdcMonth: bigint,
  copMonth: bigint,
): LimitReason | 'ok' {
  if (copAmount >= UIAF_TX) return 'uiaf_tx'
  if (copMonth + copAmount >= UIAF_MONTH) return 'uiaf_month'
  if (usdcAmount > TX) return 'tx_limit'
  if (usdcDay + usdcAmount > DAY) return 'day_limit'
  if (usdcMonth + usdcAmount > MONTH) return 'month_limit'
  return 'ok'
}

function codeOf(run: () => void): string {
  try {
    run()
  } catch (error) {
    if (error instanceof DomainError) return error.code
    throw error
  }
  throw new Error('expected DomainError')
}
