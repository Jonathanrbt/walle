import { OpenPaymentsClientError, type AuthenticatedClient } from '@interledger/open-payments'
import { describe, expect, it, vi } from 'vitest'

import type { Clock } from '../../shared/ports.ts'
import { money } from '../../shared/money.ts'
import type { WalletSession } from './clients.ts'
import { createPaymentsNetwork } from './payments-network.ts'

class ManualClock implements Clock {
  #now: number

  constructor(iso: string) {
    this.#now = Date.parse(iso)
  }

  now(): Date {
    return new Date(this.#now)
  }

  advance(ms: number): void {
    this.#now += ms
  }
}

const QUOTE = {
  id: 'https://rs.example.test/quotes/1',
  walletAddress: 'https://wallet.example.test/store',
  receiver: 'https://rs.example.test/incoming/1',
  debitAmount: { value: '1000000', assetCode: 'COP', assetScale: 2 },
  receiveAmount: { value: '314', assetCode: 'USD', assetScale: 2 },
  method: 'ilp' as const,
  expiresAt: '2026-10-17T00:05:00.000Z',
  createdAt: '2026-10-17T00:00:00.000Z',
}

function approved(value: string, expiresIn?: number) {
  return {
    access_token: {
      value,
      manage: `https://auth.example.test/token/${value}`,
      access: [],
      ...(expiresIn === undefined ? {} : { expires_in: expiresIn }),
    },
    continue: {
      uri: 'https://auth.example.test/continue',
      access_token: { value: 'continue' },
    },
  }
}

function session(overrides: Partial<WalletSession> & Pick<WalletSession, 'client'>): WalletSession {
  return {
    walletAddressUrl: 'https://wallet.example.test/store',
    id: 'https://wallet.example.test/store',
    authServer: 'https://auth.example.test/store',
    resourceServer: 'https://rs.example.test/store',
    assetCode: 'COP',
    assetScale: 2,
    ...overrides,
  }
}

function client(value: object): AuthenticatedClient {
  return value as unknown as AuthenticatedClient
}

const debit = money(1_000_000n, 'COP', 2)
const quoteInput = {
  incomingPaymentUrl: 'https://rs.example.test/incoming/1',
  debit,
}

describe('createPaymentsNetwork', () => {
  it('maps quote amounts at the wallet scales and reuses the quote grant', async () => {
    const request = vi.fn(() => Promise.resolve(approved('quote-token', 300)))
    const create = vi.fn(() => Promise.resolve(QUOTE))
    const store = session({ client: client({ grant: { request }, quote: { create } }) })
    const operator = session({
      id: 'https://wallet.example.test/operator',
      assetCode: 'USD',
      assetScale: 2,
      client: client({}),
    })
    const network = createPaymentsNetwork({ store, operator })

    const first = await network.createQuote(quoteInput)
    const second = await network.createQuote(quoteInput)

    expect(first.debit).toEqual(money(1_000_000n, 'COP', 2))
    expect(first.debit.assetScale).toBe(store.assetScale)
    expect(first.receive).toEqual(money(314n, 'USD', 2))
    expect(first.receive.assetScale).toBe(operator.assetScale)
    expect(first.expiresAt.toISOString()).toBe('2026-10-17T00:05:00.000Z')
    expect(second.id).toBe(first.id)
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith(
      { url: store.authServer },
      { access_token: { access: [{ type: 'quote', actions: ['create', 'read'] }] } },
    )
    expect(create).toHaveBeenCalledTimes(2)
    expect(create).toHaveBeenCalledWith(
      { url: store.resourceServer, accessToken: 'quote-token' },
      {
        method: 'ilp',
        walletAddress: store.id,
        receiver: quoteInput.incomingPaymentUrl,
        debitAmount: { value: '1000000', assetCode: 'COP', assetScale: 2 },
      },
    )
  })

  it('keeps the quote grant until shortly before expires_in, then requests another', async () => {
    const clock = new ManualClock('2026-10-17T00:00:00.000Z')
    const request = vi.fn(() =>
      Promise.resolve(approved(`q-${request.mock.calls.length.toString()}`, 120)),
    )
    const create = vi.fn(() => Promise.resolve(QUOTE))
    const network = createPaymentsNetwork(
      {
        store: session({ client: client({ grant: { request }, quote: { create } }) }),
        operator: session({ client: client({}) }),
      },
      clock,
    )

    await network.createQuote(quoteInput)
    clock.advance(89_000)
    await network.createQuote(quoteInput)
    expect(request).toHaveBeenCalledTimes(1)
    clock.advance(1_000)
    await network.createQuote(quoteInput)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('caches a grant without expires_in for five minutes', async () => {
    const clock = new ManualClock('2026-10-17T00:00:00.000Z')
    const request = vi.fn(() => Promise.resolve(approved('quote-token')))
    const create = vi.fn(() => Promise.resolve(QUOTE))
    const network = createPaymentsNetwork(
      {
        store: session({ client: client({ grant: { request }, quote: { create } }) }),
        operator: session({ client: client({}) }),
      },
      clock,
    )

    await network.createQuote(quoteInput)
    clock.advance(269_000)
    await network.createQuote(quoteInput)
    expect(request).toHaveBeenCalledTimes(1)
    clock.advance(1_000)
    await network.createQuote(quoteInput)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('shares one in-flight quote grant across concurrent quotes', async () => {
    const gate = Promise.withResolvers<boolean>()
    let started = 0
    const request = vi.fn(() => {
      started += 1
      return gate.promise.then(() => approved('shared', 300))
    })
    const create = vi.fn(() => Promise.resolve(QUOTE))
    const network = createPaymentsNetwork({
      store: session({ client: client({ grant: { request }, quote: { create } }) }),
      operator: session({ client: client({}) }),
    })

    const first = network.createQuote(quoteInput)
    const second = network.createQuote(quoteInput)
    expect(started).toBe(1)
    gate.resolve(true)
    const [left, right] = await Promise.all([first, second])
    expect(left.id).toBe(right.id)
    expect(started).toBe(1)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('shares one replacement grant when concurrent quotes receive 401', async () => {
    let grants = 0
    const request = vi.fn(() => {
      grants += 1
      return Promise.resolve(approved(grants === 1 ? 'stale' : 'fresh', 300))
    })
    const create = vi.fn(({ accessToken }: { accessToken: string }) => {
      if (accessToken === 'stale') {
        return Promise.reject(unauthorized())
      }
      return Promise.resolve(QUOTE)
    })
    const network = createPaymentsNetwork({
      store: session({ client: client({ grant: { request }, quote: { create } }) }),
      operator: session({ client: client({}) }),
    })

    const [left, right] = await Promise.all([
      network.createQuote(quoteInput),
      network.createQuote(quoteInput),
    ])
    expect(left.receive.amount).toBe(314n)
    expect(right.receive.amount).toBe(314n)
    expect(grants).toBe(2)
  })

  it('refreshes the quote grant once after a 401 and does not retry a second 401', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(approved('stale', 300))
      .mockResolvedValueOnce(approved('fresh', 300))
    const create = vi.fn(({ accessToken }: { accessToken: string }) => {
      if (accessToken === 'stale') return Promise.reject(unauthorized())
      return Promise.resolve(QUOTE)
    })
    const network = createPaymentsNetwork({
      store: session({ client: client({ grant: { request }, quote: { create } }) }),
      operator: session({ client: client({}) }),
    })

    const quote = await network.createQuote(quoteInput)
    expect(quote.receive).toEqual(money(314n, 'USD', 2))
    expect(request).toHaveBeenCalledTimes(2)
    expect(create).toHaveBeenCalledTimes(2)

    create.mockRejectedValue(unauthorized())
    request.mockResolvedValue(approved('again', 300))
    await expect(network.createQuote(quoteInput)).rejects.toMatchObject({
      kind: 'unauthorized',
      retryable: false,
      detail: 'expired token',
    })
    expect(request).toHaveBeenCalledTimes(3)
    expect(create).toHaveBeenCalledTimes(4)
  })

  it('does not refresh the grant on 403', async () => {
    const request = vi.fn(() => Promise.resolve(approved('quote-token', 300)))
    const create = vi.fn(() =>
      Promise.reject(
        new OpenPaymentsClientError('request failed', { description: 'forbidden', status: 403 }),
      ),
    )
    const network = createPaymentsNetwork({
      store: session({ client: client({ grant: { request }, quote: { create } }) }),
      operator: session({ client: client({}) }),
    })
    await expect(network.createQuote(quoteInput)).rejects.toMatchObject({
      kind: 'unauthorized',
      retryable: false,
    })
    expect(request).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('maps quote failures without requesting another grant', async () => {
    const request = vi.fn(() => Promise.resolve(approved('quote-token', 300)))
    const create = vi.fn(() =>
      Promise.reject(
        new OpenPaymentsClientError('request failed', {
          description: 'non-positive receive amount',
          status: 400,
        }),
      ),
    )
    const network = createPaymentsNetwork({
      store: session({ client: client({ grant: { request }, quote: { create } }) }),
      operator: session({ client: client({}) }),
    })
    await expect(network.createQuote(quoteInput)).rejects.toMatchObject({
      kind: 'rejected',
      retryable: false,
      detail: 'non-positive receive amount',
    })

    create.mockRejectedValue(
      new OpenPaymentsClientError('request failed', { description: 'down', status: 503 }),
    )
    await expect(network.createQuote(quoteInput)).rejects.toMatchObject({
      kind: 'unavailable',
      retryable: true,
    })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('rejects a debit the store wallet cannot spend before requesting a grant', async () => {
    const request = vi.fn()
    const network = createPaymentsNetwork({
      store: session({ client: client({ grant: { request } }) }),
      operator: session({ client: client({}) }),
    })
    await expect(
      network.createQuote({ ...quoteInput, debit: money(1n, 'USD', 2) }),
    ).rejects.toMatchObject({ kind: 'rejected', retryable: false })
    expect(request).not.toHaveBeenCalled()
  })

  it('creates, reads, and completes an incoming payment with one grant', async () => {
    const request = vi.fn(() => Promise.resolve(approved('in-token', 300)))
    const create = vi.fn(() =>
      Promise.resolve({
        id: 'https://rs.example.test/incoming/1',
        expiresAt: '2026-11-16T00:00:00.000Z',
      }),
    )
    const get = vi.fn(() =>
      Promise.resolve({
        receivedAmount: { value: '314', assetCode: 'USD', assetScale: 2 },
        completed: false,
      }),
    )
    const complete = vi.fn(() => Promise.resolve())
    const operator = session({
      id: 'https://wallet.example.test/operator',
      walletAddressUrl: 'https://wallet.example.test/operator',
      authServer: 'https://auth.example.test/operator',
      resourceServer: 'https://rs.example.test/operator',
      assetCode: 'USD',
      assetScale: 2,
      client: client({
        grant: { request },
        incomingPayment: { create, get, complete },
      }),
    })
    const network = createPaymentsNetwork({
      store: session({ client: client({}) }),
      operator,
    })

    const created = await network.createIncomingPayment({ description: 'cash in' })
    const seen = await network.getIncomingPayment(created.url)
    await network.completeIncomingPayment(created.url)

    expect(created).toEqual({
      url: 'https://rs.example.test/incoming/1',
      expiresAt: new Date('2026-11-16T00:00:00.000Z'),
    })
    expect(seen.received).toEqual(money(314n, 'USD', 2))
    expect(seen.received.assetScale).toBe(operator.assetScale)
    expect(seen.completed).toBe(false)
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith(
      { url: operator.authServer },
      {
        access_token: {
          access: [{ type: 'incoming-payment', actions: ['create', 'read', 'complete'] }],
        },
      },
    )
    expect(create).toHaveBeenCalledWith(
      { url: operator.resourceServer, accessToken: 'in-token' },
      { walletAddress: operator.id, metadata: { description: 'cash in' } },
    )
    expect(get).toHaveBeenCalledWith({ url: created.url, accessToken: 'in-token' })
    expect(complete).toHaveBeenCalledWith({ url: created.url, accessToken: 'in-token' })
  })

  it('creates and reads an outgoing payment with the caller token', async () => {
    const request = vi.fn()
    const create = vi.fn(() => Promise.resolve({ id: 'https://rs.example.test/outgoing/1' }))
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'https://rs.example.test/outgoing/1',
        failed: false,
        sentAmount: { value: '0', assetCode: 'COP', assetScale: 2 },
        debitAmount: { value: '1000000', assetCode: 'COP', assetScale: 2 },
      })
      .mockResolvedValueOnce({
        id: 'https://rs.example.test/outgoing/1',
        failed: false,
        sentAmount: { value: '1000000', assetCode: 'COP', assetScale: 2 },
        debitAmount: { value: '1000000', assetCode: 'COP', assetScale: 2 },
      })
      .mockResolvedValueOnce({
        id: 'https://rs.example.test/outgoing/1',
        failed: true,
        sentAmount: { value: '1000000', assetCode: 'COP', assetScale: 2 },
        debitAmount: { value: '1000000', assetCode: 'COP', assetScale: 2 },
      })
    const store = session({
      client: client({ grant: { request }, outgoingPayment: { create, get } }),
    })
    const network = createPaymentsNetwork({ store, operator: session({ client: client({}) }) })

    const created = await network.createOutgoingPayment({
      quoteId: 'https://rs.example.test/quotes/1',
      accessToken: 'user-token',
      description: 'till',
    })
    const pending = await network.getOutgoingPayment(created.id, 'user-token')
    const paid = await network.getOutgoingPayment(created.id, 'user-token')
    const failed = await network.getOutgoingPayment(created.id, 'user-token')

    expect(created.id).toBe('https://rs.example.test/outgoing/1')
    expect(pending).toEqual({
      id: created.id,
      status: 'pending',
      sent: money(0n, 'COP', 2),
      debit: money(1_000_000n, 'COP', 2),
    })
    expect(paid.status).toBe('paid')
    expect(paid.sent.assetScale).toBe(store.assetScale)
    expect(failed.status).toBe('failed')
    expect(request).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledWith(
      { url: store.resourceServer, accessToken: 'user-token' },
      {
        walletAddress: store.id,
        quoteId: 'https://rs.example.test/quotes/1',
        metadata: { description: 'till' },
      },
    )
  })

  it('maps an outgoing 401 without requesting a grant', async () => {
    const request = vi.fn()
    const create = vi.fn(() => Promise.reject(unauthorized()))
    const network = createPaymentsNetwork({
      store: session({ client: client({ grant: { request }, outgoingPayment: { create } }) }),
      operator: session({ client: client({}) }),
    })
    await expect(
      network.createOutgoingPayment({ quoteId: 'quote', accessToken: 'user-token' }),
    ).rejects.toMatchObject({ kind: 'unauthorized', retryable: false })
    expect(request).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('maps a missing quote expiry as unavailable', async () => {
    const withoutExpiry = {
      id: QUOTE.id,
      walletAddress: QUOTE.walletAddress,
      receiver: QUOTE.receiver,
      debitAmount: QUOTE.debitAmount,
      receiveAmount: QUOTE.receiveAmount,
      method: QUOTE.method,
      createdAt: QUOTE.createdAt,
    }
    const network = createPaymentsNetwork({
      store: session({
        client: client({
          grant: { request: vi.fn(() => Promise.resolve(approved('quote-token', 300))) },
          quote: { create: vi.fn(() => Promise.resolve(withoutExpiry)) },
        }),
      }),
      operator: session({ client: client({}) }),
    })
    await expect(network.createQuote(quoteInput)).rejects.toMatchObject({
      kind: 'unavailable',
      retryable: true,
      detail: 'quote has no expiry',
    })
  })

  it('maps a non-integer amount as unavailable', async () => {
    const network = createPaymentsNetwork({
      store: session({
        client: client({
          grant: { request: vi.fn(() => Promise.resolve(approved('quote-token', 300))) },
          quote: {
            create: vi.fn(() =>
              Promise.resolve({
                ...QUOTE,
                debitAmount: { value: '12.5', assetCode: 'COP', assetScale: 2 },
              }),
            ),
          },
        }),
      }),
      operator: session({ client: client({}) }),
    })
    await expect(network.createQuote(quoteInput)).rejects.toMatchObject({
      kind: 'unavailable',
      retryable: true,
      detail: 'amount value was not an integer',
    })
  })

  it('treats an unapproved quote grant as retryable', async () => {
    const request = vi.fn(() =>
      Promise.resolve({
        continue: { uri: 'https://auth.example.test/continue', access_token: { value: 'c' } },
      }),
    )
    const network = createPaymentsNetwork({
      store: session({ client: client({ grant: { request } }) }),
      operator: session({ client: client({}) }),
    })
    await expect(network.createQuote(quoteInput)).rejects.toMatchObject({
      kind: 'unavailable',
      retryable: true,
      detail: 'quote grant was not approved',
    })
  })

  it('finds an outgoing payment by quote, newest page first, and stops at 200', async () => {
    const wallet = session({ client: client({}) })
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        result: [{ id: 'https://rs.example.test/outgoing/new', quoteId: 'other' }],
        pagination: {
          hasNextPage: true,
          hasPreviousPage: false,
          endCursor: 'cursor-1',
          startCursor: 'start-1',
        },
      })
      .mockResolvedValueOnce({
        result: [{ id: 'https://rs.example.test/outgoing/match', quoteId: QUOTE.id }],
        pagination: {
          hasNextPage: true,
          hasPreviousPage: true,
          endCursor: 'cursor-2',
          startCursor: 'start-2',
        },
      })
    const network = createPaymentsNetwork({
      store: session({ client: client({ outgoingPayment: { list } }) }),
      operator: session({ client: client({}) }),
    })
    const found = await network.findOutgoingPaymentByQuote({
      quoteId: QUOTE.id,
      accessToken: 'user-token',
    })
    expect(found).toEqual({ id: 'https://rs.example.test/outgoing/match' })
    expect(list).toHaveBeenNthCalledWith(
      1,
      {
        url: wallet.resourceServer,
        walletAddress: wallet.id,
        accessToken: 'user-token',
      },
      { first: 100, 'wallet-address': wallet.id },
    )
    expect(list).toHaveBeenNthCalledWith(
      2,
      {
        url: wallet.resourceServer,
        walletAddress: wallet.id,
        accessToken: 'user-token',
      },
      { first: 100, cursor: 'cursor-1', 'wallet-address': wallet.id },
    )

    let calls = 0
    const capped = vi.fn(() => {
      calls += 1
      const start = (calls - 1) * 100
      return Promise.resolve({
        result: Array.from({ length: 100 }, (_item, index) => ({
          id: `https://rs.example.test/outgoing/${(start + index).toString()}`,
          quoteId: 'unrelated',
        })),
        pagination: {
          hasNextPage: true,
          hasPreviousPage: calls > 1,
          endCursor: `end-${calls.toString()}`,
          startCursor: `start-${calls.toString()}`,
        },
      })
    })
    const limited = createPaymentsNetwork({
      store: session({ client: client({ outgoingPayment: { list: capped } }) }),
      operator: session({ client: client({}) }),
    })
    await expect(
      limited.findOutgoingPaymentByQuote({ quoteId: QUOTE.id, accessToken: 'user-token' }),
    ).rejects.toMatchObject({
      kind: 'unavailable',
      detail: 'outgoing payment list exceeded the scan cap',
    })
    expect(capped).toHaveBeenCalledTimes(2)
  })
})

function unauthorized(): OpenPaymentsClientError {
  return new OpenPaymentsClientError('request failed', {
    description: 'expired token',
    status: 401,
  })
}
