import { PaymentsNetworkError, type PaymentsNetwork } from '../../src/cash-in/payments-network.ts'
import type { Clock } from '../../src/shared/ports.ts'
import { money, type Money } from '../../src/shared/money.ts'

const DEFAULT_RATE = money(317698n, 'COP', 2)
const QUOTE_TTL_MS = 300_000
const INCOMING_TTL_MS = 30 * 24 * 60 * 60 * 1000

const systemClock: Clock = { now: () => new Date() }

interface IncomingRecord {
  expiresAt: Date
  received: Money
  completed: boolean
}

interface QuoteRecord {
  debit: Money
  receive: Money
  expiresAt: Date
}

interface OutgoingRecord {
  debit: Money
  sent: Money
  failed: boolean
}

export interface FakePaymentsOptions {
  /** COP per 1 USD at scale 2. Receive minor units are floor(debit * 100 / rate). */
  readonly rate?: Money
  readonly clock?: Clock
}

export class FakePaymentsNetwork implements PaymentsNetwork {
  readonly #rate: Money
  readonly #clock: Clock
  #sequence = 0
  #quoteError: PaymentsNetworkError | undefined
  #outgoingError: PaymentsNetworkError | undefined
  readonly #incoming = new Map<string, IncomingRecord>()
  readonly #quotes = new Map<string, QuoteRecord>()
  readonly #outgoing = new Map<string, OutgoingRecord>()

  constructor(options: FakePaymentsOptions = {}) {
    const rate = options.rate ?? DEFAULT_RATE
    if (rate.assetCode !== 'COP' || rate.assetScale !== 2 || rate.amount <= 0n) {
      throw new PaymentsNetworkError('rejected', 'rate must be a positive COP amount at scale 2')
    }
    this.#rate = rate
    this.#clock = options.clock ?? systemClock
  }

  failNextQuote(error?: PaymentsNetworkError): void {
    this.#quoteError = error ?? new PaymentsNetworkError('unavailable', 'scripted quote failure')
  }

  failOutgoing(error?: PaymentsNetworkError): void {
    this.#outgoingError =
      error ?? new PaymentsNetworkError('unavailable', 'scripted outgoing failure')
  }

  setOutgoingStatus(id: string, status: 'pending' | 'paid' | 'failed'): void {
    const payment = this.#requireOutgoing(id)
    if (status === 'paid') {
      payment.failed = false
      payment.sent = money(payment.debit.amount, payment.debit.assetCode, payment.debit.assetScale)
      return
    }
    if (status === 'failed') {
      payment.failed = true
      return
    }
    payment.failed = false
    payment.sent = money(0n, payment.debit.assetCode, payment.debit.assetScale)
  }

  setReceived(url: string, received: Money): void {
    this.#requireIncoming(url).received = received
  }

  setCompleted(url: string, completed: boolean): void {
    this.#requireIncoming(url).completed = completed
  }

  createIncomingPayment(input: {
    description?: string
  }): Promise<{ url: string; expiresAt: Date }> {
    return settle(() => {
      if ((input.description ?? '').length > 1024) {
        throw new PaymentsNetworkError('rejected', 'description is too long')
      }
      const url = this.#next('incoming-payments')
      const expiresAt = new Date(this.#clock.now().getTime() + INCOMING_TTL_MS)
      this.#incoming.set(url, {
        expiresAt,
        received: money(0n, 'USD', 2),
        completed: false,
      })
      return { url, expiresAt }
    })
  }

  createQuote(input: {
    incomingPaymentUrl: string
    debit: Money
  }): Promise<{ id: string; debit: Money; receive: Money; expiresAt: Date }> {
    return settle(() => {
      const scripted = this.#quoteError
      this.#quoteError = undefined
      if (scripted !== undefined) throw scripted
      this.#requireIncoming(input.incomingPaymentUrl)
      if (input.debit.assetCode !== 'COP' || input.debit.assetScale !== 2) {
        throw new PaymentsNetworkError('rejected', 'debit asset does not match the store wallet')
      }
      const receive = money((input.debit.amount * 100n) / this.#rate.amount, 'USD', 2)
      if (receive.amount <= 0n) {
        throw new PaymentsNetworkError('rejected', 'non-positive receive amount')
      }
      const id = this.#next('quotes')
      const expiresAt = new Date(this.#clock.now().getTime() + QUOTE_TTL_MS)
      const quote = { debit: input.debit, receive, expiresAt }
      this.#quotes.set(id, quote)
      return { id, debit: quote.debit, receive: quote.receive, expiresAt }
    })
  }

  createOutgoingPayment(input: {
    quoteId: string
    accessToken: string
    description?: string
  }): Promise<{ id: string }> {
    return settle(() => {
      const scripted = this.#outgoingError
      this.#outgoingError = undefined
      if (scripted !== undefined) throw scripted
      if (input.accessToken.length === 0) {
        throw new PaymentsNetworkError('unauthorized', 'outgoing payment was refused')
      }
      const quote = this.#quotes.get(input.quoteId)
      if (quote === undefined) {
        throw new PaymentsNetworkError('rejected', 'quote was not found')
      }
      const id = this.#next('outgoing-payments')
      this.#outgoing.set(id, {
        debit: quote.debit,
        sent: money(0n, quote.debit.assetCode, quote.debit.assetScale),
        failed: false,
      })
      return { id }
    })
  }

  getOutgoingPayment(
    id: string,
    accessToken: string,
  ): Promise<{ id: string; status: 'pending' | 'paid' | 'failed'; sent: Money; debit: Money }> {
    return settle(() => {
      if (accessToken.length === 0) {
        throw new PaymentsNetworkError('unauthorized', 'outgoing payment was refused')
      }
      const payment = this.#requireOutgoing(id)
      const paid =
        !payment.failed &&
        payment.sent.assetCode === payment.debit.assetCode &&
        payment.sent.assetScale === payment.debit.assetScale &&
        payment.sent.amount === payment.debit.amount
      const status = payment.failed ? 'failed' : paid ? 'paid' : 'pending'
      return { id, status, sent: payment.sent, debit: payment.debit }
    })
  }

  getIncomingPayment(url: string): Promise<{ received: Money; completed: boolean }> {
    return settle(() => {
      const incoming = this.#requireIncoming(url)
      return { received: incoming.received, completed: incoming.completed }
    })
  }

  completeIncomingPayment(url: string): Promise<void> {
    return settle(() => {
      this.#requireIncoming(url).completed = true
    })
  }

  #requireIncoming(url: string): IncomingRecord {
    const incoming = this.#incoming.get(url)
    if (incoming === undefined) {
      throw new PaymentsNetworkError('rejected', 'incoming payment was not found')
    }
    return incoming
  }

  #requireOutgoing(id: string): OutgoingRecord {
    const payment = this.#outgoing.get(id)
    if (payment === undefined) {
      throw new PaymentsNetworkError('rejected', 'outgoing payment was not found')
    }
    return payment
  }

  #next(kind: string): string {
    this.#sequence += 1
    return `https://payments.invalid/${kind}/${this.#sequence.toString()}`
  }
}

function settle<T>(run: () => T): Promise<T> {
  try {
    return Promise.resolve(run())
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error('payments network failed'))
  }
}
