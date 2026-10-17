import { Writable } from 'node:stream'

import { describe, expect, it } from 'vitest'

import { money } from '../../shared/money.ts'
import type { StoreGrantService } from '../../store-grant/application/store-grant-service.ts'
import type { OperatorService } from '../../treasury/application/operator-service.ts'
import { buildApp } from './app.ts'
import { loggerOptions } from './logger.ts'
import { tokenMatches } from './operator-auth.ts'

const TOKEN = 'operator-token-16'
const WEB = 'http://localhost:5173'

const rate = {
  current: () =>
    Promise.resolve({
      copPerUsdc: money(1n, 'COP', 2),
      spreadPct: '1',
      quotedAt: new Date(0),
    }),
}

const storeGrant: Pick<StoreGrantService, 'start' | 'finish' | 'status'> = {
  start: () => Promise.resolve({ kind: 'redirect', url: 'https://grant.invalid/interact/1' }),
  finish: () => Promise.reject(new Error('unused')),
  status: () => Promise.resolve({ status: 'missing' }),
}

const operator: OperatorService = {
  listCashIns: () => Promise.resolve([]),
  inventory: () =>
    Promise.resolve({
      usdc: money(100n, 'USDC', 2),
      floatUsdc: money(1000n, 'USDC', 2),
      lowThresholdPct: 30,
      log: { rawAvailable: 100n },
    }),
  refill: () => Promise.resolve({ usdc: money(50n, 'USDC', 2) }),
}

const cashIns = {
  create: () => Promise.reject(new Error('unused')),
  get: () => Promise.reject(new Error('unused')),
  confirm: () => Promise.reject(new Error('unused')),
  retry: () => Promise.reject(new Error('unused')),
}

function appWith(operatorToken?: string) {
  return buildApp({
    logger: false,
    rate,
    storeGrant,
    cashIns,
    operator,
    webBaseUrl: WEB,
    ...(operatorToken === undefined ? {} : { operatorToken }),
  })
}

describe('tokenMatches', () => {
  it('accepts the same token and rejects a different one of equal length', () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true)
    expect(tokenMatches('operator-token-17', TOKEN)).toBe(false)
    expect(tokenMatches('short', TOKEN)).toBe(false)
    expect(tokenMatches('', TOKEN)).toBe(false)
  })
})

describe('operator token', () => {
  it('leaves grant start and operator routes open when the token is unset', async () => {
    const app = appWith()
    try {
      const start = await app.inject({ method: 'GET', url: '/api/grant/start' })
      expect(start.statusCode).toBe(302)
      const inventory = await app.inject({ method: 'GET', url: '/api/operator/inventory' })
      expect(inventory.statusCode).toBe(200)
    } finally {
      await app.close()
    }
  })

  it('requires the query token on grant start and the header on operator routes', async () => {
    const app = appWith(TOKEN)
    try {
      const denied = await app.inject({ method: 'GET', url: '/api/grant/start' })
      expect(denied.statusCode).toBe(401)
      expect(denied.json()).toEqual({
        error: 'invalid_request',
        detail: 'operator token required',
      })

      const wrong = await app.inject({
        method: 'GET',
        url: '/api/grant/start?token=operator-token-99',
      })
      expect(wrong.statusCode).toBe(401)

      const started = await app.inject({
        method: 'GET',
        url: `/api/grant/start?token=${TOKEN}`,
      })
      expect(started.statusCode).toBe(302)
      expect(started.headers.location).toBe('https://grant.invalid/interact/1')

      const missingHeader = await app.inject({
        method: 'POST',
        url: '/api/operator/inventory/refill',
      })
      expect(missingHeader.statusCode).toBe(401)
      expect(missingHeader.json()).toEqual({
        error: 'invalid_request',
        detail: 'operator token required',
      })

      const inventory = await app.inject({
        method: 'GET',
        url: '/api/operator/inventory',
        headers: { 'x-operator-token': TOKEN },
      })
      expect(inventory.statusCode).toBe(200)

      const grant = await app.inject({ method: 'GET', url: '/api/grant' })
      expect(grant.statusCode).toBe(200)
    } finally {
      await app.close()
    }
  })
})

describe('operator token hygiene', () => {
  it('never writes the query token to the logs', async () => {
    const lines: string[] = []
    const app = buildApp({
      logger: {
        ...loggerOptions,
        level: 'info',
        stream: new Writable({
          write(chunk: Buffer, _encoding, callback) {
            lines.push(chunk.toString())
            callback()
          },
        }),
      },
      rate,
      storeGrant,
      cashIns,
      operator,
      webBaseUrl: WEB,
      operatorToken: TOKEN,
    })
    try {
      await app.inject({ method: 'GET', url: `/api/grant/start?token=${TOKEN}&x=1` })
      await app.inject({ method: 'GET', url: '/api/grant/start?token=operator-token-99' })
    } finally {
      await app.close()
    }
    const text = lines.join('\n')
    expect(text).toContain('/api/grant/start')
    expect(text).not.toContain(TOKEN)
    expect(text).not.toContain('operator-token-99')
  })

  it('answers a denied operator request once and never runs the handler', async () => {
    let refills = 0
    const app = buildApp({
      logger: false,
      rate,
      storeGrant,
      cashIns,
      operator: {
        ...operator,
        refill: () => {
          refills += 1
          return Promise.resolve({ usdc: money(50n, 'USDC', 2) })
        },
      },
      webBaseUrl: WEB,
      operatorToken: TOKEN,
    })
    try {
      const denied = await app.inject({ method: 'POST', url: '/api/operator/inventory/refill' })
      expect(denied.statusCode).toBe(401)
      expect(refills).toBe(0)
      const allowed = await app.inject({
        method: 'POST',
        url: '/api/operator/inventory/refill',
        headers: { 'x-operator-token': TOKEN },
      })
      expect(allowed.statusCode).toBe(200)
      expect(refills).toBe(1)
    } finally {
      await app.close()
    }
  })
})
