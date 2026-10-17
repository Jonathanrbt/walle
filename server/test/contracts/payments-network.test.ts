import { describe, expect, it } from 'vitest'

import { loadConfig } from '../../src/config.ts'
import { createPaymentsNetwork } from '../../src/adapters/open-payments/payments-network.ts'
import { openWalletSession } from '../../src/adapters/open-payments/clients.ts'
import { money } from '../../src/shared/money.ts'
import { FakePaymentsNetwork } from '../fakes/fake-payments-network.ts'
import { runPaymentsNetworkContract } from './payments-network.contract.ts'

runPaymentsNetworkContract('memory', () => Promise.resolve(new FakePaymentsNetwork()))

describe('fake payments network', () => {
  it('pays an outgoing payment only after the scripted transition', async () => {
    const network = new FakePaymentsNetwork()
    const incoming = await network.createIncomingPayment({})
    const quote = await network.createQuote({
      incomingPaymentUrl: incoming.url,
      debit: money(10_000_000n, 'COP', 2),
    })
    const created = await network.createOutgoingPayment({
      quoteId: quote.id,
      accessToken: 'grant-token',
    })
    const pending = await network.getOutgoingPayment(created.id, 'grant-token')
    expect(pending.status).toBe('pending')
    expect(pending.sent.amount).toBe(0n)

    network.setOutgoingStatus(created.id, 'paid')
    const paid = await network.getOutgoingPayment(created.id, 'grant-token')
    expect(paid.status).toBe('paid')
    expect(paid.sent.amount).toBe(paid.debit.amount)

    network.setOutgoingStatus(created.id, 'failed')
    const failed = await network.getOutgoingPayment(created.id, 'grant-token')
    expect(failed.status).toBe('failed')
  })

  it('injects a single quote failure and a single outgoing failure', async () => {
    const network = new FakePaymentsNetwork()
    const incoming = await network.createIncomingPayment({})
    network.failNextQuote()
    await expect(
      network.createQuote({
        incomingPaymentUrl: incoming.url,
        debit: money(10_000_000n, 'COP', 2),
      }),
    ).rejects.toMatchObject({ kind: 'unavailable' })
    const quote = await network.createQuote({
      incomingPaymentUrl: incoming.url,
      debit: money(10_000_000n, 'COP', 2),
    })

    network.failOutgoing()
    await expect(
      network.createOutgoingPayment({ quoteId: quote.id, accessToken: 'grant-token' }),
    ).rejects.toMatchObject({ kind: 'unavailable' })
    await network.createOutgoingPayment({ quoteId: quote.id, accessToken: 'grant-token' })
  })

  it('rejects only when the quoted receive would be non-positive', async () => {
    const network = new FakePaymentsNetwork({ rate: money(100n, 'COP', 2) })
    const incoming = await network.createIncomingPayment({})
    const quote = await network.createQuote({
      incomingPaymentUrl: incoming.url,
      debit: money(100n, 'COP', 2),
    })
    expect(quote.receive).toEqual(money(100n, 'USD', 2))
  })

  it('completes an incoming payment only when asked', async () => {
    const network = new FakePaymentsNetwork()
    const incoming = await network.createIncomingPayment({})
    network.setReceived(incoming.url, money(3_147n, 'USD', 2))
    await network.completeIncomingPayment(incoming.url)
    const seen = await network.getIncomingPayment(incoming.url)
    expect(seen.completed).toBe(true)
    expect(seen.received.amount).toBe(3_147n)
  })
})

describe.skipIf(process.env.TESTNET !== '1')('interledger testnet', () => {
  runPaymentsNetworkContract('open-payments', async () => {
    const config = loadConfig(process.env)
    const [store, operator] = await Promise.all([
      openWalletSession(config.store),
      openWalletSession(config.operator),
    ])
    return createPaymentsNetwork({ store, operator })
  })
})
