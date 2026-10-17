import { CashIn, httpStatusFor } from '@walle/contracts'
import { describe, expect, it } from 'vitest'

import { ManualClock } from '../../../test/fakes/fake-grant-gateway.ts'
import { FakePaymentsNetwork } from '../../../test/fakes/fake-payments-network.ts'
import { createMemoryStoreGrantRepository } from '../../../test/fakes/memory-store-grant-repository.ts'
import { money, type Money } from '../../shared/money.ts'
import type { StoreGrantRepository } from '../../store-grant/repository.ts'
import { type DestinationCheck, type UsdcNetwork } from '../../treasury/usdc-network.ts'
import { PaymentsNetworkError, type PaymentsNetwork } from '../../cash-in/payments-network.ts'
import { composeApp } from '../../compose.ts'
import type { Config } from '../../config.ts'

const NOW = new Date('2026-10-17T12:00:00.000Z')
const RATE = money(10_000n, 'COP', 2)
const ADDRESS = `G${'A'.repeat(55)}`
const CUSTOMER = {
  phone: '3001112233',
  fullName: 'Ada Lovelace',
  documentNumber: '12345678',
}

function config(): Config {
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
      dailyGrantLimitCop: '1000000.00',
      usdcFloat: '1000',
    },
    database: { path: ':memory:' },
  }
}

function scriptedUsdc(
  options: {
    readonly balance?: Money
    readonly destination?: DestinationCheck
  } = {},
): UsdcNetwork {
  const balance = options.balance ?? money(1_000_000_000_000n, 'USDC', 7)
  const destination = options.destination ?? { ok: true as const }
  const reject = (name: string) => () => Promise.reject(new Error(name))
  return {
    ensureOperatorReady: reject('ready'),
    balance: () => Promise.resolve(balance),
    validateDestination: () => Promise.resolve(destination),
    prepareTransfer: reject('prepare'),
    submit: reject('submit'),
    lookup: reject('lookup'),
    refill: reject('refill'),
    isEnvelopeDead: reject('dead'),
  }
}

async function seedGrant(limit: Money): Promise<StoreGrantRepository> {
  const grants = createMemoryStoreGrantRepository({ all: () => [] })
  await grants.put(
    {
      status: 'active',
      nonce: 'nonce',
      interactNonce: 'interact',
      grantEndpoint: 'https://auth.example.test/',
      continueUri: 'https://auth.example.test/continue',
      continueAccessToken: 'continue',
      accessToken: 'access',
      limit,
      interval: 'R/2026-10-17T00:00:00.000Z/P1D',
      grantExpiresAt: new Date('2026-10-18T00:00:00.000Z'),
      createdAt: NOW,
      updatedAt: NOW,
      version: 1,
    },
    null,
  )
  return grants
}

function body(copAmount = '100.00') {
  return { copAmount, stellarAddress: ADDRESS, customer: CUSTOMER }
}

async function appFor(
  options: {
    readonly grants?: StoreGrantRepository
    readonly payments?: PaymentsNetwork
    readonly usdc?: UsdcNetwork
    readonly clock?: ManualClock
  } = {},
) {
  const clock = options.clock ?? new ManualClock(NOW)
  const payments = options.payments ?? new FakePaymentsNetwork({ rate: RATE, clock })
  const runtime = composeApp(config(), {
    logger: false,
    clock,
    grants: options.grants ?? (await seedGrant(money(100_000_000n, 'COP', 2))),
    payments,
    usdc: options.usdc ?? scriptedUsdc(),
    rate: {
      current: () => Promise.resolve({ copPerUsdc: RATE, spreadPct: '0', quotedAt: clock.now() }),
    },
  })
  return { runtime, clock, payments }
}

describe('POST /api/cash-ins and GET /api/cash-ins/:id', () => {
  it('returns 201 CashIn without customer data', async () => {
    const { runtime } = await appFor()
    try {
      const response = await runtime.app.inject({
        method: 'POST',
        url: '/api/cash-ins',
        payload: body(),
      })
      expect(response.statusCode).toBe(201)
      const cashIn = CashIn.parse(response.json())
      expect(cashIn).toMatchObject({
        status: 'quoted',
        copAmount: '100.00',
        usdcAmount: '1.00',
        copPerUsdc: '100.00',
        stellarAddress: ADDRESS,
      })
      expect(response.body).not.toContain(CUSTOMER.phone)
      expect(response.body).not.toContain(CUSTOMER.fullName)
      expect(response.body).not.toContain(CUSTOMER.documentNumber)
      const read = await runtime.app.inject({
        method: 'GET',
        url: `/api/cash-ins/${cashIn.id}`,
      })
      expect(read.statusCode).toBe(200)
      expect(CashIn.parse(read.json()).id).toBe(cashIn.id)
    } finally {
      await runtime.close()
    }
  })

  it('returns 404 for an unknown cash-in', async () => {
    const { runtime } = await appFor()
    try {
      const response = await runtime.app.inject({ method: 'GET', url: '/api/cash-ins/missing' })
      expect(response.statusCode).toBe(httpStatusFor('not_found'))
      expect(response.json()).toEqual({ error: 'not_found', detail: 'cash-in was not found' })
    } finally {
      await runtime.close()
    }
  })

  it('expires a quote lazily on read', async () => {
    const clock = new ManualClock(NOW)
    const { runtime } = await appFor({ clock })
    try {
      const created = await runtime.app.inject({
        method: 'POST',
        url: '/api/cash-ins',
        payload: body(),
      })
      const id = CashIn.parse(created.json()).id
      clock.advance(60_000)
      const response = await runtime.app.inject({ method: 'GET', url: `/api/cash-ins/${id}` })
      expect(response.statusCode).toBe(200)
      expect(CashIn.parse(response.json()).status).toBe('expired')
    } finally {
      await runtime.close()
    }
  })

  it('replays an idempotency key and rejects a different body', async () => {
    const { runtime } = await appFor()
    try {
      const first = await runtime.app.inject({
        method: 'POST',
        url: '/api/cash-ins',
        headers: { 'idempotency-key': 'key-1' },
        payload: body(),
      })
      const second = await runtime.app.inject({
        method: 'POST',
        url: '/api/cash-ins',
        headers: { 'idempotency-key': 'key-1' },
        payload: body(),
      })
      expect(CashIn.parse(second.json()).id).toBe(CashIn.parse(first.json()).id)
      const conflict = await runtime.app.inject({
        method: 'POST',
        url: '/api/cash-ins',
        headers: { 'idempotency-key': 'key-1' },
        payload: body('200.00'),
      })
      expect(conflict.statusCode).toBe(httpStatusFor('invalid_request'))
      expect(conflict.json()).toMatchObject({ error: 'invalid_request' })
    } finally {
      await runtime.close()
    }
  })

  it('maps each cash-in failure to its contract status', async () => {
    const cases: {
      readonly code:
        | 'limit_exceeded'
        | 'no_grant'
        | 'grant_exhausted'
        | 'invalid_address'
        | 'insufficient_inventory'
        | 'invalid_request'
        | 'backend_down'
        | 'internal_error'
      readonly payload?: ReturnType<typeof body>
      readonly grants?: StoreGrantRepository
      readonly payments?: PaymentsNetwork
      readonly usdc?: UsdcNetwork
    }[] = []

    const limitClock = new ManualClock(NOW)
    cases.push({
      code: 'limit_exceeded',
      payload: body('10000000.00'),
    })
    cases.push({
      code: 'no_grant',
      grants: createMemoryStoreGrantRepository({ all: () => [] }),
    })
    cases.push({
      code: 'grant_exhausted',
      grants: await seedGrant(money(5_000n, 'COP', 2)),
    })
    cases.push({
      code: 'invalid_address',
      usdc: scriptedUsdc({ destination: { ok: false, reason: 'no_trustline' } }),
    })
    cases.push({
      code: 'insufficient_inventory',
      usdc: scriptedUsdc({ balance: money(0n, 'USDC', 7) }),
    })
    const rejected = new FakePaymentsNetwork({ rate: RATE, clock: limitClock })
    rejected.failNextQuote(new PaymentsNetworkError('rejected', 'debit was refused'))
    cases.push({ code: 'invalid_request', payments: rejected })
    const down = new FakePaymentsNetwork({ rate: RATE, clock: limitClock })
    down.failNextQuote(new PaymentsNetworkError('unavailable', 'wallet timeout'))
    cases.push({ code: 'backend_down', payments: down })
    const underpaid = new FakePaymentsNetwork({ rate: RATE, clock: limitClock })
    const shrinking: PaymentsNetwork = {
      createIncomingPayment: (input) => underpaid.createIncomingPayment(input),
      createQuote: async (input) => ({
        ...(await underpaid.createQuote(input)),
        receive: money(1n, 'USD', 2),
      }),
      createOutgoingPayment: (input) => underpaid.createOutgoingPayment(input),
      getOutgoingPayment: (id, token) => underpaid.getOutgoingPayment(id, token),
      getIncomingPayment: (url) => underpaid.getIncomingPayment(url),
      completeIncomingPayment: (url) => underpaid.completeIncomingPayment(url),
    }
    cases.push({ code: 'internal_error', payments: shrinking })

    for (const item of cases) {
      const { runtime } = await appFor({
        ...(item.grants === undefined ? {} : { grants: item.grants }),
        ...(item.payments === undefined ? {} : { payments: item.payments }),
        ...(item.usdc === undefined ? {} : { usdc: item.usdc }),
      })
      try {
        const response = await runtime.app.inject({
          method: 'POST',
          url: '/api/cash-ins',
          payload: item.payload ?? body(),
        })
        expect(response.statusCode, item.code).toBe(httpStatusFor(item.code))
        expect(response.json()).toMatchObject({ error: item.code })
        if (item.code === 'internal_error')
          expect(response.json()).toEqual({ error: 'internal_error' })
        expect(response.body).not.toContain(CUSTOMER.documentNumber)
      } finally {
        await runtime.close()
      }
    }
  })
})
