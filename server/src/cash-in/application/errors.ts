export const CASH_IN_ERROR_CODES = [
  'invalid_request',
  'limit_exceeded',
  'invalid_address',
  'insufficient_inventory',
  'backend_down',
  'internal_error',
  'not_found',
] as const

export type CashInErrorCode = (typeof CASH_IN_ERROR_CODES)[number]

export class CashInError extends Error {
  readonly code: CashInErrorCode
  readonly detail?: string

  constructor(code: CashInErrorCode, detail?: string) {
    super(detail ?? code)
    this.name = 'CashInError'
    this.code = code
    if (detail !== undefined) this.detail = detail
  }
}
