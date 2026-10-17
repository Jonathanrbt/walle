import { describe, expect, it } from 'vitest'

import { ManualClock } from '../../../test/fakes/fake-grant-gateway.ts'
import { FakePaymentsNetwork } from '../../../test/fakes/fake-payments-network.ts'
import { createMemoryCashInRepository } from '../../../test/fakes/memory-cash-in-repository.ts'
import type { MemoryCashInRepository } from '../../../test/fakes/memory-cash-in-repository.ts'
import { DomainError } from '../../shared/errors.ts'
import { money } from '../../shared/money.ts'
import { StoreGrantError } from '../../store-grant/application/errors.ts'
import type { StoreGrantService } from '../../store-grant/application/store-grant-service.ts'
import {
  StellarError,
  type LookupResult,
  type PreparedTransfer,
  type SubmitOutcome,
  type UsdcNetwork,
} from '../../treasury/usdc-network.ts'
import { createQuoted, type CashIn } from '../domain/cash-in.ts'
import { transition, type CashInEvent } from '../domain/transitions.ts'
import { PaymentsNetworkError, type PaymentsNetwork } from '../payments-network.ts'
import type { CashInRepository } from '../repository.ts'
import { SettlementProcessor, type Logger, type Scheduler } from './settlement-processor.ts'

const NOW = new Date('2026-10-17T12:00:00.000Z')
const COP = money(10_000n, 'COP', 2)
const USDC = money(100n, 'USDC', 2)
const RATE = money(10_000n, 'COP', 2)
const ADDRESS = `G${'A'.repeat(55)}`

class ManualScheduler implements Scheduler {
  readonly #timers = new Map<number, () => void>()
  #next = 0

  setTimeout(callback: () => void): unknown {
    const id = ++this.#next
    this.#timers.set(id, callback)
    return id
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === 'number') this.#timers.delete(handle)
  }

  pending(): number {
    return this.#timers.size
  }

  fireNext(): void {
    const id = [...this.#timers.keys()][0]
    if (id === undefined) return
    const callback = this.#timers.get(id)
    this.#timers.delete(id)
    callback?.()
  }
}

class ScriptedUsdc implements UsdcNetwork {
  readyError: StellarError | undefined
  lookupResult: LookupResult = { kind: 'not_found' }
  submitResult: SubmitOutcome = { kind: 'success', ledger: 1 }
  dead = false
  prepares = 0
  submits = 0
  readyCalls = 0

  ensureOperatorReady(): Promise<void> {
    this.readyCalls += 1
    if (this.readyError !== undefined) return Promise.reject(this.readyError)
    return Promise.resolve()
  }

  balance(): Promise<never> {
    return Promise.reject(new Error('unused'))
  }

  validateDestination(): Promise<{ ok: true }> {
    return Promise.resolve({ ok: true })
  }

  prepareTransfer(): Promise<PreparedTransfer> {
    this.prepares += 1
    return Promise.resolve({
      envelopeXdr: `xdr-${this.prepares.toString()}`,
      txHash: `hash-${this.prepares.toString()}`,
      sequence: this.prepares.toString(),
    })
  }

  submit(): Promise<SubmitOutcome> {
    this.submits += 1
    return Promise.resolve(this.submitResult)
  }

  lookup(): Promise<LookupResult> {
    return Promise.resolve(this.lookupResult)
  }

  refill(): Promise<never> {
    return Promise.reject(new Error('unused'))
  }

  isEnvelopeDead(): Promise<boolean> {
    return Promise.resolve(this.dead)
  }
}

function capture(): { log: Logger; events: { level: string; message: string }[] } {
  const events: { level: string; message: string }[] = []
  const log: Logger = {
    info(_fields, message) {
      events.push({ level: 'info', message })
    },
    warn(_fields, message) {
      events.push({ level: 'warn', message })
    },
    error(_fields, message) {
      events.push({ level: 'error', message })
    },
  }
  return { log, events }
}

function grant(token = 'grant-token'): Pick<StoreGrantService, 'withAccessToken'> {
  return { withAccessToken: (fn) => fn(token) }
}

function bindPayments(
  network: FakePaymentsNetwork,
  overrides: Partial<PaymentsNetwork> = {},
): PaymentsNetwork {
  return {
    createIncomingPayment: (input) => network.createIncomingPayment(input),
    createQuote: (input) => network.createQuote(input),
    createOutgoingPayment: (input) => network.createOutgoingPayment(input),
    findOutgoingPaymentByQuote: (input) => network.findOutgoingPaymentByQuote(input),
    getOutgoingPayment: (id, accessToken) => network.getOutgoingPayment(id, accessToken),
    getIncomingPayment: (url) => network.getIncomingPayment(url),
    completeIncomingPayment: (url) => network.completeIncomingPayment(url),
    ...overrides,
  }
}

async function apply(repo: CashInRepository, current: CashIn, event: CashInEvent, at: Date) {
  const next = transition(current, event, at)
  await repo.save(next, current.version)
  return next
}

function harness(options?: {
  readonly payments?: PaymentsNetwork
  readonly repo?: CashInRepository
}) {
  const clock = new ManualClock(NOW)
  const repo = options?.repo ?? createMemoryCashInRepository()
  const payments = options?.payments ?? new FakePaymentsNetwork({ rate: RATE, clock })
  const usdc = new ScriptedUsdc()
  const recorded = capture()
  const scheduler = new ManualScheduler()
  const processor = new SettlementProcessor({
    cashIns: repo,
    payments,
    usdc,
    storeGrant: grant(),
    clock,
    log: recorded.log,
    scheduler,
    pollMs: 1000,
    maxBackoffMs: 30_000,
  })
  return { clock, repo, payments, usdc, processor, scheduler, events: recorded.events }
}

async function quoted(
  subject: ReturnType<typeof harness>,
  id = 'cash-1',
  expiresAt = new Date(NOW.getTime() + 60_000),
): Promise<CashIn> {
  const network = subject.payments
  if (!(network instanceof FakePaymentsNetwork)) throw new Error('quoted needs the fake network')
  const incoming = await network.createIncomingPayment({})
  const quote = await network.createQuote({ incomingPaymentUrl: incoming.url, debit: COP })
  const cashIn = createQuoted(
    {
      id,
      cop: COP,
      usdc: USDC,
      copPerUsdc: RATE,
      expiresAt,
      stellarAddress: ADDRESS,
      customer: { phone: '3001112233', fullName: 'Ada Lovelace', documentNumber: '12345678' },
      incomingPaymentUrl: incoming.url,
      quoteId: quote.id,
    },
    subject.clock,
  )
  await subject.repo.insert(cashIn)
  return cashIn
}

async function settling(subject: ReturnType<typeof harness>, withOutgoing: boolean) {
  const cashIn = await quoted(subject)
  const claimed = await apply(subject.repo, cashIn, { type: 'Confirm' }, subject.clock.now())
  if (!withOutgoing) return claimed
  const network = subject.payments
  if (!(network instanceof FakePaymentsNetwork)) throw new Error('settling needs the fake network')
  const created = await network.createOutgoingPayment({
    quoteId: cashIn.openPayments.quoteId,
    accessToken: 'grant-token',
  })
  return apply(
    subject.repo,
    claimed,
    { type: 'OutgoingCreated', outgoingPaymentId: created.id },
    subject.clock.now(),
  )
}

describe('SettlementProcessor', () => {
  it('expires a quoted cash-in once and leaves a live quote alone', async () => {
    const subject = harness()
    const live = await quoted(subject, 'live', new Date(NOW.getTime() + 120_000))
    subject.clock.advance(60_000)
    const expired = await quoted(subject, 'old', new Date(NOW.getTime() + 30_000))
    await subject.processor.runOnce()
    expect((await subject.repo.get(live.id))?.status).toBe('quoted')
    expect((await subject.repo.get(expired.id))?.status).toBe('expired')
    await subject.processor.runOnce()
    expect((await subject.repo.get(expired.id))?.status).toBe('expired')
  })

  it('moves one status per pass from a paid outgoing payment to completed', async () => {
    const subject = harness()
    const cashIn = await settling(subject, true)
    const network = subject.payments as FakePaymentsNetwork
    network.setOutgoingStatus(cashIn.openPayments.outgoingPaymentId ?? '', 'paid')
    network.setReceived(cashIn.openPayments.incomingPaymentUrl, money(100n, 'USD', 2))
    await subject.processor.runOnce()
    expect((await subject.repo.get(cashIn.id))?.status).toBe('settled')
    expect(subject.usdc.prepares).toBe(0)
    await subject.processor.runOnce()
    const sending = await subject.repo.get(cashIn.id)
    expect(sending?.status).toBe('sending_usdc')
    expect(sending?.stellarTxHash).toBe('hash-1')
    expect(subject.usdc.submits).toBe(0)
    await subject.processor.runOnce()
    expect((await subject.repo.get(cashIn.id))?.status).toBe('completed')
    expect(subject.usdc.submits).toBe(1)
  })

  it('does not fail a pending outgoing payment, and warns once after two minutes', async () => {
    const subject = harness()
    const cashIn = await settling(subject, true)
    subject.clock.advance(5 * 60 * 60 * 1000)
    await subject.processor.runOnce()
    await subject.processor.runOnce()
    const stored = await subject.repo.get(cashIn.id)
    expect(stored?.status).toBe('settling')
    expect(stored?.failureReason).toBeUndefined()
    expect(
      subject.events.filter((event) => event.message === 'outgoing payment is still pending'),
    ).toHaveLength(1)
  })

  it('waits while the incoming payment has received nothing', async () => {
    const subject = harness()
    const cashIn = await settling(subject, true)
    const network = subject.payments as FakePaymentsNetwork
    network.setOutgoingStatus(cashIn.openPayments.outgoingPaymentId ?? '', 'paid')
    let completes = 0
    const payments = bindPayments(network, {
      completeIncomingPayment: (url) => {
        completes += 1
        return network.completeIncomingPayment(url)
      },
    })
    const watching = harness({ payments })
    await watching.repo.insert(cashIn)
    await watching.processor.runOnce()
    expect((await watching.repo.get(cashIn.id))?.status).toBe('settling')
    expect(completes).toBe(0)
  })

  it('does not complete an incoming payment that is already completed', async () => {
    const subject = harness()
    const cashIn = await settling(subject, true)
    const network = subject.payments as FakePaymentsNetwork
    network.setOutgoingStatus(cashIn.openPayments.outgoingPaymentId ?? '', 'paid')
    network.setReceived(cashIn.openPayments.incomingPaymentUrl, money(100n, 'USD', 2))
    network.setCompleted(cashIn.openPayments.incomingPaymentUrl, true)
    let completes = 0
    const payments = bindPayments(network, {
      completeIncomingPayment: (url) => {
        completes += 1
        return network.completeIncomingPayment(url)
      },
    })
    const watching = harness({ payments, repo: subject.repo })
    await watching.processor.runOnce()
    expect((await subject.repo.get(cashIn.id))?.status).toBe('settled')
    expect(completes).toBe(0)
  })

  it('treats an already-completed incoming payment as success', async () => {
    const subject = harness()
    const cashIn = await settling(subject, true)
    const network = subject.payments as FakePaymentsNetwork
    network.setOutgoingStatus(cashIn.openPayments.outgoingPaymentId ?? '', 'paid')
    network.setReceived(cashIn.openPayments.incomingPaymentUrl, money(100n, 'USD', 2))
    let reads = 0
    const payments = bindPayments(network, {
      getIncomingPayment: async (url) => {
        reads += 1
        const seen = await network.getIncomingPayment(url)
        return { received: money(100n, 'USD', 2), completed: reads > 1 || seen.completed }
      },
      completeIncomingPayment: () =>
        Promise.reject(
          new PaymentsNetworkError('rejected', 'incoming payment is already completed'),
        ),
    })
    const watching = harness({ payments, repo: subject.repo })
    await watching.processor.runOnce()
    expect((await subject.repo.get(cashIn.id))?.status).toBe('settled')
    expect(reads).toBe(2)
  })

  it('recovers a settling cash-in that lost its outgoing id', async () => {
    const found = harness()
    const existing = await settling(found, false)
    const network = found.payments as FakePaymentsNetwork
    const created = await network.createOutgoingPayment({
      quoteId: existing.openPayments.quoteId,
      accessToken: 'grant-token',
    })
    await found.processor.runOnce()
    expect((await found.repo.get(existing.id))?.openPayments.outgoingPaymentId).toBe(created.id)

    const createdLater = harness()
    const missing = await settling(createdLater, false)
    await createdLater.processor.runOnce()
    expect((await createdLater.repo.get(missing.id))?.openPayments.outgoingPaymentId).toMatch(
      /outgoing-payments/,
    )

    const expired = harness()
    const late = await settling(expired, false)
    expired.clock.advance(60_000)
    await expired.processor.runOnce()
    const failed = await expired.repo.get(late.id)
    expect(failed?.status).toBe('failed_payment')
    expect(failed?.failureReason).toBe('quote expired before payment')

    const blocked = harness()
    const claimed = await settling(blocked, false)
    const guarded = new SettlementProcessor({
      cashIns: blocked.repo,
      payments: blocked.payments,
      usdc: blocked.usdc,
      storeGrant: {
        withAccessToken: () =>
          Promise.reject(new StoreGrantError('no_grant', 'store grant is not active')),
      },
      clock: blocked.clock,
      log: capture().log,
      scheduler: blocked.scheduler,
    })
    await guarded.runOnce()
    expect((await blocked.repo.get(claimed.id))?.status).toBe('settling')
    expect((await blocked.repo.get(claimed.id))?.openPayments.outgoingPaymentId).toBeUndefined()
  })

  it('fails the cash-in when outgoing creation is rejected', async () => {
    const subject = harness()
    const cashIn = await settling(subject, false)
    ;(subject.payments as FakePaymentsNetwork).failOutgoing(
      new PaymentsNetworkError('rejected', 'quote was refused'),
    )
    await subject.processor.runOnce()
    const failed = await subject.repo.get(cashIn.id)
    expect(failed?.status).toBe('failed_payment')
    expect(failed?.failureReason).toBe('quote was refused')
  })

  it('fails a settling cash-in when the outgoing payment failed', async () => {
    const subject = harness()
    const cashIn = await settling(subject, true)
    ;(subject.payments as FakePaymentsNetwork).setOutgoingStatus(
      cashIn.openPayments.outgoingPaymentId ?? '',
      'failed',
    )
    await subject.processor.runOnce()
    expect((await subject.repo.get(cashIn.id))?.status).toBe('failed_payment')
    expect((await subject.repo.get(cashIn.id))?.failureReason).toBe('outgoing payment failed')
  })

  it('skips a version conflict and retries on the next pass', async () => {
    const inner = createMemoryCashInRepository()
    let armed = true
    const repo: MemoryCashInRepository = {
      ...inner,
      save: (next, expectedVersion) => {
        if (armed) {
          armed = false
          return Promise.reject(new DomainError('version_conflict', 'version conflict'))
        }
        return inner.save(next, expectedVersion)
      },
    }
    const subject = harness({ repo })
    const cashIn = await quoted(subject)
    subject.clock.advance(60_000)
    await expect(subject.processor.runOnce()).resolves.toBeUndefined()
    expect((await inner.get(cashIn.id))?.status).toBe('quoted')
    await subject.processor.runOnce()
    expect((await inner.get(cashIn.id))?.status).toBe('expired')
  })

  it('grows per-item backoff and resets it after a successful step', async () => {
    const subject = harness()
    const cashIn = await settling(subject, true)
    const network = subject.payments as FakePaymentsNetwork
    let calls = 0
    let fail = true
    const payments = bindPayments(network, {
      getOutgoingPayment: (id, accessToken) => {
        calls += 1
        if (fail) return Promise.reject(new PaymentsNetworkError('unavailable', 'wallet timeout'))
        return network.getOutgoingPayment(id, accessToken)
      },
    })
    const watching = harness({ payments, repo: subject.repo })
    await watching.processor.runOnce()
    expect(calls).toBe(1)
    await watching.processor.runOnce()
    expect(calls).toBe(1)
    watching.clock.advance(1000)
    await watching.processor.runOnce()
    expect(calls).toBe(2)
    watching.clock.advance(2000)
    fail = false
    await watching.processor.runOnce()
    expect(calls).toBe(3)
    expect((await subject.repo.get(cashIn.id))?.status).toBe('settling')
    fail = true
    await watching.processor.runOnce()
    expect(calls).toBe(4)
    await watching.processor.runOnce()
    expect(calls).toBe(4)
    watching.clock.advance(1000)
    await watching.processor.runOnce()
    expect(calls).toBe(5)
  })

  it('keeps going when one cash-in cannot reach the network', async () => {
    const subject = harness()
    const blocked = await settling(subject, true)
    const due = await quoted(subject, 'due', new Date(NOW.getTime() - 1000))
    const network = subject.payments as FakePaymentsNetwork
    const payments = bindPayments(network, {
      getOutgoingPayment: () =>
        Promise.reject(new PaymentsNetworkError('unavailable', 'wallet timeout')),
    })
    const watching = harness({ payments, repo: subject.repo })
    await watching.processor.runOnce()
    expect((await subject.repo.get(blocked.id))?.status).toBe('settling')
    expect((await subject.repo.get(due.id))?.status).toBe('expired')
  })

  it('stops scheduling and waits for the pass that is already running', async () => {
    const subject = harness()
    const cashIn = await settling(subject, true)
    const network = subject.payments as FakePaymentsNetwork
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered: () => void = () => undefined
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const payments = bindPayments(network, {
      getOutgoingPayment: async (id, accessToken) => {
        entered()
        await gate
        return network.getOutgoingPayment(id, accessToken)
      },
    })
    const watching = harness({ payments, repo: subject.repo })
    watching.processor.start()
    watching.scheduler.fireNext()
    await started
    let stopped = false
    const stopping = watching.processor.stop().then(() => {
      stopped = true
    })
    await Promise.resolve()
    expect(stopped).toBe(false)
    release()
    await stopping
    expect(watching.scheduler.pending()).toBe(0)
    network.setOutgoingStatus(cashIn.openPayments.outgoingPaymentId ?? '', 'failed')
    watching.scheduler.fireNext()
    await Promise.resolve()
    expect((await subject.repo.get(cashIn.id))?.status).toBe('settling')
  })

  it('logs an operator setup failure and still expires quotes', async () => {
    const subject = harness()
    const cashIn = await quoted(subject, 'old', new Date(NOW.getTime() - 1))
    subject.usdc.readyError = new StellarError('operator_not_ready', 'missing trustline')
    await expect(subject.processor.ensureReady()).resolves.toBeUndefined()
    expect(subject.events.some((event) => event.level === 'error')).toBe(true)
    expect(() => {
      subject.processor.start()
    }).not.toThrow()
    subject.usdc.readyError = undefined
    await subject.processor.runOnce()
    expect((await subject.repo.get(cashIn.id))?.status).toBe('expired')
  })

  it('records a rejected submit and a lost submit without leaving sending_usdc early', async () => {
    const subject = harness()
    const cashIn = await settling(subject, true)
    await apply(subject.repo, cashIn, { type: 'IncomingCompleted' }, subject.clock.now())
    await subject.processor.runOnce()
    subject.usdc.submitResult = { kind: 'unknown' }
    await subject.processor.runOnce()
    expect((await subject.repo.get(cashIn.id))?.status).toBe('sending_usdc')
    subject.usdc.submitResult = { kind: 'rejected', code: 'op_underfunded' }
    await subject.processor.runOnce()
    const failed = await subject.repo.get(cashIn.id)
    expect(failed?.status).toBe('failed_stellar')
    expect(failed?.failureReason).toBe('op_underfunded')
  })

  it('marks a looked-up success and a looked-up failure', async () => {
    const subject = harness()
    const cashIn = await settling(subject, true)
    const settled = await apply(subject.repo, cashIn, { type: 'IncomingCompleted' }, NOW)
    const sending = await apply(
      subject.repo,
      settled,
      { type: 'UsdcSendStarted', stellarEnvelopeXdr: 'xdr', stellarTxHash: 'hash-9' },
      NOW,
    )
    subject.usdc.lookupResult = { kind: 'failed', code: 'op_underfunded' }
    await subject.processor.runOnce()
    expect((await subject.repo.get(sending.id))?.status).toBe('failed_stellar')

    const success = harness()
    const open = await settling(success, true)
    const done = await apply(success.repo, open, { type: 'IncomingCompleted' }, NOW)
    await apply(
      success.repo,
      done,
      { type: 'UsdcSendStarted', stellarEnvelopeXdr: 'xdr', stellarTxHash: 'hash-9' },
      NOW,
    )
    success.usdc.lookupResult = { kind: 'success', ledger: 4 }
    await success.processor.runOnce()
    expect((await success.repo.get(open.id))?.status).toBe('completed')
  })

  it('rebuilds a dead envelope and resubmits a live one', async () => {
    const dead = harness()
    const cashIn = await settling(dead, true)
    const settled = await apply(dead.repo, cashIn, { type: 'IncomingCompleted' }, NOW)
    await apply(
      dead.repo,
      settled,
      { type: 'UsdcSendStarted', stellarEnvelopeXdr: 'old', stellarTxHash: 'old-hash' },
      NOW,
    )
    dead.usdc.dead = true
    await dead.processor.runOnce()
    const rebuilt = await dead.repo.get(cashIn.id)
    expect(rebuilt?.status).toBe('sending_usdc')
    expect(rebuilt?.stellarTxHash).toBe('hash-1')
    expect(dead.usdc.submits).toBe(0)

    const live = harness()
    const open = await settling(live, true)
    const ready = await apply(live.repo, open, { type: 'IncomingCompleted' }, NOW)
    await apply(
      live.repo,
      ready,
      { type: 'UsdcSendStarted', stellarEnvelopeXdr: 'old', stellarTxHash: 'old-hash' },
      NOW,
    )
    await live.processor.runOnce()
    expect((await live.repo.get(open.id))?.status).toBe('completed')
    expect(live.usdc.submits).toBe(1)
  })

  it('does not touch failed_stellar until a retry reopens it', async () => {
    const subject = harness()
    const cashIn = await settling(subject, true)
    const settled = await apply(subject.repo, cashIn, { type: 'IncomingCompleted' }, NOW)
    const sending = await apply(
      subject.repo,
      settled,
      { type: 'UsdcSendStarted', stellarEnvelopeXdr: 'xdr-1', stellarTxHash: 'hash-1' },
      NOW,
    )
    subject.usdc.lookupResult = { kind: 'failed', code: 'op_underfunded' }
    await subject.processor.runOnce()
    const failed = await subject.repo.get(sending.id)
    expect(failed?.status).toBe('failed_stellar')
    await subject.processor.runOnce()
    expect((await subject.repo.get(sending.id))?.version).toBe(failed?.version)
    const retried = await apply(subject.repo, failed ?? sending, { type: 'Retry' }, NOW)
    await subject.processor.runOnce()
    const rebuilt = await subject.repo.get(retried.id)
    expect(rebuilt?.status).toBe('sending_usdc')
    expect(rebuilt?.stellarTxHash).toBe('hash-1')
    expect(rebuilt?.failureReason).toBeUndefined()
  })

  it('does not run again after stop and schedules the following pass', async () => {
    const subject = harness()
    subject.processor.start()
    subject.processor.start()
    subject.scheduler.fireNext()
    for (let i = 0; i < 6; i += 1) await Promise.resolve()
    expect(subject.scheduler.pending()).toBe(1)
    await subject.processor.stop()
    expect(subject.scheduler.pending()).toBe(0)
    await expect(subject.processor.runOnce()).resolves.toBeUndefined()
  })

  it('logs a repository failure and an unexpected step error without stopping the loop', async () => {
    const broken = harness()
    const repo = {
      ...broken.repo,
      listByStatus: () => Promise.reject(new Error('database is down')),
    }
    const logged = harness({ repo })
    await expect(logged.processor.runOnce()).resolves.toBeUndefined()
    expect(
      logged.events.some((event) => event.message === 'settlement pass could not load cash-ins'),
    ).toBe(true)

    const inner = createMemoryCashInRepository()
    const failing = harness({
      repo: {
        ...inner,
        save: () =>
          Promise.reject(new DomainError('invalid_transition', 'transition is not allowed')),
      },
    })
    const cashIn = await quoted(failing)
    failing.clock.advance(60_000)
    await failing.processor.runOnce()
    expect((await inner.get(cashIn.id))?.status).toBe('quoted')
    expect(failing.events.some((event) => event.message === 'settlement step failed')).toBe(true)
  })

  it('backs off when a network read or the stored submit throws', async () => {
    const incoming = harness()
    const cashIn = await settling(incoming, true)
    const network = incoming.payments as FakePaymentsNetwork
    network.setOutgoingStatus(cashIn.openPayments.outgoingPaymentId ?? '', 'paid')
    const payments = bindPayments(network, {
      getIncomingPayment: () =>
        Promise.reject(new PaymentsNetworkError('unavailable', 'wallet timeout')),
    })
    const watching = harness({ payments, repo: incoming.repo })
    await watching.processor.runOnce()
    expect((await incoming.repo.get(cashIn.id))?.status).toBe('settling')

    const sending = harness()
    const open = await settling(sending, true)
    const settled = await apply(sending.repo, open, { type: 'IncomingCompleted' }, NOW)
    await apply(
      sending.repo,
      settled,
      { type: 'UsdcSendStarted', stellarEnvelopeXdr: 'xdr', stellarTxHash: 'hash-9' },
      NOW,
    )
    sending.usdc.submit = () => Promise.reject(new Error('horizon socket hung up'))
    await sending.processor.runOnce()
    expect((await sending.repo.get(open.id))?.status).toBe('sending_usdc')

    sending.usdc.isEnvelopeDead = () =>
      Promise.reject(new StellarError('unavailable', 'horizon is down'))
    sending.clock.advance(1000)
    await sending.processor.runOnce()
    expect((await sending.repo.get(open.id))?.status).toBe('sending_usdc')
  })
})
