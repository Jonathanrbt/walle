import { isFinalizedGrantWithAccessToken } from '@interledger/open-payments'

import {
  PaymentsNetworkError,
  type OutgoingPaymentStatus,
  type PaymentsNetwork,
} from '../../cash-in/payments-network.ts'
import type { Money } from '../../shared/money.ts'
import { fromSdkAmount, toSdkAmount } from './amount.ts'
import type { WalletSession } from './clients.ts'
import { attempt } from './map-error.ts'

export function createPaymentsNetwork(wallets: {
  readonly store: WalletSession
  readonly operator: WalletSession
}): PaymentsNetwork {
  return {
    createIncomingPayment(input) {
      return createIncomingPayment(wallets.operator, input.description)
    },
    createQuote(input) {
      return createQuote(wallets.store, input.incomingPaymentUrl, input.debit)
    },
    createOutgoingPayment(input) {
      return createOutgoingPayment(wallets.store, input)
    },
    getOutgoingPayment(id, accessToken) {
      return getOutgoingPayment(wallets.store, id, accessToken)
    },
    getIncomingPayment(url) {
      return getIncomingPayment(wallets.operator, url)
    },
    completeIncomingPayment(url) {
      return completeIncomingPayment(wallets.operator, url)
    },
  }
}

async function createIncomingPayment(
  operator: WalletSession,
  description: string | undefined,
): Promise<{ url: string; expiresAt: Date }> {
  return attempt(async () => {
    const accessToken = await incomingToken(operator)
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
  })
}

async function createQuote(
  store: WalletSession,
  incomingPaymentUrl: string,
  debit: Money,
): Promise<{ id: string; debit: Money; receive: Money; expiresAt: Date }> {
  return attempt(async () => {
    requireWalletAsset(debit, store, 'debit asset does not match the store wallet')
    const accessToken = await quoteToken(store)
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
  operator: WalletSession,
  url: string,
): Promise<{ received: Money; completed: boolean }> {
  return attempt(async () => {
    const accessToken = await incomingToken(operator)
    const payment = await operator.client.incomingPayment.get({ url, accessToken })
    return { received: fromSdkAmount(payment.receivedAmount), completed: payment.completed }
  })
}

async function completeIncomingPayment(operator: WalletSession, url: string): Promise<void> {
  await attempt(async () => {
    const accessToken = await incomingToken(operator)
    await operator.client.incomingPayment.complete({ url, accessToken })
  })
}

async function incomingToken(session: WalletSession): Promise<string> {
  const grant = await session.client.grant.request(
    { url: session.authServer },
    {
      access_token: {
        access: [{ type: 'incoming-payment', actions: ['create', 'read', 'complete'] }],
      },
    },
  )
  if (!isFinalizedGrantWithAccessToken(grant)) {
    throw new PaymentsNetworkError('unavailable', 'incoming-payment grant was not approved')
  }
  return grant.access_token.value
}

async function quoteToken(session: WalletSession): Promise<string> {
  const grant = await session.client.grant.request(
    { url: session.authServer },
    {
      access_token: {
        access: [{ type: 'quote', actions: ['create', 'read'] }],
      },
    },
  )
  if (!isFinalizedGrantWithAccessToken(grant)) {
    throw new PaymentsNetworkError('unavailable', 'quote grant was not approved')
  }
  return grant.access_token.value
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
