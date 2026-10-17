import { StrKey } from '@stellar/stellar-sdk'

import { DomainError } from '../../shared/errors.ts'
import { formatDecimal, money, parseDecimal, rescale, type Money } from '../../shared/money.ts'
import { StellarError } from '../../treasury/usdc-network.ts'

export const USDC_CODE = 'USDC'
export const USDC_SCALE = 7
export const MEMO_TEXT_MAX_BYTES = 28

/** Decimal string Horizon accepts for a USDC payment. Scale 2 and 7 convert exactly. */
export function usdcPaymentAmount(amount: Money): string {
  return formatDecimal(usdcAtScale7(amount))
}

export function usdcAtScale7(amount: Money): Money {
  if (amount.assetCode !== USDC_CODE) {
    throw new StellarError('invalid', 'amount asset must be USDC')
  }
  if (amount.assetScale !== 2 && amount.assetScale !== USDC_SCALE) {
    throw new StellarError('invalid', 'USDC amount scale must be 2 or 7')
  }
  if (amount.amount <= 0n) throw new StellarError('invalid', 'amount must be positive')
  try {
    return rescale(amount, USDC_SCALE, 'exact')
  } catch (error) {
    if (error instanceof DomainError) {
      throw new StellarError('invalid', 'amount does not convert exactly to USDC scale 7')
    }
    throw error
  }
}

/** Target may be zero. Used by refill, which buys the gap up to this balance. */
export function usdcTarget(amount: Money): Money {
  if (amount.assetCode !== USDC_CODE) {
    throw new StellarError('invalid', 'amount asset must be USDC')
  }
  if (amount.assetScale !== 2 && amount.assetScale !== USDC_SCALE) {
    throw new StellarError('invalid', 'USDC amount scale must be 2 or 7')
  }
  try {
    return rescale(amount, USDC_SCALE, 'exact')
  } catch (error) {
    if (error instanceof DomainError) {
      throw new StellarError('invalid', 'amount does not convert exactly to USDC scale 7')
    }
    throw error
  }
}

/** A payment destination is an Ed25519 account id. Checked before any Horizon call. */
export function assertTransferDestination(destination: string): void {
  if (!StrKey.isValidEd25519PublicKey(destination)) {
    throw new StellarError('invalid', 'destination is not a Stellar account')
  }
}

export function assertMemoText(memo: string): void {
  if (memo.length === 0) throw new StellarError('invalid', 'memo text is required')
  if (Buffer.byteLength(memo, 'utf8') > MEMO_TEXT_MAX_BYTES) {
    throw new StellarError('invalid', 'memo text exceeds 28 bytes')
  }
}

/** Fee passed to TransactionBuilder: the network base fee charged twice, per operation. */
export function doubledBaseFee(baseFee: number): string {
  if (!Number.isInteger(baseFee) || baseFee <= 0) {
    throw new StellarError('unavailable', 'horizon base fee is not a positive integer')
  }
  const fee = baseFee * 2
  if (!Number.isSafeInteger(fee)) {
    throw new StellarError('unavailable', 'horizon base fee is too large')
  }
  return String(fee)
}

export function decimalStroops(text: string, code: string): bigint {
  try {
    return parseDecimal(text, code, USDC_SCALE).amount
  } catch (error) {
    if (error instanceof DomainError) {
      throw new StellarError('unavailable', 'horizon returned an amount that is not a decimal')
    }
    throw error
  }
}

export function stroopsDecimal(stroops: bigint, code: string): string {
  return formatDecimal(money(stroops, code, USDC_SCALE))
}

/**
 * Room to receive is `limit - balance - buying liabilities`. Selling liabilities reserve
 * balance for outgoing offers and do not reduce what the account can still accept.
 */
export function trustlineCanReceive(input: {
  balance: bigint
  buyingLiabilities: bigint
  limit: bigint
  authorized: boolean
}): boolean {
  if (!input.authorized) return false
  return input.balance + input.buyingLiabilities < input.limit
}
