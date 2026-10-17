/** Shapes from team/contracts.md. Amounts are decimal strings, dates ISO 8601. */

export type CashInStatus =
  | 'quoted'
  | 'settling'
  | 'settled'
  | 'sending_usdc'
  | 'completed'
  | 'failed_payment'
  | 'failed_stellar'
  | 'expired'

export type CashIn = {
  id: string
  status: CashInStatus
  copAmount: string
  usdcAmount: string
  copPerUsdc: string
  expiresAt: string
  stellarAddress: string
  memo: string
  openPayments: {
    incomingPaymentUrl: string
    quoteId: string
    outgoingPaymentId?: string
    incomingCompleted: boolean
  }
  stellarTxHash?: string
  createdAt: string
}

export type Customer = { phone: string; fullName: string; documentNumber: string }

export type CashInRequest = { copAmount: string; stellarAddress: string; customer: Customer }

export type Rate = { copPerUsdc: string; spreadPct: number; quotedAt: string }

export type Grant = {
  status: 'active' | 'missing' | 'expired'
  limitCop?: string
  spentCop?: string
  expiresAt?: string
}

export type Inventory = { usdc: string; floatUsdc: string; lowThresholdPct: number }

export type ApiErrorCode =
  | 'limit_exceeded'
  | 'no_grant'
  | 'grant_exhausted'
  | 'invalid_address'
  | 'insufficient_inventory'
  | 'quote_expired'
  | 'not_found'
  | 'backend_down'

export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode,
    public detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code)
  }
}

export type Api = {
  rate(): Promise<Rate>
  createCashIn(req: CashInRequest): Promise<CashIn>
  confirmCashIn(id: string): Promise<CashIn>
  retryCashIn(id: string): Promise<CashIn>
  getCashIn(id: string): Promise<CashIn>
  grant(): Promise<Grant>
  /** Where the browser goes to start the daily GNAP consent. */
  grantStartUrl: string
  operatorCashIns(): Promise<CashIn[]>
  inventory(): Promise<Inventory>
  refill(): Promise<{ usdc: string }>
}
