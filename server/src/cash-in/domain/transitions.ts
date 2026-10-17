import { DomainError } from '../../shared/errors.ts'
import type { CashIn, CashInStatus } from './cash-in.ts'

export type CashInEvent =
  | { readonly type: 'Confirm'; readonly outgoingPaymentId: string }
  | { readonly type: 'Expire' }
  | { readonly type: 'IncomingCompleted' }
  | { readonly type: 'PaymentFailed'; readonly reason: string }
  | {
      readonly type: 'UsdcSendStarted'
      readonly stellarEnvelopeXdr: string
      readonly stellarTxHash: string
    }
  | { readonly type: 'UsdcSent'; readonly stellarTxHash: string }
  | { readonly type: 'UsdcFailed'; readonly reason: string }
  | { readonly type: 'Retry' }

interface TransitionPatch {
  readonly outgoingPaymentId?: string
  readonly incomingCompleted?: boolean
  readonly stellarEnvelopeXdr?: string
  readonly stellarTxHash?: string
  readonly failureReason?: string
  readonly clearFailure?: boolean
}

export function transition(cashIn: CashIn, event: CashInEvent, now: Date): CashIn {
  switch (event.type) {
    case 'Confirm':
      return confirm(cashIn, event.outgoingPaymentId, now)
    case 'Expire':
      return expire(cashIn, now)
    case 'IncomingCompleted':
      requireStatus(cashIn, 'settling')
      return advance(cashIn, 'settled', now, { incomingCompleted: true })
    case 'PaymentFailed':
      requireStatus(cashIn, 'settling')
      return advance(cashIn, 'failed_payment', now, { failureReason: event.reason })
    case 'UsdcSendStarted':
      return startSend(cashIn, event.stellarEnvelopeXdr, event.stellarTxHash, now)
    case 'UsdcSent':
      return markSent(cashIn, event.stellarTxHash, now)
    case 'UsdcFailed':
      requireStatus(cashIn, 'sending_usdc')
      return advance(cashIn, 'failed_stellar', now, { failureReason: event.reason })
    case 'Retry':
      return retry(cashIn, now)
    default: {
      const unexpected: never = event
      return unexpected
    }
  }
}

function confirm(cashIn: CashIn, outgoingPaymentId: string, now: Date): CashIn {
  requireStatus(cashIn, 'quoted')
  if (now.getTime() >= cashIn.expiresAt.getTime()) {
    throw new DomainError('quote_expired', 'quote expired')
  }
  return advance(cashIn, 'settling', now, { outgoingPaymentId })
}

function expire(cashIn: CashIn, now: Date): CashIn {
  requireStatus(cashIn, 'quoted')
  if (now.getTime() < cashIn.expiresAt.getTime()) {
    throw new DomainError('invalid_transition', 'quote is still valid')
  }
  return advance(cashIn, 'expired', now, {})
}

function startSend(
  cashIn: CashIn,
  stellarEnvelopeXdr: string,
  stellarTxHash: string,
  now: Date,
): CashIn {
  requireStatus(cashIn, 'settled')
  // The signed envelope is the idempotency key: a second one could pay twice.
  if (cashIn.stellarEnvelopeXdr !== undefined || cashIn.stellarTxHash !== undefined) {
    throw new DomainError('invalid_transition', 'stellar envelope is already stored')
  }
  return advance(cashIn, 'sending_usdc', now, { stellarEnvelopeXdr, stellarTxHash })
}

function markSent(cashIn: CashIn, stellarTxHash: string, now: Date): CashIn {
  requireStatus(cashIn, 'sending_usdc')
  if (cashIn.stellarTxHash !== stellarTxHash) {
    throw new DomainError('invalid_transition', 'stellar transaction hash does not match')
  }
  return advance(cashIn, 'completed', now, {})
}

function retry(cashIn: CashIn, now: Date): CashIn {
  requireStatus(cashIn, 'failed_stellar')
  if (cashIn.stellarEnvelopeXdr === undefined || cashIn.stellarTxHash === undefined) {
    throw new DomainError('invalid_transition', 'stellar envelope is missing')
  }
  return advance(cashIn, 'sending_usdc', now, { clearFailure: true })
}

function requireStatus(cashIn: CashIn, status: CashInStatus): void {
  if (cashIn.status !== status) {
    throw new DomainError('invalid_transition', 'transition is not allowed')
  }
}

function advance(cashIn: CashIn, status: CashInStatus, now: Date, patch: TransitionPatch): CashIn {
  const outgoingPaymentId = patch.outgoingPaymentId ?? cashIn.openPayments.outgoingPaymentId
  const stellarEnvelopeXdr = patch.stellarEnvelopeXdr ?? cashIn.stellarEnvelopeXdr
  const stellarTxHash = patch.stellarTxHash ?? cashIn.stellarTxHash
  const failureReason = patch.clearFailure
    ? undefined
    : (patch.failureReason ?? cashIn.failureReason)

  return {
    id: cashIn.id,
    status,
    cop: cashIn.cop,
    usdc: cashIn.usdc,
    copPerUsdc: cashIn.copPerUsdc,
    expiresAt: cashIn.expiresAt,
    stellarAddress: cashIn.stellarAddress,
    memo: cashIn.memo,
    customer: cashIn.customer,
    openPayments: {
      incomingPaymentUrl: cashIn.openPayments.incomingPaymentUrl,
      quoteId: cashIn.openPayments.quoteId,
      incomingCompleted: patch.incomingCompleted ?? cashIn.openPayments.incomingCompleted,
      ...(outgoingPaymentId !== undefined ? { outgoingPaymentId } : {}),
    },
    createdAt: cashIn.createdAt,
    updatedAt: new Date(now.getTime()),
    version: cashIn.version + 1,
    ...(stellarEnvelopeXdr !== undefined ? { stellarEnvelopeXdr } : {}),
    ...(stellarTxHash !== undefined ? { stellarTxHash } : {}),
    ...(failureReason !== undefined ? { failureReason } : {}),
  }
}
