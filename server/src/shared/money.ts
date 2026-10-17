import { DomainError } from './errors.ts'

export interface Money {
  readonly amount: bigint
  readonly assetCode: string
  readonly assetScale: number
}

const DECIMAL = /^(\d+)(?:\.(\d+))?$/

export function money(amount: bigint, assetCode: string, assetScale: number): Money {
  if (amount < 0n) throw new DomainError('invalid_amount', 'amount must be zero or positive')
  if (!Number.isInteger(assetScale) || assetScale < 0) {
    throw new DomainError('invalid_amount', 'asset scale must be a non-negative integer')
  }
  if (assetCode.length === 0) throw new DomainError('invalid_amount', 'asset code is required')
  return Object.freeze({ amount, assetCode, assetScale })
}

export function parseDecimal(text: string, code: string, scale: number): Money {
  const matched = DECIMAL.exec(text)
  const whole = matched?.[1]
  if (whole === undefined) throw new DomainError('invalid_amount', 'amount must be a decimal')
  const fraction = matched?.[2] ?? ''
  if (!Number.isInteger(scale) || scale < 0) {
    throw new DomainError('invalid_amount', 'asset scale must be a non-negative integer')
  }
  if (fraction.length > scale && !/^0+$/.test(fraction.slice(scale))) {
    throw new DomainError(
      'invalid_amount',
      'amount has more fractional digits than the asset scale',
    )
  }
  const digits = fraction.slice(0, scale).padEnd(scale, '0')
  const amount = BigInt(whole) * 10n ** BigInt(scale) + (digits.length === 0 ? 0n : BigInt(digits))
  return money(amount, code, scale)
}

export function formatDecimal(value: Money): string {
  const base = 10n ** BigInt(value.assetScale)
  const whole = value.amount / base
  const fraction = value.amount % base
  if (value.assetScale === 0) return whole.toString()
  return `${whole.toString()}.${fraction.toString().padStart(value.assetScale, '0')}`
}

export function add(left: Money, right: Money): Money {
  sameAsset(left, right)
  return money(left.amount + right.amount, left.assetCode, left.assetScale)
}

export function subtract(left: Money, right: Money): Money {
  sameAsset(left, right)
  if (left.amount < right.amount) {
    throw new DomainError('invalid_amount', 'subtraction would be negative')
  }
  return money(left.amount - right.amount, left.assetCode, left.assetScale)
}

export function compare(left: Money, right: Money): -1 | 0 | 1 {
  sameAsset(left, right)
  if (left.amount < right.amount) return -1
  if (left.amount > right.amount) return 1
  return 0
}

export function isZero(value: Money): boolean {
  return value.amount === 0n
}

export function rescale(
  value: Money,
  newScale: number,
  rounding: 'floor' | 'ceil' | 'exact',
): Money {
  if (!Number.isInteger(newScale) || newScale < 0) {
    throw new DomainError('invalid_amount', 'asset scale must be a non-negative integer')
  }
  if (newScale === value.assetScale) return money(value.amount, value.assetCode, newScale)
  if (newScale > value.assetScale) {
    const factor = 10n ** BigInt(newScale - value.assetScale)
    return money(value.amount * factor, value.assetCode, newScale)
  }
  const factor = 10n ** BigInt(value.assetScale - newScale)
  const quotient = value.amount / factor
  const remainder = value.amount % factor
  if (remainder === 0n || rounding === 'floor') return money(quotient, value.assetCode, newScale)
  if (rounding === 'ceil') return money(quotient + 1n, value.assetCode, newScale)
  throw new DomainError('invalid_amount', 'rescale would drop digits')
}

function sameAsset(left: Money, right: Money): void {
  if (left.assetCode !== right.assetCode) {
    throw new DomainError('asset_mismatch', 'amounts use different assets')
  }
  if (left.assetScale !== right.assetScale) {
    throw new DomainError('invalid_amount', 'amounts use different scales')
  }
}
