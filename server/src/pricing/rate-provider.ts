import { applySpread } from './quote.ts'
import { parseDecimal, type Money } from '../shared/money.ts'
import type { Clock } from '../shared/ports.ts'

export interface RateQuote {
  readonly copPerUsdc: Money
  readonly spreadPct: string
  readonly quotedAt: Date
}

export interface RateProvider {
  current(): Promise<RateQuote>
}

export class ConfiguredRateProvider implements RateProvider {
  readonly #referenceCopPerUsd: string
  readonly #spreadPct: string
  readonly #clock: Clock

  constructor(
    business: { readonly referenceCopPerUsd: string; readonly spreadPct: string },
    clock: Clock,
  ) {
    this.#referenceCopPerUsd = business.referenceCopPerUsd
    this.#spreadPct = business.spreadPct
    this.#clock = clock
  }

  current(): Promise<RateQuote> {
    const mid = parseDecimal(this.#referenceCopPerUsd, 'COP', 2)
    return Promise.resolve({
      copPerUsdc: applySpread(mid, this.#spreadPct),
      spreadPct: this.#spreadPct,
      quotedAt: this.#clock.now(),
    })
  }
}
