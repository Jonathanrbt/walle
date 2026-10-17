import type { Mutex } from '../../shared/mutex.ts'
import type { Clock } from '../../shared/ports.ts'
import { StoreGrantError } from '../../store-grant/application/errors.ts'
import type { StoreGrantService } from '../../store-grant/application/store-grant-service.ts'
import type { CashIn, CashInStatus } from '../domain/cash-in.ts'
import { transition } from '../domain/transitions.ts'
import { PaymentsNetworkError, type PaymentsNetwork } from '../payments-network.ts'
import type { CashInRepository } from '../repository.ts'
import { CashInError } from './errors.ts'

const IDEMPOTENT = new Set<CashInStatus>(['settling', 'settled', 'sending_usdc', 'completed'])

export interface ConfirmCashInDeps {
  readonly cashIns: CashInRepository
  readonly payments: PaymentsNetwork
  readonly storeGrant: Pick<StoreGrantService, 'assertCapacity' | 'withAccessToken'>
  readonly clock: Clock
  readonly mutex: Mutex
}

export class ConfirmCashIn {
  readonly #cashIns: CashInRepository
  readonly #payments: PaymentsNetwork
  readonly #storeGrant: Pick<StoreGrantService, 'assertCapacity' | 'withAccessToken'>
  readonly #clock: Clock
  readonly #mutex: Mutex

  constructor(deps: ConfirmCashInDeps) {
    this.#cashIns = deps.cashIns
    this.#payments = deps.payments
    this.#storeGrant = deps.storeGrant
    this.#clock = deps.clock
    this.#mutex = deps.mutex
  }

  confirm(id: string): Promise<CashIn> {
    return this.#mutex.run(() => this.#confirm(id))
  }

  retry(id: string): Promise<CashIn> {
    return this.#mutex.run(() => this.#retry(id))
  }

  async #confirm(id: string): Promise<CashIn> {
    const current = await this.#require(id)
    if (IDEMPOTENT.has(current.status)) return current
    if (current.status === 'expired') throw new CashInError('quote_expired', 'quote expired')
    if (current.status !== 'quoted') {
      throw new CashInError('invalid_state', 'cash-in cannot be confirmed')
    }

    const now = this.#clock.now()
    if (now.getTime() >= current.expiresAt.getTime()) {
      const expired = transition(current, { type: 'Expire' }, now)
      await this.#cashIns.save(expired, current.version)
      throw new CashInError('quote_expired', 'quote expired')
    }

    await this.#storeGrant.assertCapacity(current.cop)
    const claimed = transition(current, { type: 'Confirm' }, now)
    await this.#cashIns.save(claimed, current.version)
    return this.#createOutgoing(claimed)
  }

  async #retry(id: string): Promise<CashIn> {
    const current = await this.#require(id)
    if (current.status !== 'failed_stellar') {
      throw new CashInError('invalid_state', 'cash-in cannot be retried')
    }
    const next = transition(current, { type: 'Retry' }, this.#clock.now())
    await this.#cashIns.save(next, current.version)
    return next
  }

  async #require(id: string): Promise<CashIn> {
    const found = await this.#cashIns.get(id)
    if (found === undefined) throw new CashInError('not_found', 'cash-in was not found')
    return found
  }

  async #createOutgoing(claimed: CashIn): Promise<CashIn> {
    let created: { id: string }
    try {
      created = await this.#storeGrant.withAccessToken((token) =>
        this.#payments.createOutgoingPayment({
          quoteId: claimed.openPayments.quoteId,
          accessToken: token,
          description: claimed.memo,
        }),
      )
    } catch (error) {
      if (error instanceof PaymentsNetworkError && error.kind === 'rejected') {
        const failed = transition(
          claimed,
          { type: 'PaymentFailed', reason: error.detail },
          this.#clock.now(),
        )
        await this.#cashIns.save(failed, claimed.version)
        throw new CashInError('invalid_state', error.detail)
      }
      if (error instanceof StoreGrantError) throw error
      // The payment may or may not exist. Leave the claim for the processor.
      return claimed
    }
    const next = transition(
      claimed,
      { type: 'OutgoingCreated', outgoingPaymentId: created.id },
      this.#clock.now(),
    )
    await this.#cashIns.save(next, claimed.version)
    return next
  }
}
