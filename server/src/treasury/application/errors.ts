export const OPERATOR_ERROR_CODES = ['backend_down'] as const

export type OperatorErrorCode = (typeof OPERATOR_ERROR_CODES)[number]

/** Operator view failed because the USDC network could not be used. `detail` is safe to return. */
export class OperatorError extends Error {
  readonly code: OperatorErrorCode
  readonly detail?: string

  constructor(code: OperatorErrorCode, detail?: string) {
    super(detail ?? code)
    this.name = 'OperatorError'
    this.code = code
    if (detail !== undefined) this.detail = detail
  }
}
