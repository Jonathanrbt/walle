import type { CashIn } from '../../cash-in/domain/cash-in.ts'
import type { CashInRepository } from '../../cash-in/repository.ts'
import { compare, money, parseDecimal, type Money } from '../../shared/money.ts'
import type { Mutex } from '../../shared/mutex.ts'
import type { Clock } from '../../shared/ports.ts'
import { StellarError, type UsdcNetwork } from '../usdc-network.ts'
import { OperatorError } from './errors.ts'

/** One displayed cent is 10^5 stroops: chain USDC is scale 7, reservations are scale 2. */
const STROOPS_PER_CENT = 10n ** 5n

const ALREADY_AT_TARGET = 'operator USDC is already at the target'

export interface OperatorInventory {
  readonly usdc: Money
  readonly floatUsdc: Money
  readonly lowThresholdPct: number
  /** Scale-2 available balance before the zero clamp. Negative when reservations exceed the chain. */
  readonly log: { readonly rawAvailable: bigint }
}

export interface RefillOutcome {
  readonly usdc: Money
}

export interface OperatorService {
  listCashIns(limit?: number): Promise<readonly CashIn[]>
  inventory(): Promise<OperatorInventory>
  refill(): Promise<RefillOutcome>
}

export interface OperatorServiceDeps {
  readonly cashIns: CashInRepository
  readonly usdcNetwork: UsdcNetwork
  readonly clock: Clock
  readonly mutex: Mutex
  readonly usdcFloat: string
  readonly lowThresholdPct: number
}

export function createOperatorService(deps: OperatorServiceDeps): OperatorService {
  return new OperatorApplication(deps)
}

class OperatorApplication implements OperatorService {
  readonly #cashIns: CashInRepository
  readonly #usdcNetwork: UsdcNetwork
  readonly #clock: Clock
  readonly #mutex: Mutex
  readonly #floatUsdc: Money
  readonly #lowThresholdPct: number

  constructor(deps: OperatorServiceDeps) {
    this.#cashIns = deps.cashIns
    this.#usdcNetwork = deps.usdcNetwork
    this.#clock = deps.clock
    this.#mutex = deps.mutex
    this.#floatUsdc = parseDecimal(deps.usdcFloat, 'USDC', 2)
    this.#lowThresholdPct = deps.lowThresholdPct
  }

  listCashIns(limit = 50): Promise<readonly CashIn[]> {
    return this.#cashIns.listRecent(limit)
  }

  async inventory(): Promise<OperatorInventory> {
    const available = await this.#available()
    return {
      usdc: available.usdc,
      floatUsdc: this.#floatUsdc,
      lowThresholdPct: this.#lowThresholdPct,
      log: { rawAvailable: available.raw },
    }
  }

  refill(): Promise<RefillOutcome> {
    return this.#mutex.run(() => this.#refill())
  }

  async #refill(): Promise<RefillOutcome> {
    const current = await this.#available()
    if (compare(current.usdc, this.#floatUsdc) >= 0) return { usdc: current.usdc }
    try {
      await this.#usdcNetwork.refill({ targetUsdc: this.#floatUsdc })
    } catch (error) {
      if (!isAlreadyAtTarget(error)) throw asBackendDown(error)
    }
    const after = await this.#available()
    return { usdc: after.usdc }
  }

  async #available(): Promise<{ readonly usdc: Money; readonly raw: bigint }> {
    let balance: Money
    try {
      balance = await this.#usdcNetwork.balance()
    } catch (error) {
      throw asBackendDown(error)
    }
    const reserved = await this.#cashIns.reservedUsdc(this.#clock.now())
    return availableUsdc(balance, reserved)
  }
}

function availableUsdc(
  balance: Money,
  reserved: Money,
): { readonly usdc: Money; readonly raw: bigint } {
  if (balance.assetCode !== 'USDC' || balance.assetScale !== 7) {
    throw new OperatorError('backend_down', 'USDC balance is not scale 7')
  }
  if (reserved.assetCode !== 'USDC' || reserved.assetScale !== 2) {
    throw new OperatorError('backend_down', 'reserved USDC is not scale 2')
  }
  const raw = floorDiv(balance.amount - reserved.amount * STROOPS_PER_CENT, STROOPS_PER_CENT)
  return { usdc: money(raw < 0n ? 0n : raw, 'USDC', 2), raw }
}

function isAlreadyAtTarget(error: unknown): boolean {
  return (
    error instanceof StellarError && error.kind === 'invalid' && error.detail === ALREADY_AT_TARGET
  )
}

function asBackendDown(error: unknown): OperatorError {
  if (error instanceof StellarError) {
    switch (error.kind) {
      case 'no_path':
      case 'unavailable':
      case 'operator_not_ready':
        return new OperatorError('backend_down', error.detail)
      case 'invalid':
        return new OperatorError('backend_down', error.detail)
    }
  }
  return new OperatorError('backend_down')
}

function floorDiv(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator
  const remainder = numerator % denominator
  if (remainder !== 0n && numerator < 0n) return quotient - 1n
  return quotient
}
