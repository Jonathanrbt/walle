import { PaymentsNetworkError, type PaymentsFailureKind } from '../../cash-in/payments-network.ts'
import { PrivateKeyError } from './private-key.ts'

const SAFE_DETAIL = /^[A-Za-z0-9 .,:'()-]+$/

const FALLBACK: Record<PaymentsFailureKind, string> = {
  rejected: 'the payments network rejected the request',
  unauthorized: 'the payments network refused the credentials',
  unavailable: 'the payments network is unavailable',
}

export function mapOpenPaymentsError(error: unknown): PaymentsNetworkError {
  const kind = kindFor(readStatus(error))
  return new PaymentsNetworkError(kind, safeDetail(readDescription(error), FALLBACK[kind]))
}

export async function attempt<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof PaymentsNetworkError || error instanceof PrivateKeyError) throw error
    throw mapOpenPaymentsError(error)
  }
}

function kindFor(status: number | undefined): PaymentsFailureKind {
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === undefined || status >= 500) return 'unavailable'
  if (status >= 400 && status < 500) return 'rejected'
  return 'unavailable'
}

function readStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined
  const { status } = error
  return typeof status === 'number' && Number.isInteger(status) ? status : undefined
}

function readDescription(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('description' in error)) return undefined
  const { description } = error
  return typeof description === 'string' ? description : undefined
}

function safeDetail(description: string | undefined, fallback: string): string {
  if (description === undefined) return fallback
  if (description.length === 0 || description.length > 160) return fallback
  if (/[^\s]{16,}/.test(description)) return fallback
  if (!SAFE_DETAIL.test(description)) return fallback
  return description
}
