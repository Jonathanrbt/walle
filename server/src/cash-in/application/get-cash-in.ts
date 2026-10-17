import { DomainError } from '../../shared/errors.ts'
import type { Clock } from '../../shared/ports.ts'
import type { CashIn } from '../domain/cash-in.ts'
import { transition } from '../domain/transitions.ts'
import type { CashInRepository } from '../repository.ts'
import { CashInError } from './errors.ts'

export interface GetCashInDeps {
  readonly cashIns: CashInRepository
  readonly clock: Clock
}

export class GetCashIn {
  readonly #cashIns: CashInRepository
  readonly #clock: Clock

  constructor(deps: GetCashInDeps) {
    this.#cashIns = deps.cashIns
    this.#clock = deps.clock
  }

  async get(id: string): Promise<CashIn> {
    const found = await this.#require(id)
    if (!isDue(found, this.#clock.now())) return found
    const now = this.#clock.now()
    const expired = transition(found, { type: 'Expire' }, now)
    try {
      await this.#cashIns.save(expired, found.version)
      return expired
    } catch (error) {
      if (!isVersionConflict(error)) throw error
      return this.#require(id)
    }
  }

  async #require(id: string): Promise<CashIn> {
    const found = await this.#cashIns.get(id)
    if (found === undefined) throw new CashInError('not_found', 'cash-in was not found')
    return found
  }
}

function isDue(cashIn: CashIn, now: Date): boolean {
  return cashIn.status === 'quoted' && cashIn.expiresAt.getTime() <= now.getTime()
}

function isVersionConflict(error: unknown): boolean {
  return error instanceof DomainError && error.code === 'version_conflict'
}
