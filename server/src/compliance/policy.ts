import { DomainError } from '../shared/errors.ts'
import type { Money } from '../shared/money.ts'

export interface Usage {
  readonly usdcDay: Money
  readonly usdcMonth: Money
  readonly copMonth: Money
}

export type LimitReason = 'tx_limit' | 'day_limit' | 'month_limit' | 'uiaf_tx' | 'uiaf_month'

export type PolicyDecision =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: LimitReason; readonly detail: string }

const TX_LIMIT = 10_000n
const DAY_LIMIT = 15_000n
const MONTH_LIMIT = 50_000n
const UIAF_TX = 1_000_000_000n
const UIAF_MONTH = 5_000_000_000n

export function checkCashIn(input: {
  readonly cop: Money
  readonly usdc: Money
  readonly usage: Usage
}): PolicyDecision {
  const { cop, usdc, usage } = input
  requireAsset(cop, 'COP', 'cash amount')
  requireAsset(usdc, 'USDC', 'USDC amount')
  requireAsset(usage.usdcDay, 'USDC', 'daily USDC usage')
  requireAsset(usage.usdcMonth, 'USDC', 'monthly USDC usage')
  requireAsset(usage.copMonth, 'COP', 'monthly COP usage')

  // A legal UIAF block outranks the commercial tier, and the single-transaction
  // threshold is the more specific of the two UIAF rules.
  if (cop.amount >= UIAF_TX) {
    return reject('uiaf_tx', 'single cash-in reaches the UIAF threshold of 10000000.00 COP')
  }
  if (usage.copMonth.amount + cop.amount >= UIAF_MONTH) {
    return reject('uiaf_month', 'monthly cash-ins reach the UIAF threshold of 50000000.00 COP')
  }
  if (usdc.amount > TX_LIMIT) return reject('tx_limit', 'USDC transaction limit is 100.00')
  if (usage.usdcDay.amount + usdc.amount > DAY_LIMIT) {
    return reject('day_limit', 'USDC daily limit is 150.00')
  }
  if (usage.usdcMonth.amount + usdc.amount > MONTH_LIMIT) {
    return reject('month_limit', 'USDC monthly limit is 500.00')
  }
  return { ok: true }
}

function requireAsset(value: Money, code: string, label: string): void {
  if (value.assetCode !== code) throw new DomainError('asset_mismatch', `${label} must be ${code}`)
  if (value.assetScale !== 2) {
    throw new DomainError('invalid_amount', `${label} must use scale 2`)
  }
}

function reject(reason: LimitReason, detail: string): PolicyDecision {
  return { ok: false, reason, detail }
}
