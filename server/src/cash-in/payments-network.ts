import type { Money } from '../shared/money.ts'

export type PaymentsFailureKind = 'rejected' | 'unavailable' | 'unauthorized'

export type OutgoingPaymentStatus = 'pending' | 'paid' | 'failed'

/** Failure from the Open Payments network. `detail` is safe to log: it never contains tokens. */
export class PaymentsNetworkError extends Error {
  readonly kind: PaymentsFailureKind
  readonly detail: string
  /** True only for `unavailable`, which a caller may retry. */
  readonly retryable: boolean

  constructor(kind: PaymentsFailureKind, detail: string) {
    super(detail)
    this.name = 'PaymentsNetworkError'
    this.kind = kind
    this.detail = detail
    this.retryable = kind === 'unavailable'
  }
}

export interface PaymentsNetwork {
  /** Operator wallet. Non-interactive incoming-payment grant. No incoming amount. */
  createIncomingPayment(input: {
    readonly description?: string
  }): Promise<{ url: string; expiresAt: Date }>

  /** Store wallet. Non-interactive quote grant. Debit is fixed COP. */
  createQuote(input: { readonly incomingPaymentUrl: string; readonly debit: Money }): Promise<{
    id: string
    debit: Money
    receive: Money
    expiresAt: Date
  }>

  createOutgoingPayment(input: {
    readonly quoteId: string
    readonly accessToken: string
    readonly description?: string
  }): Promise<{ id: string }>

  /** Paid when sent equals debit. Failed when the resource says so. */
  getOutgoingPayment(
    id: string,
    accessToken: string,
  ): Promise<{ id: string; status: OutgoingPaymentStatus; sent: Money; debit: Money }>

  getIncomingPayment(url: string): Promise<{ received: Money; completed: boolean }>

  completeIncomingPayment(url: string): Promise<void>
}
