import type { Money } from '../../shared/money.ts'
import type { Clock } from '../../shared/ports.ts'

export type CashInStatus =
  | 'quoted'
  | 'settling'
  | 'settled'
  | 'sending_usdc'
  | 'completed'
  | 'failed_payment'
  | 'failed_stellar'
  | 'expired'

export interface CashInCustomer {
  readonly phone: string
  readonly fullName: string
  readonly documentNumber: string
}

export interface CashInOpenPayments {
  readonly incomingPaymentUrl: string
  readonly quoteId: string
  readonly outgoingPaymentId?: string
  readonly incomingCompleted: boolean
}

export interface CashIn {
  readonly id: string
  readonly status: CashInStatus
  readonly cop: Money
  readonly usdc: Money
  readonly copPerUsdc: Money
  readonly expiresAt: Date
  readonly stellarAddress: string
  readonly memo: string
  readonly customer: CashInCustomer
  readonly openPayments: CashInOpenPayments
  readonly stellarTxHash?: string
  readonly stellarEnvelopeXdr?: string
  readonly failureReason?: string
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly version: number
}

export interface CreateQuotedParams {
  readonly id: string
  readonly cop: Money
  readonly usdc: Money
  readonly copPerUsdc: Money
  readonly expiresAt: Date
  readonly stellarAddress: string
  readonly customer: CashInCustomer
  readonly incomingPaymentUrl: string
  readonly quoteId: string
}

const MEMO_PREFIX = 'WALLE-'

export function memoFromId(id: string): string {
  const body = id
    .replace(/[^0-9A-Za-z]/g, '')
    .slice(0, 8)
    .toUpperCase()
  return `${MEMO_PREFIX}${body}`
}

export function createQuoted(params: CreateQuotedParams, clock: Clock): CashIn {
  const now = new Date(clock.now().getTime())
  return {
    id: params.id,
    status: 'quoted',
    cop: params.cop,
    usdc: params.usdc,
    copPerUsdc: params.copPerUsdc,
    expiresAt: params.expiresAt,
    stellarAddress: params.stellarAddress,
    memo: memoFromId(params.id),
    customer: params.customer,
    openPayments: {
      incomingPaymentUrl: params.incomingPaymentUrl,
      quoteId: params.quoteId,
      incomingCompleted: false,
    },
    createdAt: now,
    updatedAt: new Date(now.getTime()),
    version: 1,
  }
}
