export const DOMAIN_ERROR_CODES = [
  'invalid_amount',
  'asset_mismatch',
  'invalid_transition',
  'quote_expired',
  'limit_exceeded',
  'version_conflict',
] as const

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number]

export class DomainError extends Error {
  readonly code: DomainErrorCode

  constructor(code: DomainErrorCode, message: string) {
    super(message)
    this.name = 'DomainError'
    this.code = code
  }
}
