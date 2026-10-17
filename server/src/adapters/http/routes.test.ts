import { Writable } from 'node:stream'
import { createHash } from 'node:crypto'

import { ApiError, Grant, Rate } from '@walle/contracts'
import { describe, expect, it } from 'vitest'
import { z, ZodError } from 'zod'

import { PaymentsNetworkError } from '../../cash-in/payments-network.ts'
import { DomainError } from '../../shared/errors.ts'
import { money } from '../../shared/money.ts'
import { Mutex } from '../../shared/mutex.ts'
import type { RateProvider } from '../../pricing/rate-provider.ts'
import { ConfiguredRateProvider } from '../../pricing/rate-provider.ts'
import { StoreGrantError } from '../../store-grant/application/errors.ts'
import { StoreGrantService } from '../../store-grant/application/store-grant-service.ts'
import { FakeGrantGateway, ManualClock } from '../../../test/fakes/fake-grant-gateway.ts'
import { createMemoryCashInRepository } from '../../../test/fakes/memory-cash-in-repository.ts'
import { createMemoryStoreGrantRepository } from '../../../test/fakes/memory-store-grant-repository.ts'
import { buildApp } from './app.ts'
import { AppError } from './errors.ts'

const WEB = 'http://localhost:5173'

function finishHash(input: {
  readonly nonce: string
  readonly interactNonce: string
  readonly interactRef: string
  readonly grantEndpoint: string
}): string {
  return createHash('sha256')
    .update([input.nonce, input.interactNonce, input.interactRef, input.grantEndpoint].join('\n'))
    .digest('base64')
}

function graph() {
  const clock = new ManualClock(new Date('2026-10-17T00:00:00.000Z'))
  const gateway = new FakeGrantGateway(clock, 120_000)
  const grants = createMemoryStoreGrantRepository(createMemoryCashInRepository())
  let sequence = 0
  const storeGrant = new StoreGrantService({
    grants,
    gateway,
    clock,
    ids: { next: () => `nonce-${String(++sequence)}` },
    mutex: new Mutex(),
    dailyGrantLimitCop: '100.00',
    publicBaseUrl: 'http://localhost:3000',
  })
  const rate = new ConfiguredRateProvider({ referenceCopPerUsd: '3177', spreadPct: '3' }, clock)
  const app = buildApp({ logger: false, rate, storeGrant, webBaseUrl: WEB, clock })
  return { app, clock, grants, storeGrant }
}

describe('HTTP routes', () => {
  it('returns the spread rate and validates it with the contract', async () => {
    const { app } = graph()
    try {
      const response = await app.inject({ method: 'GET', url: '/api/rate' })
      expect(response.statusCode).toBe(200)
      expect(Rate.parse(response.json())).toEqual({
        copPerUsdc: '3272.31',
        spreadPct: 3,
        quotedAt: '2026-10-17T00:00:00.000Z',
      })
    } finally {
      await app.close()
    }
  })

  it('reports missing, active, and expired grants', async () => {
    const { app, clock, storeGrant, grants } = graph()
    try {
      const missing = await app.inject({ method: 'GET', url: '/api/grant' })
      expect(missing.statusCode).toBe(200)
      expect(Grant.parse(missing.json())).toEqual({ status: 'missing' })

      const started = await storeGrant.start()
      if (started.kind !== 'redirect') throw new Error('expected a redirect')
      const pending = await grants.get()
      if (pending === undefined) throw new Error('pending missing')
      const interactRef = 'ref-http'
      const hash = finishHash({
        nonce: pending.nonce,
        interactNonce: pending.interactNonce,
        interactRef,
        grantEndpoint: pending.grantEndpoint,
      })
      await storeGrant.finish({ hash, interactRef })

      const active = await app.inject({ method: 'GET', url: '/api/grant' })
      expect(Grant.parse(active.json())).toEqual({
        status: 'active',
        limitCop: '100.00',
        spentCop: '0.00',
        expiresAt: '2026-10-18T00:00:00.000Z',
      })

      clock.advance(24 * 60 * 60 * 1000)
      const expired = await app.inject({ method: 'GET', url: '/api/grant' })
      expect(Grant.parse(expired.json())).toEqual({
        status: 'expired',
        expiresAt: '2026-10-18T00:00:00.000Z',
      })
    } finally {
      await app.close()
    }
  })

  it('redirects grant start to the wallet and to the store when already active', async () => {
    const { app, grants } = graph()
    try {
      const start = await app.inject({ method: 'GET', url: '/api/grant/start' })
      expect(start.statusCode).toBe(302)
      expect(start.headers.location).toMatch(/^https:\/\/grant\.invalid\/interact\//)

      const pending = await grants.get()
      if (pending === undefined) throw new Error('pending missing')
      const interactRef = 'ref-start'
      const hash = finishHash({
        nonce: pending.nonce,
        interactNonce: pending.interactNonce,
        interactRef,
        grantEndpoint: pending.grantEndpoint,
      })
      const finished = await app.inject({
        method: 'GET',
        url: `/api/grant/finish?hash=${encodeURIComponent(hash)}&interact_ref=${interactRef}`,
      })
      expect(finished.headers.location).toBe(`${WEB}/tienda?grant=ok`)

      const again = await app.inject({ method: 'GET', url: '/api/grant/start' })
      expect(again.statusCode).toBe(302)
      expect(again.headers.location).toBe(`${WEB}/tienda?grant=ok`)
    } finally {
      await app.close()
    }
  })

  it('redirects finish to ok or error without leaking the failure', async () => {
    const { app, grants } = graph()
    try {
      await app.inject({ method: 'GET', url: '/api/grant/start' })
      const pending = await grants.get()
      if (pending === undefined) throw new Error('pending missing')
      const interactRef = 'ref-finish'
      const hash = finishHash({
        nonce: pending.nonce,
        interactNonce: pending.interactNonce,
        interactRef,
        grantEndpoint: pending.grantEndpoint,
      })
      const secret = 'super-secret-hash'
      const failed = await app.inject({
        method: 'GET',
        url: `/api/grant/finish?hash=${secret}&interact_ref=${interactRef}`,
      })
      expect(failed.statusCode).toBe(302)
      expect(failed.headers.location).toBe(`${WEB}/tienda?grant=error`)
      expect(failed.body).not.toContain(secret)
      expect(failed.headers.location).not.toContain(secret)
      expect(await grants.get()).toEqual(pending)

      const missing = await app.inject({ method: 'GET', url: '/api/grant/finish' })
      expect(missing.statusCode).toBe(302)
      expect(missing.headers.location).toBe(`${WEB}/tienda?grant=error`)

      const ok = await app.inject({
        method: 'GET',
        url: `/api/grant/finish?hash=${encodeURIComponent(hash)}&interact_ref=${interactRef}`,
      })
      expect(ok.statusCode).toBe(302)
      expect(ok.headers.location).toBe(`${WEB}/tienda?grant=ok`)
    } finally {
      await app.close()
    }
  })
})

describe('HTTP error handler', () => {
  function appWith(failure: unknown, logs?: string[]) {
    const rate: RateProvider = {
      current() {
        return Promise.reject(failure instanceof Error ? failure : new Error('failed'))
      },
    }
    const storeGrant = {
      start: () => Promise.reject(new Error('unused')),
      finish: () => Promise.reject(new Error('unused')),
      status: () => Promise.reject(new Error('unused')),
    }
    const logger =
      logs === undefined
        ? false
        : {
            level: 'error' as const,
            stream: new Writable({
              write(chunk: Buffer, _encoding, callback) {
                logs.push(chunk.toString())
                callback()
              },
            }),
          }
    return buildApp({
      logger,
      rate,
      storeGrant,
      webBaseUrl: WEB,
    })
  }

  const cases: readonly {
    readonly name: string
    readonly failure: unknown
    readonly status: number
    readonly body: { error: string; detail?: string }
    readonly hidden?: string
  }[] = [
    {
      name: 'app error',
      failure: new AppError('no_grant', 'missing grant'),
      status: 412,
      body: { error: 'no_grant', detail: 'missing grant' },
    },
    {
      name: 'grant exhausted',
      failure: new StoreGrantError('grant_exhausted', 'daily grant is exhausted'),
      status: 409,
      body: { error: 'grant_exhausted', detail: 'daily grant is exhausted' },
    },
    {
      name: 'missing grant',
      failure: new StoreGrantError('no_grant', 'store grant is not active'),
      status: 412,
      body: { error: 'no_grant', detail: 'store grant is not active' },
    },
    {
      name: 'invalid finish',
      failure: new StoreGrantError('invalid_finish', 'finish hash did not match'),
      status: 400,
      body: { error: 'invalid_request', detail: 'finish hash did not match' },
    },
    {
      name: 'limit exceeded',
      failure: new DomainError('limit_exceeded', 'over the level'),
      status: 400,
      body: { error: 'limit_exceeded', detail: 'over the level' },
    },
    {
      name: 'quote expired',
      failure: new DomainError('quote_expired', 'quote is over'),
      status: 409,
      body: { error: 'quote_expired', detail: 'quote is over' },
    },
    {
      name: 'invalid transition',
      failure: new DomainError('invalid_transition', 'cannot move'),
      status: 409,
      body: { error: 'invalid_state', detail: 'cannot move' },
    },
    {
      name: 'version conflict',
      failure: new DomainError('version_conflict', 'version conflict'),
      status: 409,
      body: { error: 'invalid_state', detail: 'version conflict' },
    },
    {
      name: 'invalid amount',
      failure: new DomainError('invalid_amount', 'amount must be a decimal'),
      status: 400,
      body: { error: 'invalid_request', detail: 'amount must be a decimal' },
    },
    {
      name: 'other domain error',
      failure: new DomainError('asset_mismatch', 'amounts use different assets'),
      status: 500,
      body: { error: 'internal_error' },
      hidden: 'amounts use different assets',
    },
  ]

  it.each(cases)('maps $name', async ({ failure, status, body, hidden }) => {
    const app = appWith(failure)
    try {
      const response = await app.inject({ method: 'GET', url: '/api/rate' })
      expect(response.statusCode).toBe(status)
      expect(ApiError.parse(response.json())).toEqual(body)
      if (hidden !== undefined) expect(response.body).not.toContain(hidden)
    } finally {
      await app.close()
    }
  })

  it('maps a thrown ZodError to invalid_request', async () => {
    let failure: unknown
    try {
      z.string().parse(1)
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(ZodError)
    const app = appWith(failure)
    try {
      const response = await app.inject({ method: 'GET', url: '/api/rate' })
      expect(response.statusCode).toBe(400)
      expect(ApiError.parse(response.json()).error).toBe('invalid_request')
    } finally {
      await app.close()
    }
  })

  it('maps a query that fails the route schema to invalid_request', async () => {
    const { app } = graph()
    try {
      const response = await app.inject({ method: 'GET', url: '/api/rate?extra=1' })
      expect(response.statusCode).toBe(400)
      expect(ApiError.parse(response.json()).error).toBe('invalid_request')
    } finally {
      await app.close()
    }
  })

  it('hides unknown failures behind a generic body and logs the request id', async () => {
    const logs: string[] = []
    const app = appWith(new Error('hunter2'), logs)
    try {
      const response = await app.inject({ method: 'GET', url: '/api/rate' })
      expect(response.statusCode).toBe(500)
      expect(response.json()).toEqual({ error: 'internal_error' })
      expect(response.body).not.toContain('hunter2')
      const text = logs.join('')
      expect(text).toContain('unhandled error')
      expect(text).toContain('"reqId"')
      expect(text).not.toContain('"body"')
    } finally {
      await app.close()
    }
  })

  it('redirects an unexpected finish failure instead of returning JSON', async () => {
    const rate: RateProvider = {
      current: () =>
        Promise.resolve({
          copPerUsdc: money(1n, 'COP', 2),
          spreadPct: '1',
          quotedAt: new Date(0),
        }),
    }
    const app = buildApp({
      logger: false,
      rate,
      webBaseUrl: WEB,
      storeGrant: {
        start: () => Promise.reject(new Error('unused')),
        status: () => Promise.reject(new Error('unused')),
        finish: () => Promise.reject(new PaymentsNetworkError('unavailable', 'token=secret-value')),
      },
    })
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/grant/finish?hash=abc&interact_ref=ref',
      })
      expect(response.statusCode).toBe(302)
      expect(response.headers.location).toBe(`${WEB}/tienda?grant=error`)
      expect(response.body).not.toContain('secret-value')
    } finally {
      await app.close()
    }
  })
})
