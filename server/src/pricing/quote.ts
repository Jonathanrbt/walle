import { DomainError } from '../shared/errors.ts'
import { money, type Money } from '../shared/money.ts'

const QUOTE_SCALE = 2

export function quoteUsdc(input: { readonly cop: Money; readonly copPerUsdc: Money }): Money {
  const { cop, copPerUsdc } = input
  requireCop(cop, 'cash amount')
  requireCop(copPerUsdc, 'rate')
  if (cop.assetScale !== QUOTE_SCALE || copPerUsdc.assetScale !== QUOTE_SCALE) {
    throw new DomainError('invalid_amount', 'COP amounts must use scale 2')
  }
  if (copPerUsdc.amount === 0n) {
    throw new DomainError('invalid_amount', 'COP per USDC must be positive')
  }
  // Floor so the customer never receives more USDC than the cash is worth.
  return money((cop.amount * 100n) / copPerUsdc.amount, 'USDC', QUOTE_SCALE)
}

export function applySpread(midCopPerUsd: Money, spreadPct: string): Money {
  if (midCopPerUsd.assetCode !== 'COP') {
    throw new DomainError('asset_mismatch', 'mid rate must be COP')
  }
  const spread = parsePercent(spreadPct)
  const numerator = midCopPerUsd.amount * spread.numerator * 10n ** BigInt(QUOTE_SCALE)
  const denominator = 10n ** BigInt(midCopPerUsd.assetScale) * spread.denominator
  // Round the customer rate up so the spread stays with the operator.
  return money(ceilDiv(numerator, denominator), 'COP', QUOTE_SCALE)
}

function requireCop(value: Money, label: string): void {
  if (value.assetCode !== 'COP') throw new DomainError('asset_mismatch', `${label} must be COP`)
}

function parsePercent(text: string): { readonly numerator: bigint; readonly denominator: bigint } {
  const matched = /^(\d+)(?:\.(\d+))?$/.exec(text)
  const whole = matched?.[1]
  if (whole === undefined) {
    throw new DomainError('invalid_amount', 'spread percent must be a decimal')
  }
  const fraction = matched?.[2] ?? ''
  const factor = 10n ** BigInt(fraction.length)
  const minor = BigInt(whole) * factor + (fraction.length === 0 ? 0n : BigInt(fraction))
  return { numerator: 100n * factor + minor, denominator: 100n * factor }
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator
}
