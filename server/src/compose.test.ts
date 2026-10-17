import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Grant, Rate } from '@walle/contracts'
import { describe, expect, it } from 'vitest'

import { FakeGrantGateway, ManualClock } from '../test/fakes/fake-grant-gateway.ts'
import { composeApp } from './compose.ts'
import type { Config } from './config.ts'

function config(databasePath: string): Config {
  return {
    store: {
      walletAddressUrl: 'https://127.0.0.1:9/store',
      keyId: 'store-key',
      privateKey: 'BEGIN PRIVATE KEY',
    },
    operator: {
      walletAddressUrl: 'https://127.0.0.1:9/operator',
      keyId: 'operator-key',
      privateKey: 'BEGIN PRIVATE KEY',
    },
    stellar: {
      operatorSecret: 'unused',
      horizonUrl: 'https://horizon-testnet.stellar.org',
      usdcIssuer: 'GCDF7VTSBPXFQJJ4HQKP725J4FX43GWMIUUH5X4QYPNV3IF2RE2BCTXL',
    },
    http: {
      port: 3000,
      publicBaseUrl: 'http://localhost:3000',
      webBaseUrl: 'http://localhost:5173',
      logLevel: 'silent',
    },
    business: {
      referenceCopPerUsd: '3177',
      spreadPct: '3',
      dailyGrantLimitCop: '100.00',
      usdcFloat: '1000',
    },
    database: { path: databasePath },
  }
}

describe('composeApp', () => {
  it('serves health, rate, and a missing grant without calling the network', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'walle-b6-'))
    const runtime = composeApp(config(join(dir, 'nested', 'walle.sqlite')), { logger: false })
    try {
      const health = await runtime.app.inject({ method: 'GET', url: '/healthz' })
      expect(health.statusCode).toBe(200)
      const rate = await runtime.app.inject({ method: 'GET', url: '/api/rate' })
      expect(rate.statusCode).toBe(200)
      expect(Rate.parse(rate.json()).copPerUsdc).toBe('3272.31')
      const grant = await runtime.app.inject({ method: 'GET', url: '/api/grant' })
      expect(Grant.parse(grant.json())).toEqual({ status: 'missing' })
    } finally {
      await runtime.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('redirects grant start through an overridden gateway', async () => {
    const clock = new ManualClock(new Date('2026-10-17T00:00:00.000Z'))
    const runtime = composeApp(config(':memory:'), {
      logger: false,
      clock,
      gateway: new FakeGrantGateway(clock, 60_000),
    })
    try {
      const start = await runtime.app.inject({ method: 'GET', url: '/api/grant/start' })
      expect(start.statusCode).toBe(302)
      expect(start.headers.location).toMatch(/^https:\/\/grant\.invalid\/interact\//)
    } finally {
      await runtime.close()
    }
  })
})
