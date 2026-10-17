import { z } from 'zod'

/** Unsigned decimal text: digits, optional fraction, no sign and no exponent. */
export const DecimalString = z.string().regex(/^\d+(\.\d+)?$/)
export type DecimalString = z.infer<typeof DecimalString>

// `offset: true` allows a numeric offset as well as `Z`. `local` stays false, so a timezone is required.
export const IsoDateTime = z.iso.datetime({ offset: true })
export type IsoDateTime = z.infer<typeof IsoDateTime>

/** StrKey shape only. Checksum and account lookup stay in the Stellar adapter. */
export const StellarAddress = z.string().regex(/^G[A-Z2-7]{55}$/)
export type StellarAddress = z.infer<typeof StellarAddress>

const CASH_IN_STATUSES = [
  'quoted',
  'settling',
  'settled',
  'sending_usdc',
  'completed',
  'failed_payment',
  'failed_stellar',
  'expired',
] as const

export const CashInStatus = z.enum(CASH_IN_STATUSES)
export type CashInStatus = z.infer<typeof CashInStatus>

const FRONT_API_ERROR_CODES = [
  'limit_exceeded',
  'no_grant',
  'grant_exhausted',
  'invalid_address',
  'insufficient_inventory',
  'quote_expired',
  'not_found',
  'backend_down',
] as const

const API_ERROR_CODES = [
  ...FRONT_API_ERROR_CODES,
  'invalid_request',
  'invalid_state',
  'internal_error',
] as const

export const FrontApiErrorCode = z.enum(FRONT_API_ERROR_CODES)
export type FrontApiErrorCode = z.infer<typeof FrontApiErrorCode>

export const ApiErrorCode = z.enum(API_ERROR_CODES)
export type ApiErrorCode = z.infer<typeof ApiErrorCode>

/** At least two words of length >= 2, matching the cashier form. */
function hasTwoNameWords(value: string): boolean {
  return (
    value
      .trim()
      .split(/\s+/)
      .filter((word) => word.length >= 2).length >= 2
  )
}

export const Customer = z.strictObject({
  phone: z.string().regex(/^3\d{9}$/),
  fullName: z.string().refine(hasTwoNameWords),
  documentNumber: z.string().regex(/^\d{6,10}$/),
})
export type Customer = z.infer<typeof Customer>

export const CashInRequest = z.strictObject({
  copAmount: DecimalString,
  stellarAddress: StellarAddress,
  customer: Customer,
})
export type CashInRequest = z.infer<typeof CashInRequest>

export const OpenPaymentsInfo = z.strictObject({
  incomingPaymentUrl: z.url(),
  quoteId: z.string().min(1),
  outgoingPaymentId: z.string().min(1).exactOptional(),
  incomingCompleted: z.boolean(),
})
export type OpenPaymentsInfo = z.infer<typeof OpenPaymentsInfo>

export const CashIn = z.strictObject({
  id: z.string().min(1),
  status: CashInStatus,
  copAmount: DecimalString,
  usdcAmount: DecimalString,
  copPerUsdc: DecimalString,
  expiresAt: IsoDateTime,
  stellarAddress: StellarAddress,
  memo: z.string(),
  openPayments: OpenPaymentsInfo,
  stellarTxHash: z.string().min(1).exactOptional(),
  createdAt: IsoDateTime,
})
export type CashIn = z.infer<typeof CashIn>

export const Rate = z.strictObject({
  copPerUsdc: DecimalString,
  spreadPct: z.number(),
  quotedAt: IsoDateTime,
})
export type Rate = z.infer<typeof Rate>

export const Grant = z.strictObject({
  status: z.enum(['active', 'missing', 'expired']),
  limitCop: DecimalString.exactOptional(),
  spentCop: DecimalString.exactOptional(),
  expiresAt: IsoDateTime.exactOptional(),
})
export type Grant = z.infer<typeof Grant>

export const Inventory = z.strictObject({
  usdc: DecimalString,
  floatUsdc: DecimalString,
  lowThresholdPct: z.number(),
})
export type Inventory = z.infer<typeof Inventory>

export const RefillResult = z.strictObject({
  usdc: DecimalString,
})
export type RefillResult = z.infer<typeof RefillResult>

export const ApiError = z.strictObject({
  error: ApiErrorCode,
  detail: z.string().exactOptional(),
})
export type ApiError = z.infer<typeof ApiError>

export const GrantFinishQuery = z.strictObject({
  hash: z.string().min(1),
  interact_ref: z.string().min(1),
})
export type GrantFinishQuery = z.infer<typeof GrantFinishQuery>

export function httpStatusFor(code: ApiErrorCode): number {
  switch (code) {
    case 'invalid_request':
    case 'invalid_address':
    case 'limit_exceeded':
      return 400
    case 'not_found':
      return 404
    case 'invalid_state':
    case 'quote_expired':
    case 'grant_exhausted':
    case 'insufficient_inventory':
      return 409
    case 'no_grant':
      return 412
    case 'internal_error':
      return 500
    case 'backend_down':
      return 503
  }
}
