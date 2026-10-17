import { AccountRequiresMemoError, NotFoundError, xdr } from '@stellar/stellar-sdk'
import type { LookupResult, SubmitOutcome } from '../../treasury/usdc-network.ts'

export type SubmitAttempt =
  | { readonly kind: 'success'; readonly ledger: number }
  | { readonly kind: 'rejected'; readonly code: string }
  | { readonly kind: 'unknown' }

/**
 * Decides a submit that may have been retried.
 * `tx_bad_seq` becomes success only when `after` shows that same hash on the ledger.
 */
export function settleSubmit(
  before: LookupResult,
  attempt: SubmitAttempt,
  after: LookupResult | null,
): SubmitOutcome {
  if (before.kind === 'success') return { kind: 'success', ledger: before.ledger }
  if (before.kind === 'failed') return { kind: 'rejected', code: before.code }
  switch (attempt.kind) {
    case 'success':
      return { kind: 'success', ledger: attempt.ledger }
    case 'unknown':
      return { kind: 'unknown' }
    case 'rejected':
      if (attempt.code === 'tx_bad_seq' && after?.kind === 'success') {
        return { kind: 'success', ledger: after.ledger }
      }
      if (attempt.code === 'tx_bad_seq' && after?.kind === 'failed') {
        return { kind: 'rejected', code: after.code }
      }
      return { kind: 'rejected', code: attempt.code }
    default: {
      const unreachable: never = attempt
      return unreachable
    }
  }
}

export function attemptFromHorizonError(error: unknown): SubmitAttempt {
  if (error instanceof AccountRequiresMemoError) {
    return { kind: 'rejected', code: 'memo_required' }
  }
  if (error instanceof NotFoundError) return { kind: 'rejected', code: 'not_found' }
  const failure = horizonFailure(error)
  if (failure?.status !== 400) return { kind: 'unknown' }
  if (failure.transaction === 'tx_failed') {
    return { kind: 'rejected', code: failure.operations[0] ?? 'tx_failed' }
  }
  return { kind: 'rejected', code: failure.transaction ?? 'tx_failed' }
}

export function isHorizonNotFound(error: unknown): boolean {
  if (error instanceof NotFoundError) return true
  return horizonFailure(error)?.status === 404
}

/** Horizon-style code from a transaction result XDR (`tx_bad_seq`, `op_underfunded`, …). */
export function horizonFailureCode(resultXdr: string): string {
  try {
    const outer = xdr.TransactionResult.fromXDR(resultXdr, 'base64').result()
    const txName = outer.switch().name
    if (txName !== 'txFailed') return snake(txName)
    const operation = outer.results()[0]
    if (operation === undefined) return 'tx_failed'
    const operationName = operation.switch().name
    if (operationName !== 'opInner') return snake(operationName)
    return innerCode(operation.tr()) ?? 'tx_failed'
  } catch {
    return 'tx_failed'
  }
}

function innerCode(tr: xdr.OperationResultTr): string | null {
  const kind = tr.switch().name
  const resultName = resultSwitch(tr, kind)
  if (!resultName?.startsWith(kind)) return null
  return `op${snake(resultName.slice(kind.length))}`
}

function resultSwitch(tr: xdr.OperationResultTr, kind: xdr.OperationType['name']): string | null {
  if (kind === 'payment') return tr.paymentResult().switch().name
  if (kind === 'pathPaymentStrictReceive') return tr.pathPaymentStrictReceiveResult().switch().name
  if (kind === 'changeTrust') return tr.changeTrustResult().switch().name
  return null
}

function snake(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

interface HorizonFailure {
  readonly status: number | undefined
  readonly transaction: string | undefined
  readonly operations: readonly string[]
}

/**
 * SDK 14 submit throws an Axios error. BadResponseError instead stores the Horizon
 * JSON body on `response`. Both shapes carry the result codes.
 */
function horizonFailure(error: unknown): HorizonFailure | null {
  const payload = responsePayload(error)
  if (payload === null) return null
  const codes = resultCodes(payload.data)
  return {
    status: payload.status,
    transaction: codes?.transaction,
    operations: codes?.operations ?? [],
  }
}

function responsePayload(error: unknown): { status: number | undefined; data: unknown } | null {
  if (typeof error !== 'object' || error === null || !('response' in error)) return null
  const response: unknown = error.response
  if (typeof response !== 'object' || response === null) return null
  if ('extras' in response) {
    return { status: numberField(response, 'status'), data: response }
  }
  const status = numberField(response, 'status')
  const data = 'data' in response ? response.data : undefined
  if (status === undefined && data === undefined) return null
  return { status, data }
}

function resultCodes(data: unknown): { transaction: string; operations: readonly string[] } | null {
  if (typeof data !== 'object' || data === null || !('extras' in data)) return null
  const extras: unknown = data.extras
  if (typeof extras !== 'object' || extras === null || !('result_codes' in extras)) return null
  const codes: unknown = extras.result_codes
  if (typeof codes !== 'object' || codes === null || !('transaction' in codes)) return null
  if (typeof codes.transaction !== 'string') return null
  const operations =
    'operations' in codes && Array.isArray(codes.operations) ? codes.operations : []
  return {
    transaction: codes.transaction,
    operations: operations.filter((item): item is string => typeof item === 'string'),
  }
}

function numberField(value: object, key: string): number | undefined {
  if (!(key in value)) return undefined
  const field: unknown = value[key as keyof typeof value]
  return typeof field === 'number' ? field : undefined
}
