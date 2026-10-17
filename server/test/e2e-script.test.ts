import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { ManualClock } from './fakes/fake-grant-gateway.ts'
import { FakePaymentsNetwork } from './fakes/fake-payments-network.ts'
import { createMemoryStoreGrantRepository } from './fakes/memory-store-grant-repository.ts'
import { FakeUsdcNetwork } from './fakes/fake-usdc-network.ts'
import { composeApp } from '../src/compose.ts'
import type { Config } from '../src/config.ts'
import type { PaymentsNetwork } from '../src/cash-in/payments-network.ts'
import { applySpread } from '../src/pricing/quote.ts'
import { money, type Money } from '../src/shared/money.ts'
import type { StoreGrantRepository } from '../src/store-grant/repository.ts'

const NOW = new Date('2026-10-17T12:00:00.000Z')
const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../scripts/e2e-testnet.mjs',
)

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
      port: 0,
      publicBaseUrl: 'http://127.0.0.1:9',
      webBaseUrl: 'http://127.0.0.1:9',
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

/** The fake stays pending until asked. A walkthrough needs the payment to finish on its own. */
class AutoSettlePayments implements PaymentsNetwork {
  readonly #inner: FakePaymentsNetwork

  constructor(inner: FakePaymentsNetwork) {
    this.#inner = inner
  }

  createIncomingPayment(
    input: Parameters<PaymentsNetwork['createIncomingPayment']>[0],
  ): ReturnType<PaymentsNetwork['createIncomingPayment']> {
    return this.#inner.createIncomingPayment(input)
  }

  createQuote(
    input: Parameters<PaymentsNetwork['createQuote']>[0],
  ): ReturnType<PaymentsNetwork['createQuote']> {
    return this.#inner.createQuote(input)
  }

  createOutgoingPayment(
    input: Parameters<PaymentsNetwork['createOutgoingPayment']>[0],
  ): ReturnType<PaymentsNetwork['createOutgoingPayment']> {
    return this.#inner.createOutgoingPayment(input)
  }

  findOutgoingPaymentByQuote(
    input: Parameters<PaymentsNetwork['findOutgoingPaymentByQuote']>[0],
  ): ReturnType<PaymentsNetwork['findOutgoingPaymentByQuote']> {
    return this.#inner.findOutgoingPaymentByQuote(input)
  }

  async getOutgoingPayment(
    id: string,
    accessToken: string,
  ): ReturnType<PaymentsNetwork['getOutgoingPayment']> {
    this.#inner.setOutgoingStatus(id, 'paid')
    return this.#inner.getOutgoingPayment(id, accessToken)
  }

  async getIncomingPayment(url: string): ReturnType<PaymentsNetwork['getIncomingPayment']> {
    const current = await this.#inner.getIncomingPayment(url)
    if (current.received.amount === 0n) {
      this.#inner.setReceived(url, money(1n, 'USD', 2))
    }
    return this.#inner.getIncomingPayment(url)
  }

  completeIncomingPayment(url: string): Promise<void> {
    return this.#inner.completeIncomingPayment(url)
  }
}

async function listen(grants?: StoreGrantRepository): Promise<{
  base: string
  address: string
  close: () => Promise<void>
}> {
  const clock = new ManualClock(NOW)
  const rate = applySpread(money(317_700n, 'COP', 2), '3')
  const payments = new FakePaymentsNetwork({ rate, clock })
  const usdc = new FakeUsdcNetwork()
  await usdc.ensureOperatorReady()
  usdc.creditOperator(money(1_000_000_000n, 'USDC', 7))
  const account = await usdc.createAccount()
  await usdc.addUsdcTrustline(account.secret)
  const runtime = composeApp(config(), {
    logger: false,
    clock,
    grants: grants ?? createMemoryStoreGrantRepository({ all: () => [] }),
    payments: new AutoSettlePayments(payments),
    usdc,
    settlement: { pollMs: 50, maxBackoffMs: 50 },
  })
  runtime.start()
  await runtime.app.listen({ port: 0, host: '127.0.0.1' })
  const bound = runtime.app.server.address()
  if (bound === null || typeof bound === 'string') throw new Error('server did not bind a port')
  return {
    base: `http://127.0.0.1:${bound.port.toString()}`,
    address: account.address,
    close: () => runtime.close(),
  }
}

function runScript(
  args: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      cwd: path.resolve(path.dirname(SCRIPT), '../..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

describe('e2e-testnet script', () => {
  it('completes a cash-in against the composed fakes and prints the hash', async () => {
    const server = await listen(await seedGrant(money(100_000_000n, 'COP', 2)))
    try {
      const result = await runScript([
        '--address',
        server.address,
        '--cop',
        '100000',
        '--base',
        server.base,
      ])
      expect(result.stderr, result.stdout).toBe('')
      expect(result.code).toBe(0)
      expect(result.stdout).toMatch(/[0-9a-f]{64}/)
      expect(result.stdout).toContain('https://stellar.expert/explorer/testnet/tx/')
      expect(result.stdout).not.toContain('Prueba Testnet')
      expect(result.stdout).not.toContain('access')
    } finally {
      await server.close()
    }
  }, 30_000)

  it('stops when the daily grant is missing', async () => {
    const server = await listen()
    try {
      const result = await runScript(['--address', server.address, '--base', server.base])
      expect(result.code).toBe(2)
      expect(result.stdout).toContain(
        `Falta el grant diario. Apruébalo en ${server.base}/api/grant/start`,
      )
      expect(result.stdout).not.toContain('Cotización')
    } finally {
      await server.close()
    }
  })
})
