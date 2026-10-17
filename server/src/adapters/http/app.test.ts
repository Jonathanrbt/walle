import { describe, expect, it } from 'vitest'

import { money } from '../../shared/money.ts'
import type { RateProvider } from '../../pricing/rate-provider.ts'
import type { StoreGrantService } from '../../store-grant/application/store-grant-service.ts'
import { buildApp } from './app.ts'
import { unusedOperator } from '../../../test/fakes/unused-operator.ts'

const rate: RateProvider = {
  current: () =>
    Promise.resolve({
      copPerUsdc: money(1n, 'COP', 2),
      spreadPct: '1',
      quotedAt: new Date(0),
    }),
}

const storeGrant: Pick<StoreGrantService, 'start' | 'finish' | 'status'> = {
  start: () => Promise.reject(new Error('unused')),
  finish: () => Promise.reject(new Error('unused')),
  status: () => Promise.reject(new Error('unused')),
}

const cashIns = {
  create: () => Promise.reject(new Error('unused')),
  get: () => Promise.reject(new Error('unused')),
}

function build() {
  return buildApp({
    logger: false,
    rate,
    storeGrant,
    cashIns,
    operator: unusedOperator,
    webBaseUrl: 'http://localhost:5173',
  })
}

describe('buildApp', () => {
  it('returns 200 and { status: "ok" } for GET /healthz', async () => {
    const app = build()
    try {
      const response = await app.inject({ method: 'GET', url: '/healthz' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ status: 'ok' })
    } finally {
      await app.close()
    }
  })

  it('returns 404 for an unknown route', async () => {
    const app = build()
    try {
      const response = await app.inject({ method: 'GET', url: '/missing' })

      expect(response.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  })
})
