import { describe, expect, it } from 'vitest'

import { ManualClock } from '../../../test/fakes/fake-grant-gateway.ts'
import { FakePaymentsNetwork } from '../../../test/fakes/fake-payments-network.ts'
import { createMemoryCashInRepository } from '../../../test/fakes/memory-cash-in-repository.ts'
import { DomainError } from '../../shared/errors.ts'
import { money, type Money } from '../../shared/money.ts'
import type { IdGenerator } from '../../shared/ports.ts'
import { Mutex } from '../../shared/mutex.ts'
import { StoreGrantError } from '../../store-grant/application/errors.ts'
import type { StoreGrantService } from '../../store-grant/application/store-grant-service.ts'
import {
  StellarError,
  type DestinationCheck,
  type UsdcNetwork,
} from '../../treasury/usdc-network.ts'
import { createQuoted } from '../domain/cash-in.ts'
import { PaymentsNetworkError, type PaymentsNetwork } from '../payments-network.ts'
import type { CashInRepository } from '../repository.ts'
import { CreateCashIn, type CashInLogger, type CreateCashInInput } from './create-cash-in.ts'

const NOW = new Date('2026-10-17T12:00:00.000Z')
const RATE = money(10_000n, 'COP', 2)
const ADDRESS = `G${'A'.repeat(55)}`
const CUSTOMER = {
  phone: '3001112233',
  fullName: 'Ada Lovelace',
  documentNumber: '12345678',
}

function request(copAmount = '100.00', idempotencyKey?: string): CreateCashInInput {
  return {
    copAmount,
    stellarAddress: ADDRESS,
    customer: CUSTOMER,
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
  }
}

function scriptedUsdc(
  options: {
    readonly balance?: Money
    readonly destination?: DestinationCheck
    readonly fail?: StellarError
  } = {},
): UsdcNetwork {
  const balance = options.balance ?? money(1_000_000_000_000n, 'USDC', 7)
  const destination = options.destination ?? { ok: true as const }
  const reject = (name: string) => () => Promise.reject(new Error(name))
  return {
    ensureOperatorReady: reject('ready'),
    balance: () => {
      if (options.fail !== undefined) return Promise.reject(options.fail)
      return Promise.resolve(balance)
    },
    validateDestination: () => {
      if (options.fail !== undefined) return Promise.reject(options.fail)
      return Promise.resolve(destination)
    },
    prepareTransfer: reject('prepare'),
    submit: reject('submit'),
    lookup: reject('lookup'),
    refill: reject('refill'),
    isEnvelopeDead: reject('dead'),
  }
}

function grant(mode: 'ok' | 'missing' | 'exhausted'): Pick<StoreGrantService, 'assertCapacity'> {
  return {
    assertCapacity: () => {
      if (mode === 'missing') {
        return Promise.reject(new StoreGrantError('no_grant', 'store grant is not active'))
      }
      if (mode === 'exhausted') {
        return Promise.reject(new StoreGrantError('grant_exhausted', 'daily grant is exhausted'))
      }
      return Promise.resolve()
    },
  }
}

function harness(
  options: {
    readonly balance?: Money
    readonly destination?: DestinationCheck
    readonly failUsdc?: StellarError
    readonly grant?: 'ok' | 'missing' | 'exhausted'
    readonly payments?: PaymentsNetwork
    readonly repo?: CashInRepository
    readonly rate?: Money
    readonly log?: CashInLogger
  } = {},
) {
  const clock = new ManualClock(NOW)
  const repo = options.repo ?? createMemoryCashInRepository()
  const fake = new FakePaymentsNetwork({ rate: options.rate ?? RATE, clock })
  let incoming = 0
  const payments: PaymentsNetwork = options.payments ?? {
    createIncomingPayment: (input) => {
      incoming += 1
      return fake.createIncomingPayment(input)
    },
    createQuote: (input) => fake.createQuote(input),
    createOutgoingPayment: (input) => fake.createOutgoingPayment(input),
    findOutgoingPaymentByQuote: (input) => fake.findOutgoingPaymentByQuote(input),
    getOutgoingPayment: (id, accessToken) => fake.getOutgoingPayment(id, accessToken),
    getIncomingPayment: (url) => fake.getIncomingPayment(url),
    completeIncomingPayment: (url) => fake.completeIncomingPayment(url),
  }
  let sequence = 0
  const ids: IdGenerator = { next: () => `cash${String(++sequence).padStart(4, '0')}` }
  const logs: { fields: Readonly<Record<string, string>>; message: string }[] = []
  const log = options.log ?? {
    error(fields, message) {
      logs.push({ fields, message })
    },
  }
  const service = new CreateCashIn({
    cashIns: repo,
    payments,
    usdc: scriptedUsdc({
      ...(options.balance === undefined ? {} : { balance: options.balance }),
      ...(options.destination === undefined ? {} : { destination: options.destination }),
      ...(options.failUsdc === undefined ? {} : { fail: options.failUsdc }),
    }),
    rate: {
      current: () =>
        Promise.resolve({
          copPerUsdc: options.rate ?? RATE,
          spreadPct: '0',
          quotedAt: clock.now(),
        }),
    },
    storeGrant: grant(options.grant ?? 'ok'),
    clock,
    ids,
    mutex: new Mutex(),
    log,
  })
  return { service, repo, fake, clock, logs, incoming: () => incoming }
}

describe('CreateCashIn', () => {
  it('quotes a cash-in that expires at most 60 seconds out', async () => {
    const { service, repo } = harness()
    const cashIn = await service.create(request())
    expect(cashIn).toMatchObject({
      id: 'cash0001',
      status: 'quoted',
      memo: 'WALLE-CASH0001',
      stellarAddress: ADDRESS,
      customer: CUSTOMER,
      version: 1,
    })
    expect(cashIn.cop).toEqual(money(10_000n, 'COP', 2))
    expect(cashIn.usdc).toEqual(money(100n, 'USDC', 2))
    expect(cashIn.copPerUsdc).toEqual(RATE)
    expect(cashIn.expiresAt.toISOString()).toBe('2026-10-17T12:01:00.000Z')
    expect(cashIn.openPayments.incomingPaymentUrl).toMatch(/^https:\/\/payments\.invalid\//)
    expect(await repo.get(cashIn.id)).toEqual(cashIn)
  })

  it('uses the quote expiry when it is sooner than 60 seconds', async () => {
    const { fake, clock } = harness()
    const sooner = new Date(NOW.getTime() + 15_000)
    const payments: PaymentsNetwork = {
      createIncomingPayment: (input) => fake.createIncomingPayment(input),
      createQuote: async (input) => ({ ...(await fake.createQuote(input)), expiresAt: sooner }),
      createOutgoingPayment: (input) => fake.createOutgoingPayment(input),
      findOutgoingPaymentByQuote: (input) => fake.findOutgoingPaymentByQuote(input),
      getOutgoingPayment: (id, accessToken) => fake.getOutgoingPayment(id, accessToken),
      getIncomingPayment: (url) => fake.getIncomingPayment(url),
      completeIncomingPayment: (url) => fake.completeIncomingPayment(url),
    }
    const custom = harness({ payments })
    const cashIn = await custom.service.create(request())
    expect(cashIn.expiresAt).toEqual(sooner)
    expect(clock.now()).toEqual(NOW)
  })

  it.each([
    ['nope', 'amount must be a decimal'],
    ['31.76', 'cash amount must be at least 31.77 COP'],
    ['0.00', 'cash amount must be at least 31.77 COP'],
  ])('rejects cop %s', async (copAmount, detail) => {
    const { service, incoming } = harness()
    await expect(service.create(request(copAmount))).rejects.toMatchObject({
      code: 'invalid_request',
      detail,
    })
    expect(incoming()).toBe(0)
  })

  it('rejects a stellar address with the wrong shape', async () => {
    const { service } = harness()
    await expect(
      service.create({ ...request(), stellarAddress: 'not-an-address' }),
    ).rejects.toMatchObject({ code: 'invalid_request' })
  })

  it('rejects a quote that floors to zero USDC', async () => {
    const { service } = harness({ rate: money(10_000_000n, 'COP', 2) })
    await expect(service.create(request('31.77'))).rejects.toMatchObject({
      code: 'invalid_request',
      detail: 'quoted USDC is zero',
    })
  })

  it('accepts 100.00 USDC and rejects 100.01 USDC', async () => {
    const { service } = harness()
    await expect(service.create(request('10000.00'))).resolves.toMatchObject({
      usdc: money(10_000n, 'USDC', 2),
    })
    await expect(service.create(request('10001.00'))).rejects.toMatchObject({
      code: 'limit_exceeded',
      detail: 'USDC transaction limit is 100.00',
    })
  })

  it('rejects the UIAF single-transaction threshold', async () => {
    const { service } = harness()
    await expect(service.create(request('10000000.00'))).rejects.toMatchObject({
      code: 'limit_exceeded',
      detail: 'single cash-in reaches the UIAF threshold of 10000000.00 COP',
    })
  })

  it('rejects a missing grant and an exhausted grant', async () => {
    await expect(harness({ grant: 'missing' }).service.create(request())).rejects.toMatchObject({
      code: 'no_grant',
    })
    await expect(harness({ grant: 'exhausted' }).service.create(request())).rejects.toMatchObject({
      code: 'grant_exhausted',
    })
  })

  it.each(['invalid_address', 'account_not_found', 'no_trustline'] as const)(
    'rejects destination %s',
    async (reason) => {
      const { service } = harness({ destination: { ok: false, reason } })
      await expect(service.create(request())).rejects.toMatchObject({
        code: 'invalid_address',
        detail: reason,
      })
    },
  )

  it('maps a Stellar network failure to backend_down', async () => {
    const { service } = harness({
      failUsdc: new StellarError('unavailable', 'horizon timeout'),
    })
    await expect(service.create(request())).rejects.toMatchObject({
      code: 'backend_down',
      detail: 'horizon timeout',
    })
  })

  it('passes when inventory matches the quote and fails one cent short', async () => {
    const exact = harness({ balance: money(10_000_000n, 'USDC', 7) })
    await expect(exact.service.create(request())).resolves.toMatchObject({
      usdc: money(100n, 'USDC', 2),
    })
    const short = harness({ balance: money(9_900_000n, 'USDC', 7) })
    await expect(short.service.create(request())).rejects.toMatchObject({
      code: 'insufficient_inventory',
    })
  })

  it('counts USDC reserved by another quoted cash-in', async () => {
    const repo = createMemoryCashInRepository()
    await repo.insert(
      createQuoted(
        {
          id: 'held0001',
          cop: money(10_000n, 'COP', 2),
          usdc: money(100n, 'USDC', 2),
          copPerUsdc: RATE,
          expiresAt: new Date(NOW.getTime() + 30_000),
          stellarAddress: ADDRESS,
          customer: CUSTOMER,
          incomingPaymentUrl: 'https://payments.invalid/incoming-payments/held',
          quoteId: 'https://payments.invalid/quotes/held',
        },
        { now: () => NOW },
      ),
    )
    const { service } = harness({ repo, balance: money(10_000_000n, 'USDC', 7) })
    await expect(service.create(request())).rejects.toMatchObject({
      code: 'insufficient_inventory',
    })
  })

  it('maps a rejected quote and an unavailable quote', async () => {
    const rejected = harness()
    rejected.fake.failNextQuote(new PaymentsNetworkError('rejected', 'non-positive receive amount'))
    await expect(rejected.service.create(request())).rejects.toMatchObject({
      code: 'invalid_request',
      detail: 'non-positive receive amount',
    })
    const down = harness()
    down.fake.failNextQuote(new PaymentsNetworkError('unauthorized', 'token rejected'))
    await expect(down.service.create(request())).rejects.toMatchObject({
      code: 'backend_down',
      detail: 'token rejected',
    })
    const offline = harness()
    offline.fake.failNextQuote(new PaymentsNetworkError('unavailable', 'wallet timeout'))
    await expect(offline.service.create(request())).rejects.toMatchObject({
      code: 'backend_down',
      detail: 'wallet timeout',
    })
  })

  it('refuses a quote that pays out less USDC than the customer rate', async () => {
    const base = harness()
    const payments: PaymentsNetwork = {
      createIncomingPayment: (input) => base.fake.createIncomingPayment(input),
      createQuote: async (input) => ({
        ...(await base.fake.createQuote(input)),
        receive: money(1n, 'USD', 2),
      }),
      createOutgoingPayment: (input) => base.fake.createOutgoingPayment(input),
      findOutgoingPaymentByQuote: (input) => base.fake.findOutgoingPaymentByQuote(input),
      getOutgoingPayment: (id, accessToken) => base.fake.getOutgoingPayment(id, accessToken),
      getIncomingPayment: (url) => base.fake.getIncomingPayment(url),
      completeIncomingPayment: (url) => base.fake.completeIncomingPayment(url),
    }
    const { service, repo, logs } = harness({ payments })
    await expect(service.create(request())).rejects.toMatchObject({ code: 'internal_error' })
    expect(logs).toEqual([
      {
        message: 'quote receive is below the USDC amount',
        fields: { receive: '1', usdc: '100' },
      },
    ])
    expect(JSON.stringify(logs)).not.toContain(CUSTOMER.documentNumber)
    expect(await repo.get('cash0001')).toBeUndefined()
  })

  it('lets exactly one of two concurrent creates take the last USDC', async () => {
    const { service } = harness({ balance: money(10_000_000n, 'USDC', 7) })
    const results = await Promise.allSettled([service.create(request()), service.create(request())])
    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({
      status: 'rejected',
      reason: { code: 'insufficient_inventory' },
    })
  })

  it('maps a rejected incoming payment', async () => {
    const base = harness()
    const payments: PaymentsNetwork = {
      createIncomingPayment: () =>
        Promise.reject(new PaymentsNetworkError('rejected', 'incoming refused')),
      createQuote: (input) => base.fake.createQuote(input),
      createOutgoingPayment: (input) => base.fake.createOutgoingPayment(input),
      findOutgoingPaymentByQuote: (input) => base.fake.findOutgoingPaymentByQuote(input),
      getOutgoingPayment: (id, accessToken) => base.fake.getOutgoingPayment(id, accessToken),
      getIncomingPayment: (url) => base.fake.getIncomingPayment(url),
      completeIncomingPayment: (url) => base.fake.completeIncomingPayment(url),
    }
    const { service } = harness({ payments })
    await expect(service.create(request())).rejects.toMatchObject({
      code: 'invalid_request',
      detail: 'incoming refused',
    })
  })

  it('returns the stored cash-in when the idempotency insert loses a race', async () => {
    const inner = createMemoryCashInRepository()
    let stored = false
    const repo: CashInRepository = {
      ...inner,
      findIdempotency: (key) => (stored ? inner.findIdempotency(key) : Promise.resolve(undefined)),
      insert: async (cashIn, record) => {
        await inner.insert(cashIn, record)
        stored = true
        throw new DomainError('version_conflict', 'version conflict')
      },
    }
    const { service } = harness({ repo })
    const cashIn = await service.create(request('100.00', 'key-race'))
    expect(cashIn.id).toBe('cash0001')
    expect((await inner.findIdempotency('key-race'))?.cashIn.id).toBe('cash0001')
  })

  it('rejects an idempotency race whose stored body differs', async () => {
    const inner = createMemoryCashInRepository()
    const repo: CashInRepository = {
      ...inner,
      findIdempotency: (key) =>
        inner
          .findIdempotency(key)
          .then((hit) => (hit === undefined ? undefined : { ...hit, body: 'other' })),
      insert: async (cashIn, record) => {
        await inner.insert(cashIn, record)
        throw new DomainError('version_conflict', 'version conflict')
      },
    }
    const { service } = harness({ repo })
    await expect(service.create(request('100.00', 'key-race'))).rejects.toMatchObject({
      code: 'invalid_request',
    })
  })

  it('replays the same idempotency key and rejects a different body', async () => {
    const { service, incoming } = harness()
    const first = await service.create(request('100.00', 'key-1'))
    const second = await service.create(request('100.00', 'key-1'))
    expect(second.id).toBe(first.id)
    expect(incoming()).toBe(1)
    await expect(service.create(request('200.00', 'key-1'))).rejects.toMatchObject({
      code: 'invalid_request',
    })
    expect(incoming()).toBe(1)
  })
})
