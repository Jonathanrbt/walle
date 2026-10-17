import { isFinalizedGrantWithAccessToken } from '@interledger/open-payments'

import {
  PaymentsNetworkError,
  type OutgoingPaymentStatus,
  type PaymentsNetwork,
} from '../../cash-in/payments-network.ts'
import type { Money } from '../../shared/money.ts'
import type { Clock } from '../../shared/ports.ts'
import { fromSdkAmount, toSdkAmount } from './amount.ts'
import type { WalletSession } from './clients.ts'
import { attempt } from './map-error.ts'

const systemClock: Clock = { now: () => new Date() }

/** Used when the auth server omits `expires_in`. */
const DEFAULT_GRANT_TTL_MS = 5 * 60 * 1000

/**
 * Stop reusing a token this long before it expires. The client request timeout
 * is 20s, so a token inside this window can lapse while a call is in flight.
 */
const GRANT_REFRESH_MARGIN_MS = 30_000

interface GrantValue {
  readonly value: string
  readonly expiresIn: number | undefined
}

interface StoredToken {
  readonly value: string
  readonly expiresAtMs: number
}

class GrantTokenCache {
  readonly #clock: Clock
  readonly #tokens = new Map<string, StoredToken>()
  readonly #inflight = new Map<string, Promise<StoredToken>>()

  constructor(clock: Clock) {
    this.#clock = clock
  }

  async token(key: string, load: () => Promise<GrantValue>): Promise<string> {
    const cached = this.#usable(key)
    if (cached !== undefined) return cached

    const pending = this.#inflight.get(key)
    if (pending !== undefined) {
      const token = await pending
      if (this.#fresh(token)) return token.value
    }
    const raced = this.#inflight.get(key)
    if (raced !== undefined) return (await raced).value

    const flight = this.#load(load)
    this.#inflight.set(key, flight)
    try {
      const token = await flight
      this.#tokens.set(key, token)
      return token.value
    } finally {
      if (this.#inflight.get(key) === flight) this.#inflight.delete(key)
    }
  }

  invalidate(key: string): void {
    this.#tokens.delete(key)
  }

  #usable(key: string): string | undefined {
    const token = this.#tokens.get(key)
    if (token !== undefined && this.#fresh(token)) return token.value
    return undefined
  }

  #fresh(token: StoredToken): boolean {
    return token.expiresAtMs - this.#clock.now().getTime() > GRANT_REFRESH_MARGIN_MS
  }

  async #load(load: () => Promise<GrantValue>): Promise<StoredToken> {
    const grant = await load()
    const ttlMs = grant.expiresIn === undefined ? DEFAULT_GRANT_TTL_MS : grant.expiresIn * 1000
    if (!Number.isFinite(ttlMs) || ttlMs < 0) {
      throw new PaymentsNetworkError('unavailable', 'grant expiry was not a duration')
    }
    return { value: grant.value, expiresAtMs: this.#clock.now().getTime() + ttlMs }
  }
}

export function createPaymentsNetwork(
  wallets: {
    readonly store: WalletSession
    readonly operator: WalletSession
  },
  clock: Clock = systemClock,
): PaymentsNetwork {
  const cache = new GrantTokenCache(clock)
  return {
    createIncomingPayment(input) {
      return createIncomingPayment(cache, wallets.operator, input.description)
    },
    createQuote(input) {
      return createQuote(cache, wallets.store, input.incomingPaymentUrl, input.debit)
    },
    createOutgoingPayment(input) {
      return createOutgoingPayment(wallets.store, input)
    },
    getOutgoingPayment(id, accessToken) {
      return getOutgoingPayment(wallets.store, id, accessToken)
    },
    getIncomingPayment(url) {
      return getIncomingPayment(cache, wallets.operator, url)
    },
    completeIncomingPayment(url) {
      return completeIncomingPayment(cache, wallets.operator, url)
    },
  }
}

async function createIncomingPayment(
  cache: GrantTokenCache,
  operator: WalletSession,
  description: string | undefined,
): Promise<{ url: string; expiresAt: Date }> {
  return attempt(() =>
    withToken(
      cache,
      grantKey('incoming', operator),
      () => incomingGrant(operator),
      async (accessToken) => {
        const created = await operator.client.incomingPayment.create(
          { url: operator.resourceServer, accessToken },
          {
            walletAddress: operator.id,
            ...(description === undefined ? {} : { metadata: { description } }),
          },
        )
        return {
          url: created.id,
          expiresAt: requireDate(created.expiresAt, 'incoming payment has no expiry'),
        }
      },
    ),
  )
}

async function createQuote(
  cache: GrantTokenCache,
  store: WalletSession,
  incomingPaymentUrl: string,
  debit: Money,
): Promise<{ id: string; debit: Money; receive: Money; expiresAt: Date }> {
  return attempt(async () => {
    requireWalletAsset(debit, store, 'debit asset does not match the store wallet')
    return withToken(
      cache,
      grantKey('quote', store),
      () => quoteGrant(store),
      async (accessToken) => {
        const quote = await store.client.quote.create(
          { url: store.resourceServer, accessToken },
          {
            method: 'ilp',
            walletAddress: store.id,
            receiver: incomingPaymentUrl,
            debitAmount: toSdkAmount(debit),
          },
        )
        return {
          id: quote.id,
          debit: fromSdkAmount(quote.debitAmount),
          receive: fromSdkAmount(quote.receiveAmount),
          expiresAt: requireDate(quote.expiresAt, 'quote has no expiry'),
        }
      },
    )
  })
}

async function createOutgoingPayment(
  store: WalletSession,
  input: { quoteId: string; accessToken: string; description?: string },
): Promise<{ id: string }> {
  return attempt(async () => {
    const created = await store.client.outgoingPayment.create(
      { url: store.resourceServer, accessToken: input.accessToken },
      {
        walletAddress: store.id,
        quoteId: input.quoteId,
        ...(input.description === undefined
          ? {}
          : { metadata: { description: input.description } }),
      },
    )
    return { id: created.id }
  })
}

async function getOutgoingPayment(
  store: WalletSession,
  id: string,
  accessToken: string,
): Promise<{ id: string; status: OutgoingPaymentStatus; sent: Money; debit: Money }> {
  return attempt(async () => {
    const payment = await store.client.outgoingPayment.get({ url: id, accessToken })
    const sent = fromSdkAmount(payment.sentAmount)
    const debit = fromSdkAmount(payment.debitAmount)
    return { id: payment.id, status: outgoingStatus(payment.failed, sent, debit), sent, debit }
  })
}

async function getIncomingPayment(
  cache: GrantTokenCache,
  operator: WalletSession,
  url: string,
): Promise<{ received: Money; completed: boolean }> {
  return attempt(() =>
    withToken(
      cache,
      grantKey('incoming', operator),
      () => incomingGrant(operator),
      async (accessToken) => {
        const payment = await operator.client.incomingPayment.get({ url, accessToken })
        return { received: fromSdkAmount(payment.receivedAmount), completed: payment.completed }
      },
    ),
  )
}

async function completeIncomingPayment(
  cache: GrantTokenCache,
  operator: WalletSession,
  url: string,
): Promise<void> {
  await attempt(() =>
    withToken(
      cache,
      grantKey('incoming', operator),
      () => incomingGrant(operator),
      async (accessToken) => {
        await operator.client.incomingPayment.complete({ url, accessToken })
      },
    ),
  )
}

async function withToken<T>(
  cache: GrantTokenCache,
  key: string,
  load: () => Promise<GrantValue>,
  use: (accessToken: string) => Promise<T>,
): Promise<T> {
  try {
    return await use(await cache.token(key, load))
  } catch (error) {
    if (responseStatus(error) !== 401) throw error
    cache.invalidate(key)
    return use(await cache.token(key, load))
  }
}

async function incomingGrant(session: WalletSession): Promise<GrantValue> {
  return nonInteractiveGrant(
    session,
    { type: 'incoming-payment', actions: ['create', 'read', 'complete'] },
    'incoming-payment grant was not approved',
  )
}

async function quoteGrant(session: WalletSession): Promise<GrantValue> {
  return nonInteractiveGrant(
    session,
    { type: 'quote', actions: ['create', 'read'] },
    'quote grant was not approved',
  )
}

async function nonInteractiveGrant(
  session: WalletSession,
  access:
    | { type: 'incoming-payment'; actions: ['create', 'read', 'complete'] }
    | { type: 'quote'; actions: ['create', 'read'] },
  detail: string,
): Promise<GrantValue> {
  const grant = await session.client.grant.request(
    { url: session.authServer },
    { access_token: { access: [access] } },
  )
  if (!isFinalizedGrantWithAccessToken(grant)) {
    throw new PaymentsNetworkError('unavailable', detail)
  }
  return { value: grant.access_token.value, expiresIn: grant.access_token.expires_in }
}

function grantKey(kind: 'incoming' | 'quote', session: WalletSession): string {
  return `${kind}:${session.id}`
}

function requireWalletAsset(
  value: { assetCode: string; assetScale: number },
  session: WalletSession,
  detail: string,
): void {
  if (value.assetCode !== session.assetCode || value.assetScale !== session.assetScale) {
    throw new PaymentsNetworkError('rejected', detail)
  }
}

function requireDate(value: string | undefined, detail: string): Date {
  if (value === undefined) throw new PaymentsNetworkError('unavailable', detail)
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new PaymentsNetworkError('unavailable', detail)
  return parsed
}

function outgoingStatus(
  failed: boolean,
  sent: { amount: bigint; assetCode: string; assetScale: number },
  debit: { amount: bigint; assetCode: string; assetScale: number },
): OutgoingPaymentStatus {
  if (failed) return 'failed'
  const paid =
    sent.assetCode === debit.assetCode &&
    sent.assetScale === debit.assetScale &&
    sent.amount === debit.amount
  return paid ? 'paid' : 'pending'
}

function responseStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined
  const { status } = error
  return typeof status === 'number' && Number.isInteger(status) ? status : undefined
}
