export const STORE_GRANT_ERROR_CODES = ['no_grant', 'grant_exhausted', 'invalid_finish'] as const

export type StoreGrantErrorCode = (typeof STORE_GRANT_ERROR_CODES)[number]

export class StoreGrantError extends Error {
  readonly code: StoreGrantErrorCode

  constructor(code: StoreGrantErrorCode, message: string) {
    super(message)
    this.name = 'StoreGrantError'
    this.code = code
  }
}
