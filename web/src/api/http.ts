import { ApiError, type Api, type ApiErrorCode } from './types'

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError('backend_down')
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const code: ApiErrorCode = data?.error ?? (res.status === 404 ? 'not_found' : 'backend_down')
    throw new ApiError(code, data?.detail)
  }
  return data as T
}

/** Client for the team backend described in team/contracts.md. */
export const httpApi: Api = {
  rate: () => call('GET', '/rate'),
  createCashIn: (req) => call('POST', '/cash-ins', req),
  confirmCashIn: (id) => call('POST', `/cash-ins/${encodeURIComponent(id)}/confirm`),
  retryCashIn: (id) => call('POST', `/cash-ins/${encodeURIComponent(id)}/retry`),
  getCashIn: (id) => call('GET', `/cash-ins/${encodeURIComponent(id)}`),
  grant: () => call('GET', '/grant'),
  grantStartUrl: '/api/grant/start',
  operatorCashIns: () => call('GET', '/operator/cash-ins'),
  inventory: () => call('GET', '/operator/inventory'),
  refill: () => call('POST', '/operator/inventory/refill'),
}
