import { CashIn, Inventory } from '@walle/contracts'
import { describe, expect, it } from 'vitest'

import { ManualClock } from '../fakes/fake-grant-gateway.ts'
import { FakePaymentsNetwork } from '../fakes/fake-payments-network.ts'
import { createMemoryStoreGrantRepository } from '../fakes/memory-store-grant-repository.ts'
import { FakeUsdcNetwork } from '../fakes/fake-usdc-network.ts'
import { composeApp } from '../../src/compose.ts'
import type { Config } from '../../src/config.ts'
import { money, type Money } from '../../src/shared/money.ts'
import type { StoreGrantRepository } from '../../src/store-grant/repository.ts'

const NOW = new Date('2026-10-17T12:00:00.000Z')
const RATE = money(10_000n, 'COP', 2)
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
      manageUrl: 'https://auth.example.test/manage',
      tokenExpiresAt: new Date('2026-10-17T18:00:00.000Z'),
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

describe('cash-in settlement', () => {
  it('shows every status and completes a retried stellar failure', async () => {
    const clock = new ManualClock(NOW)
    const payments = new FakePaymentsNetwork({ rate: RATE, clock })
    const usdc = new FakeUsdcNetwork()
    await usdc.ensureOperatorReady()
    usdc.creditOperator(money(100_000_000n, 'USDC', 7))
    const account = await usdc.createAccount()
    await usdc.addUsdcTrustline(account.secret)
    const runtime = composeApp(config(), {
      logger: false,
      clock,
      grants: await seedGrant(money(100_000_000n, 'COP', 2)),
      payments,
      usdc,
      rate: {
        current: () => Promise.resolve({ copPerUsdc: RATE, spreadPct: '0', quotedAt: clock.now() }),
      },
    })
    try {
      const before = await runtime.app.inject({ method: 'GET', url: '/api/operator/inventory' })
      expect(Inventory.parse(before.json()).usdc).toBe('10.00')

      const first = await pay(runtime, payments, account.address)
      expect(first.seen).toEqual(['settling', 'settled', 'sending_usdc', 'completed'])
      expect(first.done.stellarTxHash).toMatch(/^[0-9a-f]{64}$/)
      const afterFirst = await runtime.app.inject({ method: 'GET', url: '/api/operator/inventory' })
      expect(Inventory.parse(afterFirst.json()).usdc).toBe('9.00')

      const second = await pay(runtime, payments, account.address, async (id) => {
        usdc.failNextSubmitWith('underfunded')
        await runtime.runOnce()
        const failed = await read(runtime, id)
        expect(failed.status).toBe('failed_stellar')
        const retry = await runtime.app.inject({
          method: 'POST',
          url: `/api/cash-ins/${id}/retry`,
        })
        expect(retry.statusCode).toBe(202)
        expect(CashIn.parse(retry.json()).status).toBe('sending_usdc')
      })
      expect(second.done.status).toBe('completed')
      expect(second.done.stellarTxHash).toMatch(/^[0-9a-f]{64}$/)
      expect(second.done.stellarTxHash).not.toBe(first.done.stellarTxHash)
      const afterRetry = await runtime.app.inject({ method: 'GET', url: '/api/operator/inventory' })
      expect(Inventory.parse(afterRetry.json()).usdc).toBe('8.00')
    } finally {
      await runtime.close()
    }
  })
})

async function pay(
  runtime: ReturnType<typeof composeApp>,
  payments: FakePaymentsNetwork,
  address: string,
  onSending?: (id: string) => Promise<void>,
): Promise<{ seen: string[]; done: CashIn }> {
  const created = await runtime.app.inject({
    method: 'POST',
    url: '/api/cash-ins',
    payload: { copAmount: '100.00', stellarAddress: address, customer: CUSTOMER },
  })
  expect(created.statusCode).toBe(201)
  const id = CashIn.parse(created.json()).id
  const confirmed = await runtime.app.inject({
    method: 'POST',
    url: `/api/cash-ins/${id}/confirm`,
  })
  expect(confirmed.statusCode).toBe(202)
  const settling = CashIn.parse(confirmed.json())
  const outgoingId = settling.openPayments.outgoingPaymentId
  if (outgoingId === undefined) throw new Error('confirm did not store an outgoing payment')
  payments.setOutgoingStatus(outgoingId, 'paid')
  payments.setReceived(settling.openPayments.incomingPaymentUrl, money(100n, 'USD', 2))

  const seen: string[] = []
  let done = settling
  for (let step = 0; step < 8; step += 1) {
    done = await read(runtime, id)
    seen.push(done.status)
    if (done.status === 'completed') break
    if (done.status === 'sending_usdc' && onSending !== undefined) {
      await onSending(id)
      onSending = undefined
      continue
    }
    await runtime.runOnce()
  }
  return { seen, done }
}

async function read(runtime: ReturnType<typeof composeApp>, id: string): Promise<CashIn> {
  const response = await runtime.app.inject({ method: 'GET', url: `/api/cash-ins/${id}` })
  expect(response.statusCode).toBe(200)
  return CashIn.parse(response.json())
}
