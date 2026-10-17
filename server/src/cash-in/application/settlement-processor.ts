import type { CashIn } from '../domain/cash-in.ts'
import { transition, type CashInEvent } from '../domain/transitions.ts'
import { PaymentsNetworkError, type PaymentsNetwork } from '../payments-network.ts'
import type { CashInRepository } from '../repository.ts'
import { DomainError } from '../../shared/errors.ts'
import type { Clock } from '../../shared/ports.ts'
import { StoreGrantError } from '../../store-grant/application/errors.ts'
import type { StoreGrantService } from '../../store-grant/application/store-grant-service.ts'
import {
  StellarError,
  type PreparedTransfer,
  type UsdcNetwork,
} from '../../treasury/usdc-network.ts'

const ACTIVE = ['quoted', 'settling', 'settled', 'sending_usdc'] as const
const PENDING_WARN_MS = 120_000
const DEFAULT_POLL_MS = 1000
const DEFAULT_MAX_BACKOFF_MS = 30_000
const DEFAULT_REBUILD_CONFIRM_MS = 15_000
const RECOVER_UNKNOWN_LOG_MS = 60 * 60 * 1000

interface DeadSight {
  readonly txHash: string
  readonly accountSequence: string
  readonly atMs: number
}

export interface Logger {
  info(fields: object, message: string): void
  warn(fields: object, message: string): void
  error(fields: object, message: string): void
}

export interface Scheduler {
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}

export interface SettlementProcessorDeps {
  readonly cashIns: CashInRepository
  readonly payments: PaymentsNetwork
  readonly usdc: UsdcNetwork
  readonly storeGrant: Pick<StoreGrantService, 'withAccessToken'>
  readonly clock: Clock
  readonly log: Logger
  readonly scheduler: Scheduler
  readonly pollMs?: number
  readonly maxBackoffMs?: number
  /** Second dead verdict must be at least this long after the first. */
  readonly rebuildConfirmMs?: number
}

type StepResult = 'ok' | 'retry'

/**
 * One in-process pass over cash-ins that still need the network.
 * Every transition is saved before the next side effect. A crash after
 * `UsdcSendStarted` resumes from `sending_usdc` and submits the stored envelope.
 */
export class SettlementProcessor {
  readonly #cashIns: CashInRepository
  readonly #payments: PaymentsNetwork
  readonly #usdc: UsdcNetwork
  readonly #storeGrant: Pick<StoreGrantService, 'withAccessToken'>
  readonly #clock: Clock
  readonly #log: Logger
  readonly #scheduler: Scheduler
  readonly #pollMs: number
  readonly #maxBackoffMs: number
  readonly #rebuildConfirmMs: number
  readonly #notBefore = new Map<string, number>()
  readonly #delayMs = new Map<string, number>()
  /** Hashes already shown to the customer as `failed_stellar` in this process. */
  readonly #reportedFailed = new Set<string>()
  readonly #warnedPending = new Set<string>()
  /** First consistent dead sighting. A restart drops it and only delays a rebuild. */
  readonly #deadConfirm = new Map<string, DeadSight>()
  readonly #recoverUnknownAt = new Map<string, number>()
  #operatorReady = false
  #started = false
  #stopped = false
  #timer: unknown
  #chain: Promise<void> = Promise.resolve()
  #inflight: Promise<void> | undefined

  constructor(deps: SettlementProcessorDeps) {
    this.#cashIns = deps.cashIns
    this.#payments = deps.payments
    this.#usdc = deps.usdc
    this.#storeGrant = deps.storeGrant
    this.#clock = deps.clock
    this.#log = deps.log
    this.#scheduler = deps.scheduler
    this.#pollMs = deps.pollMs ?? DEFAULT_POLL_MS
    this.#maxBackoffMs = deps.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS
    this.#rebuildConfirmMs = deps.rebuildConfirmMs ?? DEFAULT_REBUILD_CONFIRM_MS
  }

  /** Does not throw. A failed operator setup is retried on the next pass. */
  async ensureReady(): Promise<void> {
    if (this.#operatorReady) return
    try {
      await this.#usdc.ensureOperatorReady()
      this.#operatorReady = true
    } catch (error) {
      this.#log.error({ err: safeError(error) }, 'operator wallet is not ready')
    }
  }

  start(): void {
    if (this.#started) return
    this.#started = true
    this.#stopped = false
    void this.ensureReady()
    this.#arm(0)
  }

  async stop(): Promise<void> {
    this.#stopped = true
    if (this.#timer !== undefined) {
      this.#scheduler.clearTimeout(this.#timer)
      this.#timer = undefined
    }
    await this.#inflight
  }

  runOnce(): Promise<void> {
    if (this.#stopped) return Promise.resolve()
    const run = this.#chain.then(() => (this.#stopped ? undefined : this.#run()))
    this.#chain = run.then(
      () => undefined,
      () => undefined,
    )
    this.#inflight = this.#chain
    return run
  }

  async #run(): Promise<void> {
    await this.ensureReady()
    let rows: CashIn[]
    try {
      rows = await this.#cashIns.listByStatus(ACTIVE)
    } catch (error) {
      this.#log.error({ err: safeError(error) }, 'settlement pass could not load cash-ins')
      return
    }
    for (const cashIn of rows) {
      await this.#advance(cashIn)
    }
    this.#forgetIdle(new Set(rows.map((row) => row.id)))
  }

  async #advance(cashIn: CashIn): Promise<void> {
    if (!this.#due(cashIn.id)) return
    try {
      const outcome = await this.#step(cashIn)
      if (outcome === 'retry') this.#penalize(cashIn.id)
      else this.#clearBackoff(cashIn.id)
    } catch (error) {
      if (isVersionConflict(error)) {
        this.#log.info(
          { cashInId: cashIn.id, status: cashIn.status },
          'cash-in moved while settling',
        )
        return
      }
      this.#penalize(cashIn.id)
      this.#log.error(
        { cashInId: cashIn.id, status: cashIn.status, err: safeError(error) },
        'settlement step failed',
      )
    }
  }

  #step(cashIn: CashIn): Promise<StepResult> {
    switch (cashIn.status) {
      case 'quoted':
        return this.#expire(cashIn)
      case 'settling':
        return cashIn.openPayments.outgoingPaymentId === undefined
          ? this.#recoverOutgoing(cashIn)
          : this.#pollOutgoing(cashIn)
      case 'settled':
        return this.#startSend(cashIn)
      case 'sending_usdc':
        return this.#finishSend(cashIn)
      case 'completed':
      case 'expired':
      case 'failed_payment':
      case 'failed_stellar':
        return Promise.resolve('ok')
      default: {
        const unexpected: never = cashIn.status
        return unexpected
      }
    }
  }

  async #expire(cashIn: CashIn): Promise<StepResult> {
    if (this.#clock.now().getTime() < cashIn.expiresAt.getTime()) return 'ok'
    await this.#save(cashIn, { type: 'Expire' })
    return 'ok'
  }

  async #recoverOutgoing(cashIn: CashIn): Promise<StepResult> {
    let found: { id: string } | undefined
    try {
      found = await this.#storeGrant.withAccessToken((token) =>
        this.#payments.findOutgoingPaymentByQuote({
          quoteId: cashIn.openPayments.quoteId,
          accessToken: token,
        }),
      )
    } catch (error) {
      if (isVersionConflict(error)) throw error
      this.#logUnknownRecovery(cashIn, error)
      return 'retry'
    }
    this.#recoverUnknownAt.delete(cashIn.id)
    if (found !== undefined) {
      await this.#save(cashIn, { type: 'OutgoingCreated', outgoingPaymentId: found.id })
      return 'ok'
    }
    if (this.#clock.now().getTime() >= cashIn.expiresAt.getTime()) {
      await this.#save(cashIn, {
        type: 'PaymentFailed',
        reason: 'quote expired before payment',
      })
      return 'ok'
    }
    try {
      const created = await this.#storeGrant.withAccessToken((token) =>
        this.#payments.createOutgoingPayment({
          quoteId: cashIn.openPayments.quoteId,
          accessToken: token,
          description: cashIn.memo,
        }),
      )
      await this.#save(cashIn, { type: 'OutgoingCreated', outgoingPaymentId: created.id })
      return 'ok'
    } catch (error) {
      if (error instanceof PaymentsNetworkError && error.kind === 'rejected') {
        await this.#save(cashIn, { type: 'PaymentFailed', reason: error.detail })
        return 'ok'
      }
      return this.#retry(cashIn, error)
    }
  }

  async #pollOutgoing(cashIn: CashIn): Promise<StepResult> {
    const outgoingId = cashIn.openPayments.outgoingPaymentId
    if (outgoingId === undefined) return 'ok'
    let payment: Awaited<ReturnType<PaymentsNetwork['getOutgoingPayment']>>
    try {
      payment = await this.#storeGrant.withAccessToken((token) =>
        this.#payments.getOutgoingPayment(outgoingId, token),
      )
    } catch (error) {
      return this.#retry(cashIn, error)
    }
    if (payment.status === 'failed') {
      await this.#save(cashIn, { type: 'PaymentFailed', reason: 'outgoing payment failed' })
      return 'ok'
    }
    if (payment.status === 'pending') {
      this.#warnIfPending(cashIn)
      return 'ok'
    }
    return this.#completeIncoming(cashIn)
  }

  async #completeIncoming(cashIn: CashIn): Promise<StepResult> {
    const url = cashIn.openPayments.incomingPaymentUrl
    let incoming: { received: { amount: bigint }; completed: boolean }
    try {
      incoming = await this.#payments.getIncomingPayment(url)
    } catch (error) {
      return this.#retry(cashIn, error)
    }
    if (incoming.received.amount === 0n) return 'ok'
    if (!incoming.completed) {
      try {
        await this.#payments.completeIncomingPayment(url)
      } catch (error) {
        const completed = await this.#alreadyCompleted(url)
        if (!completed) return this.#retry(cashIn, error)
      }
    }
    await this.#save(cashIn, { type: 'IncomingCompleted' })
    return 'ok'
  }

  async #alreadyCompleted(url: string): Promise<boolean> {
    try {
      const again = await this.#payments.getIncomingPayment(url)
      return again.completed
    } catch {
      return false
    }
  }

  async #startSend(cashIn: CashIn): Promise<StepResult> {
    if (!this.#operatorReady) return this.#retry(cashIn, new Error('operator wallet is not ready'))
    let prepared: PreparedTransfer
    try {
      prepared = await this.#usdc.prepareTransfer({
        to: cashIn.stellarAddress,
        amount: cashIn.usdc,
        memo: cashIn.memo,
      })
    } catch (error) {
      return this.#retry(cashIn, error)
    }
    await this.#save(cashIn, {
      type: 'UsdcSendStarted',
      stellarEnvelopeXdr: prepared.envelopeXdr,
      stellarTxHash: prepared.txHash,
    })
    return 'ok'
  }

  async #finishSend(cashIn: CashIn): Promise<StepResult> {
    const txHash = cashIn.stellarTxHash
    const envelopeXdr = cashIn.stellarEnvelopeXdr
    if (txHash === undefined || envelopeXdr === undefined) {
      return this.#retry(cashIn, new Error('stellar envelope is missing'))
    }
    const prepared: PreparedTransfer = { envelopeXdr, txHash }
    let looked: Awaited<ReturnType<UsdcNetwork['lookup']>>
    try {
      looked = await this.#usdc.lookup(txHash)
    } catch (error) {
      return this.#retry(cashIn, error)
    }
    if (looked.kind === 'success') {
      this.#deadConfirm.delete(cashIn.id)
      await this.#save(cashIn, { type: 'UsdcSent', stellarTxHash: txHash })
      this.#reportedFailed.delete(failedKey(cashIn.id, txHash))
      return 'ok'
    }
    if (looked.kind === 'failed') {
      this.#deadConfirm.delete(cashIn.id)
      const key = failedKey(cashIn.id, txHash)
      if (this.#reportedFailed.has(key)) return this.#rebuild(cashIn)
      await this.#save(cashIn, { type: 'UsdcFailed', reason: looked.code })
      this.#reportedFailed.add(key)
      return 'ok'
    }
    let verdict: Awaited<ReturnType<UsdcNetwork['isEnvelopeDead']>>
    try {
      verdict = await this.#usdc.isEnvelopeDead(prepared)
    } catch (error) {
      return this.#retry(cashIn, error)
    }
    if (!verdict.dead) {
      this.#deadConfirm.delete(cashIn.id)
      return this.#submitStored(cashIn, prepared)
    }
    return this.#confirmDead(cashIn, txHash, verdict.accountSequence)
  }

  #confirmDead(cashIn: CashIn, txHash: string, accountSequence: string): Promise<StepResult> {
    const now = this.#clock.now().getTime()
    const previous = this.#deadConfirm.get(cashIn.id)
    const sameTx = previous?.txHash === txHash
    const sameAccount = previous?.accountSequence === accountSequence
    if (!sameTx || !sameAccount) {
      this.#deadConfirm.set(cashIn.id, { txHash, accountSequence, atMs: now })
      return Promise.resolve('ok')
    }
    if (now - previous.atMs < this.#rebuildConfirmMs) return Promise.resolve('ok')
    this.#deadConfirm.delete(cashIn.id)
    return this.#rebuild(cashIn)
  }

  #logUnknownRecovery(cashIn: CashIn, error: unknown): void {
    const now = this.#clock.now().getTime()
    const previous = this.#recoverUnknownAt.get(cashIn.id) ?? 0
    if (previous !== 0 && now - previous < RECOVER_UNKNOWN_LOG_MS) return
    this.#recoverUnknownAt.set(cashIn.id, now)
    this.#log.error(
      { cashInId: cashIn.id, err: safeError(error) },
      'outgoing payment lookup is unknown',
    )
  }

  #forgetIdle(live: ReadonlySet<string>): void {
    for (const id of this.#notBefore.keys()) {
      if (!live.has(id)) this.#clearBackoff(id)
    }
    for (const id of this.#warnedPending) {
      if (!live.has(id)) this.#warnedPending.delete(id)
    }
    for (const id of this.#deadConfirm.keys()) {
      if (!live.has(id)) this.#deadConfirm.delete(id)
    }
    for (const id of this.#recoverUnknownAt.keys()) {
      if (!live.has(id)) this.#recoverUnknownAt.delete(id)
    }
  }

  async #rebuild(cashIn: CashIn): Promise<StepResult> {
    let prepared: PreparedTransfer
    try {
      prepared = await this.#usdc.prepareTransfer({
        to: cashIn.stellarAddress,
        amount: cashIn.usdc,
        memo: cashIn.memo,
      })
    } catch (error) {
      return this.#retry(cashIn, error)
    }
    await this.#save(cashIn, {
      type: 'UsdcEnvelopeRebuilt',
      envelopeXdr: prepared.envelopeXdr,
      txHash: prepared.txHash,
    })
    if (cashIn.stellarTxHash !== undefined) {
      this.#reportedFailed.delete(failedKey(cashIn.id, cashIn.stellarTxHash))
    }
    return 'ok'
  }

  async #submitStored(cashIn: CashIn, prepared: PreparedTransfer): Promise<StepResult> {
    let outcome: Awaited<ReturnType<UsdcNetwork['submit']>>
    try {
      outcome = await this.#usdc.submit(prepared)
    } catch (error) {
      return this.#retry(cashIn, error)
    }
    if (outcome.kind === 'unknown') return 'ok'
    if (outcome.kind === 'rejected') {
      await this.#save(cashIn, { type: 'UsdcFailed', reason: outcome.code })
      this.#reportedFailed.add(failedKey(cashIn.id, prepared.txHash))
      return 'ok'
    }
    await this.#save(cashIn, { type: 'UsdcSent', stellarTxHash: prepared.txHash })
    return 'ok'
  }

  #warnIfPending(cashIn: CashIn): void {
    const ageMs = this.#clock.now().getTime() - cashIn.updatedAt.getTime()
    if (ageMs < PENDING_WARN_MS || this.#warnedPending.has(cashIn.id)) return
    this.#warnedPending.add(cashIn.id)
    this.#log.warn(
      { cashInId: cashIn.id, status: cashIn.status, ageMs },
      'outgoing payment is still pending',
    )
  }

  #retry(cashIn: CashIn, error: unknown): StepResult {
    if (isVersionConflict(error)) throw error
    this.#log.warn(
      { cashInId: cashIn.id, status: cashIn.status, err: safeError(error) },
      'settlement step will retry',
    )
    return 'retry'
  }

  async #save(cashIn: CashIn, event: CashInEvent): Promise<void> {
    const next = transition(cashIn, event, this.#clock.now())
    await this.#cashIns.save(next, cashIn.version)
    this.#log.info(
      {
        cashInId: cashIn.id,
        status: next.status,
        version: next.version,
        cop: cashIn.cop.amount.toString(),
        usdc: cashIn.usdc.amount.toString(),
      },
      'cash-in advanced',
    )
  }

  #due(id: string): boolean {
    const until = this.#notBefore.get(id)
    return until === undefined || this.#clock.now().getTime() >= until
  }

  #penalize(id: string): void {
    const previous = this.#delayMs.get(id)
    const delay = previous === undefined ? this.#pollMs : Math.min(previous * 2, this.#maxBackoffMs)
    this.#delayMs.set(id, delay)
    this.#notBefore.set(id, this.#clock.now().getTime() + delay)
  }

  #clearBackoff(id: string): void {
    this.#delayMs.delete(id)
    this.#notBefore.delete(id)
  }

  #arm(delayMs: number): void {
    if (this.#stopped) return
    this.#timer = this.#scheduler.setTimeout(() => {
      this.#timer = undefined
      if (this.#stopped) return
      const run = this.runOnce()
      void run.finally(() => {
        if (!this.#stopped) this.#arm(this.#pollMs)
      })
    }, delayMs)
  }
}

function failedKey(id: string, txHash: string): string {
  return `${id}:${txHash}`
}

function isVersionConflict(error: unknown): boolean {
  return error instanceof DomainError && error.code === 'version_conflict'
}

function safeError(error: unknown): string {
  if (error instanceof PaymentsNetworkError) return error.detail
  if (error instanceof StellarError) return error.detail
  if (error instanceof StoreGrantError) return error.code
  if (error instanceof DomainError) return error.code
  return 'settlement step failed'
}
