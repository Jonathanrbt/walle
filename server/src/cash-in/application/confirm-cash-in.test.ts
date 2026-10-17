import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { ManualClock } from '../../../test/fakes/fake-grant-gateway.ts'
import { FakeGrantGateway } from '../../../test/fakes/fake-grant-gateway.ts'
import { FakePaymentsNetwork } from '../../../test/fakes/fake-payments-network.ts'
import { createMemoryCashInRepository } from '../../../test/fakes/memory-cash-in-repository.ts'
import { createMemoryStoreGrantRepository } from '../../../test/fakes/memory-store-grant-repository.ts'
import { money, type Money } from '../../shared/money.ts'
import { Mutex } from '../../shared/mutex.ts'
import { StoreGrantError } from '../../store-grant/application/errors.ts'
import { StoreGrantService } from '../../store-grant/application/store-grant-service.ts'
import type { StoreGrantRepository } from '../../store-grant/repository.ts'
import { createQuoted, type CashIn, type CashInStatus } from '../domain/cash-in.ts'
import { transition, type CashInEvent } from '../domain/transitions.ts'
import { PaymentsNetworkError, type PaymentsNetwork } from '../payments-network.ts'
import type { CashInRepository } from '../repository.ts'
import { ConfirmCashIn } from './confirm-cash-in.ts'
import { CashInError } from './errors.ts'

const NOW = new Date('2026-10-17T12:00:00.000Z')
const COP = money(10_000n, 'COP', 2)
const USDC = money(100n, 'USDC', 2)
const RATE = money(10_000n, 'COP', 2)

function finishHash(input: {
  readonly nonce: string
  readonly interactNonce: string
  readonly interactRef: string
  readonly grantEndpoint: string
}): string {
  return createHash('sha256')
    .update([input.nonce, input.interactNonce, input.interactRef, input.grantEndpoint].join('\n'))
    .digest('base64')
}

async function activate(grants: StoreGrantRepository, service: StoreGrantService): Promise<void> {
  await service.start()
  const pending = await grants.get()
  if (pending === undefined) throw new Error('grant was not stored')
  const interactRef = 'ref-1'
  const hash = finishHash({
    nonce: pending.nonce,
    interactNonce: pending.interactNonce,
    interactRef,
    grantEndpoint: pending.grantEndpoint,
  })
  await service.finish({ hash, interactRef })
}

function harness(options?: { readonly limit?: string }) {
  const clock = new ManualClock(NOW)
  const repo = createMemoryCashInRepository()
  const payments = new FakePaymentsNetwork({ rate: RATE, clock })
  let outgoingCalls = 0
  let seenDuringCreate: CashIn | undefined
  let boom: Error | undefined
  const network: PaymentsNetwork = {
    createIncomingPayment: (input) => payments.createIncomingPayment(input),
    createQuote: (input) => payments.createQuote(input),
    createOutgoingPayment: async (input) => {
      outgoingCalls += 1
      seenDuringCreate = await repo.get('cash-1')
      if (boom !== undefined) throw boom
      return payments.createOutgoingPayment(input)
    },
    getOutgoingPayment: (id, accessToken) => payments.getOutgoingPayment(id, accessToken),
    getIncomingPayment: (url) => payments.getIncomingPayment(url),
    completeIncomingPayment: (url) => payments.completeIncomingPayment(url),
  }
  const grants = createMemoryStoreGrantRepository(repo)
  let sequence = 0
  const storeGrant = new StoreGrantService({
    grants,
    gateway: new FakeGrantGateway(clock, 120_000),
    clock,
    ids: { next: () => `nonce-${String(++sequence)}` },
    mutex: new Mutex(),
    dailyGrantLimitCop: options?.limit ?? '1000000.00',
    publicBaseUrl: 'http://localhost:3000',
  })
  const service = new ConfirmCashIn({
    cashIns: repo,
    payments: network,
    storeGrant,
    clock,
    mutex: new Mutex(),
  })
  return {
    clock,
    repo,
    payments,
    storeGrant,
    grants,
    service,
    outgoingCalls: () => outgoingCalls,
    seenDuringCreate: () => seenDuringCreate,
    failOutgoingWith(error: Error) {
      boom = error
    },
  }
}

async function ready(
  subject: ReturnType<typeof harness>,
  cop: Money = COP,
  grant = true,
): Promise<CashIn> {
  if (grant && (await subject.grants.get()) === undefined) {
    await activate(subject.grants, subject.storeGrant)
  }
  const incoming = await subject.payments.createIncomingPayment({})
  const quote = await subject.payments.createQuote({ incomingPaymentUrl: incoming.url, debit: cop })
  const cashIn = createQuoted(
    {
      id: 'cash-1',
      cop,
      usdc: USDC,
      copPerUsdc: RATE,
      expiresAt: new Date(NOW.getTime() + 60_000),
      stellarAddress: `G${'A'.repeat(55)}`,
      customer: { phone: '3001112233', fullName: 'Ada Lovelace', documentNumber: '12345678' },
      incomingPaymentUrl: incoming.url,
      quoteId: quote.id,
    },
    subject.clock,
  )
  await subject.repo.insert(cashIn)
  return cashIn
}

async function apply(repo: CashInRepository, current: CashIn, event: CashInEvent, at: Date) {
  const next = transition(current, event, at)
  await repo.save(next, current.version)
  return next
}

describe('ConfirmCashIn', () => {
  it('confirms a quote and stores one outgoing payment', async () => {
    const subject = harness()
    const quoted = await ready(subject)
    const confirmed = await subject.service.confirm(quoted.id)
    expect(confirmed.status).toBe('settling')
    expect(confirmed.openPayments.outgoingPaymentId).toMatch(
      /^https:\/\/payments\.invalid\/outgoing-payments\//,
    )
    expect(confirmed.version).toBe(quoted.version + 2)
    expect(subject.outgoingCalls()).toBe(1)
    expect(await subject.repo.get(quoted.id)).toEqual(confirmed)
  })

  it('creates one outgoing payment when confirm runs twice in sequence', async () => {
    const subject = harness()
    const quoted = await ready(subject)
    const first = await subject.service.confirm(quoted.id)
    const second = await subject.service.confirm(quoted.id)
    expect(second).toEqual(first)
    expect(subject.outgoingCalls()).toBe(1)
  })

  it('creates one outgoing payment when confirm runs twice at once', async () => {
    const subject = harness()
    const quoted = await ready(subject)
    const [first, second] = await Promise.all([
      subject.service.confirm(quoted.id),
      subject.service.confirm(quoted.id),
    ])
    expect(first.openPayments.outgoingPaymentId).toBe(second.openPayments.outgoingPaymentId)
    expect(subject.outgoingCalls()).toBe(1)
    const stored = await subject.repo.get(quoted.id)
    expect(stored?.openPayments.outgoingPaymentId).toBe(first.openPayments.outgoingPaymentId)
  })

  it('expires a due quote and reports quote_expired', async () => {
    const subject = harness()
    const quoted = await ready(subject)
    subject.clock.advance(60_000)
    await expect(subject.service.confirm(quoted.id)).rejects.toMatchObject({
      name: 'CashInError',
      code: 'quote_expired',
    })
    expect((await subject.repo.get(quoted.id))?.status).toBe('expired')
    expect(subject.outgoingCalls()).toBe(0)
  })

  it('leaves the cash-in quoted when there is no grant', async () => {
    const subject = harness()
    const quoted = await ready(subject, COP, false)
    await expect(subject.service.confirm(quoted.id)).rejects.toBeInstanceOf(StoreGrantError)
    await expect(subject.service.confirm(quoted.id)).rejects.toMatchObject({ code: 'no_grant' })
    expect((await subject.repo.get(quoted.id))?.status).toBe('quoted')
    expect(subject.outgoingCalls()).toBe(0)
  })

  it('leaves the cash-in quoted when the grant is exhausted', async () => {
    const subject = harness({ limit: '10.00' })
    const quoted = await ready(subject, money(10_000n, 'COP', 2))
    await expect(subject.service.confirm(quoted.id)).rejects.toMatchObject({
      code: 'grant_exhausted',
    })
    expect((await subject.repo.get(quoted.id))?.status).toBe('quoted')
    expect(subject.outgoingCalls()).toBe(0)
  })

  it('persists the settling claim before the network call', async () => {
    const subject = harness()
    const quoted = await ready(subject)
    await subject.service.confirm(quoted.id)
    expect(subject.seenDuringCreate()?.status).toBe('settling')
    expect(subject.seenDuringCreate()?.openPayments.outgoingPaymentId).toBeUndefined()
    expect(subject.seenDuringCreate()?.version).toBe(quoted.version + 1)
  })

  it('records failed_payment when the network rejects the outgoing payment', async () => {
    const subject = harness()
    const quoted = await ready(subject)
    subject.payments.failOutgoing(new PaymentsNetworkError('rejected', 'grant limit'))
    await expect(subject.service.confirm(quoted.id)).rejects.toMatchObject({
      code: 'invalid_state',
      detail: 'grant limit',
    })
    const stored = await subject.repo.get(quoted.id)
    expect(stored?.status).toBe('failed_payment')
    expect(stored?.failureReason).toBe('grant limit')
    expect(stored?.openPayments.outgoingPaymentId).toBeUndefined()
  })

  it('keeps settling without an id when the network outcome is unknown', async () => {
    const subject = harness()
    const quoted = await ready(subject)
    subject.payments.failOutgoing(new PaymentsNetworkError('unavailable', 'timeout'))
    const result = await subject.service.confirm(quoted.id)
    expect(result.status).toBe('settling')
    expect(result.openPayments.outgoingPaymentId).toBeUndefined()
    expect(await subject.repo.get(quoted.id)).toEqual(result)
  })

  it('keeps settling without an id when the network throws an unknown error', async () => {
    const subject = harness()
    const quoted = await ready(subject)
    subject.failOutgoingWith(new Error('socket hang up'))
    const result = await subject.service.confirm(quoted.id)
    expect(result.status).toBe('settling')
    expect(result.openPayments.outgoingPaymentId).toBeUndefined()
    expect(await subject.repo.get(quoted.id)).toEqual(result)
  })

  it('returns settling, settled, sending, and completed unchanged', async () => {
    const statuses: readonly CashInStatus[] = ['settling', 'settled', 'sending_usdc', 'completed']
    for (const status of statuses) {
      const subject = harness()
      let current = await ready(subject)
      current = await apply(subject.repo, current, { type: 'Confirm' }, NOW)
      if (status === 'settling') {
        const again = await subject.service.confirm(current.id)
        expect(again).toEqual(current)
        expect(subject.outgoingCalls()).toBe(0)
        continue
      }
      current = await apply(
        subject.repo,
        current,
        { type: 'OutgoingCreated', outgoingPaymentId: 'out-1' },
        NOW,
      )
      current = await apply(subject.repo, current, { type: 'IncomingCompleted' }, NOW)
      if (status === 'settled') {
        expect(await subject.service.confirm(current.id)).toEqual(current)
        continue
      }
      current = await apply(
        subject.repo,
        current,
        { type: 'UsdcSendStarted', stellarEnvelopeXdr: 'xdr', stellarTxHash: 'hash' },
        NOW,
      )
      if (status === 'completed') {
        current = await apply(
          subject.repo,
          current,
          { type: 'UsdcSent', stellarTxHash: 'hash' },
          NOW,
        )
      }
      expect(current.status).toBe(status)
      expect(await subject.service.confirm(current.id)).toEqual(current)
      expect(subject.outgoingCalls()).toBe(0)
    }
  })

  it('refuses confirm of a failed or already expired cash-in', async () => {
    const subject = harness()
    let current = await ready(subject)
    current = await apply(subject.repo, current, { type: 'Confirm' }, NOW)
    current = await apply(subject.repo, current, { type: 'PaymentFailed', reason: 'declined' }, NOW)
    await expect(subject.service.confirm(current.id)).rejects.toMatchObject({
      code: 'invalid_state',
    })
    expect((await subject.repo.get(current.id))?.status).toBe('failed_payment')

    const expired = harness()
    const quoted = await ready(expired)
    expired.clock.advance(60_000)
    const stored = transition(quoted, { type: 'Expire' }, expired.clock.now())
    await expired.repo.save(stored, quoted.version)
    await expect(expired.service.confirm(quoted.id)).rejects.toMatchObject({
      code: 'quote_expired',
    })
  })

  it('returns not_found for an unknown cash-in', async () => {
    const subject = harness()
    await expect(subject.service.confirm('missing')).rejects.toBeInstanceOf(CashInError)
    await expect(subject.service.confirm('missing')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('retries only from failed_stellar and keeps the stored envelope', async () => {
    const subject = harness()
    let current = await ready(subject)
    const at = NOW
    current = await apply(subject.repo, current, { type: 'Confirm' }, at)
    current = await apply(
      subject.repo,
      current,
      { type: 'OutgoingCreated', outgoingPaymentId: 'out-1' },
      at,
    )
    current = await apply(subject.repo, current, { type: 'IncomingCompleted' }, at)
    current = await apply(
      subject.repo,
      current,
      { type: 'UsdcSendStarted', stellarEnvelopeXdr: 'xdr-1', stellarTxHash: 'hash-1' },
      at,
    )
    current = await apply(subject.repo, current, { type: 'UsdcFailed', reason: 'horizon' }, at)
    const retried = await subject.service.retry(current.id)
    expect(retried.status).toBe('sending_usdc')
    expect(retried.stellarEnvelopeXdr).toBe('xdr-1')
    expect(retried.stellarTxHash).toBe('hash-1')
    expect(retried.failureReason).toBeUndefined()
    expect(subject.outgoingCalls()).toBe(0)

    await expect(subject.service.retry(current.id)).rejects.toMatchObject({ code: 'invalid_state' })
    const quoted = harness()
    const fresh = await ready(quoted)
    await expect(quoted.service.retry(fresh.id)).rejects.toMatchObject({ code: 'invalid_state' })
    expect((await quoted.repo.get(fresh.id))?.status).toBe('quoted')
  })
})
