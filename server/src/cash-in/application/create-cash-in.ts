import { checkCashIn } from '../../compliance/policy.ts'
import { quoteUsdc } from '../../pricing/quote.ts'
import type { RateProvider } from '../../pricing/rate-provider.ts'
import { DomainError } from '../../shared/errors.ts'
import { isZero, parseDecimal, rescale, type Money } from '../../shared/money.ts'
import type { Mutex } from '../../shared/mutex.ts'
import type { Clock, IdGenerator } from '../../shared/ports.ts'
import type { StoreGrantService } from '../../store-grant/application/store-grant-service.ts'
import { StellarError } from '../../treasury/usdc-network.ts'
import type { UsdcNetwork } from '../../treasury/usdc-network.ts'
import { createQuoted, type CashIn } from '../domain/cash-in.ts'
import { PaymentsNetworkError, type PaymentsNetwork } from '../payments-network.ts'
import type { CashInRepository } from '../repository.ts'
import { CashInError } from './errors.ts'

const QUOTE_TTL_MS = 60_000
/** 31.77 COP. Below this the testnet quote receive amount is not positive. */
const MIN_COP_MINOR = 3177n
const STELLAR_ADDRESS = /^G[A-Z2-7]{55}$/

export interface CashInLogger {
  error(fields: Readonly<Record<string, string>>, message: string): void
}

export interface CreateCashInInput {
  readonly copAmount: string
  readonly stellarAddress: string
  readonly customer: {
    readonly phone: string
    readonly fullName: string
    readonly documentNumber: string
  }
  readonly idempotencyKey?: string
}

export interface CreateCashInDeps {
  readonly cashIns: CashInRepository
  readonly payments: PaymentsNetwork
  readonly usdc: UsdcNetwork
  readonly rate: RateProvider
  readonly storeGrant: Pick<StoreGrantService, 'assertCapacity'>
  readonly clock: Clock
  readonly ids: IdGenerator
  /**
   * One lock for the whole creation. In a single process this serializes the limit,
   * inventory, and grant-capacity checks so two concurrent requests cannot both pass
   * on the last unit of capacity.
   */
  readonly mutex: Mutex
  readonly log?: CashInLogger
}

const consoleLog: CashInLogger = {
  error(fields, message) {
    console.error(message, fields.receive, fields.usdc)
  },
}

export class CreateCashIn {
  readonly #cashIns: CashInRepository
  readonly #payments: PaymentsNetwork
  readonly #usdc: UsdcNetwork
  readonly #rate: RateProvider
  readonly #storeGrant: Pick<StoreGrantService, 'assertCapacity'>
  readonly #clock: Clock
  readonly #ids: IdGenerator
  readonly #mutex: Mutex
  readonly #log: CashInLogger

  constructor(deps: CreateCashInDeps) {
    this.#cashIns = deps.cashIns
    this.#payments = deps.payments
    this.#usdc = deps.usdc
    this.#rate = deps.rate
    this.#storeGrant = deps.storeGrant
    this.#clock = deps.clock
    this.#ids = deps.ids
    this.#mutex = deps.mutex
    this.#log = deps.log ?? consoleLog
  }

  create(input: CreateCashInInput): Promise<CashIn> {
    return this.#mutex.run(() => this.#create(input))
  }

  async #create(input: CreateCashInInput): Promise<CashIn> {
    const body = canonicalBody(input)
    const key = blankToUndefined(input.idempotencyKey)
    if (key !== undefined) {
      const existing = await this.#replay(key, body)
      if (existing !== undefined) return existing
    }

    const cop = parseCopAmount(input.copAmount)
    if (!STELLAR_ADDRESS.test(input.stellarAddress)) {
      throw new CashInError('invalid_request', 'stellar address has the wrong shape')
    }

    const rate = await this.#rate.current()
    const usdc = quoteUsdc({ cop, copPerUsdc: rate.copPerUsdc })
    if (isZero(usdc)) throw new CashInError('invalid_request', 'quoted USDC is zero')

    const now = this.#clock.now()
    const usage = await this.#cashIns.usageFor(input.customer.documentNumber, now)
    const decision = checkCashIn({ cop, usdc, usage })
    if (!decision.ok) throw new CashInError('limit_exceeded', decision.detail)

    await this.#storeGrant.assertCapacity(cop)
    await this.#destination(input.stellarAddress)
    await this.#reserve(usdc, now)

    const incoming = await this.#incoming()
    const quote = await this.#quote(incoming.url, cop)
    this.#requireReceiveCovers(quote.receive, usdc)

    const cap = new Date(now.getTime() + QUOTE_TTL_MS)
    const expiresAt = quote.expiresAt.getTime() < cap.getTime() ? quote.expiresAt : cap
    const cashIn = createQuoted(
      {
        id: this.#ids.next(),
        cop,
        usdc,
        copPerUsdc: rate.copPerUsdc,
        expiresAt,
        stellarAddress: input.stellarAddress,
        customer: input.customer,
        incomingPaymentUrl: incoming.url,
        quoteId: quote.id,
      },
      this.#clock,
    )
    return this.#insert(cashIn, key, body)
  }

  async #replay(key: string, body: string): Promise<CashIn | undefined> {
    const existing = await this.#cashIns.findIdempotency(key)
    if (existing === undefined) return undefined
    if (existing.body !== body) {
      throw new CashInError('invalid_request', 'idempotency key was used with a different request')
    }
    return existing.cashIn
  }

  async #destination(address: string): Promise<void> {
    const check = await callUsdc(() => this.#usdc.validateDestination(address))
    if (!check.ok) throw new CashInError('invalid_address', check.reason)
  }

  async #reserve(usdc: Money, now: Date): Promise<void> {
    const balance = await callUsdc(() => this.#usdc.balance())
    const reserved = await this.#cashIns.reservedUsdc(now)
    if (!inventoryCovers(balance, reserved, usdc)) {
      throw new CashInError('insufficient_inventory', 'USDC inventory does not cover the quote')
    }
  }

  async #incoming(): Promise<{ url: string; expiresAt: Date }> {
    try {
      return await this.#payments.createIncomingPayment({})
    } catch (error) {
      throw mapPayments(error)
    }
  }

  async #quote(
    incomingPaymentUrl: string,
    debit: Money,
  ): Promise<{ id: string; receive: Money; expiresAt: Date }> {
    try {
      return await this.#payments.createQuote({ incomingPaymentUrl, debit })
    } catch (error) {
      throw mapPayments(error)
    }
  }

  #requireReceiveCovers(receive: Money, usdc: Money): void {
    if (minorAtScale2(receive) >= minorAtScale2(usdc)) return
    this.#log.error(
      { receive: receive.amount.toString(), usdc: usdc.amount.toString() },
      'quote receive is below the USDC amount',
    )
    throw new CashInError('internal_error')
  }

  async #insert(cashIn: CashIn, key: string | undefined, body: string): Promise<CashIn> {
    const record = key === undefined ? undefined : { key, body }
    try {
      await this.#cashIns.insert(cashIn, record)
      return cashIn
    } catch (error) {
      if (record === undefined || !isVersionConflict(error)) throw error
      const again = await this.#cashIns.findIdempotency(record.key)
      if (again === undefined) throw error
      if (again.body !== record.body) {
        throw new CashInError(
          'invalid_request',
          'idempotency key was used with a different request',
        )
      }
      return again.cashIn
    }
  }
}

export function canonicalBody(input: CreateCashInInput): string {
  return JSON.stringify({
    copAmount: input.copAmount,
    stellarAddress: input.stellarAddress,
    customer: {
      phone: input.customer.phone,
      fullName: input.customer.fullName,
      documentNumber: input.customer.documentNumber,
    },
  })
}

function blankToUndefined(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) return undefined
  return value
}

function parseCopAmount(text: string): Money {
  let cop: Money
  try {
    cop = parseDecimal(text, 'COP', 2)
  } catch (error) {
    if (error instanceof DomainError) throw new CashInError('invalid_request', error.message)
    throw error
  }
  if (cop.amount < MIN_COP_MINOR) {
    throw new CashInError('invalid_request', 'cash amount must be at least 31.77 COP')
  }
  return cop
}

async function callUsdc<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body()
  } catch (error) {
    if (error instanceof StellarError) throw new CashInError('backend_down', error.detail)
    throw error
  }
}

function inventoryCovers(balance: Money, reserved: Money, needed: Money): boolean {
  if (
    balance.assetCode !== 'USDC' ||
    reserved.assetCode !== 'USDC' ||
    needed.assetCode !== 'USDC'
  ) {
    throw new CashInError('internal_error')
  }
  const reservedMinor = minorAt(reserved, balance.assetScale)
  const neededMinor = minorAt(needed, balance.assetScale)
  return balance.amount >= reservedMinor + neededMinor
}

function minorAt(value: Money, scale: number): bigint {
  try {
    return rescale(value, scale, 'exact').amount
  } catch (error) {
    if (error instanceof DomainError) throw new CashInError('internal_error')
    throw error
  }
}

function minorAtScale2(value: Money): bigint {
  try {
    return rescale(value, 2, 'exact').amount
  } catch (error) {
    if (error instanceof DomainError) throw new CashInError('internal_error')
    throw error
  }
}

function mapPayments(error: unknown): unknown {
  if (!(error instanceof PaymentsNetworkError)) return error
  switch (error.kind) {
    case 'rejected':
      return new CashInError('invalid_request', error.detail)
    case 'unauthorized':
    case 'unavailable':
      return new CashInError('backend_down', error.detail)
    default: {
      const unexpected: never = error.kind
      return unexpected
    }
  }
}

function isVersionConflict(error: unknown): boolean {
  return error instanceof DomainError && error.code === 'version_conflict'
}
