import { PaymentsNetworkError } from '../../src/cash-in/payments-network.ts'
import type { Money } from '../../src/shared/money.ts'
import type { GrantGateway } from '../../src/store-grant/gateway.ts'

export class ManualClock {
  #now: Date

  constructor(start: Date) {
    this.#now = new Date(start.getTime())
  }

  now(): Date {
    return new Date(this.#now.getTime())
  }

  advance(ms: number): void {
    this.#now = new Date(this.#now.getTime() + ms)
  }
}

interface PendingGrant {
  readonly continueAccessToken: string
}

interface LiveToken {
  readonly accessToken: string
  readonly expiresAt: number
}

export class FakeGrantGateway implements GrantGateway {
  readonly #clock: ManualClock
  readonly #ttlMs: number
  #sequence = 0
  readonly #pending = new Map<string, PendingGrant>()
  readonly #tokens = new Map<string, LiveToken>()

  constructor(clock: ManualClock, ttlMs: number) {
    if (ttlMs <= 0) throw new PaymentsNetworkError('rejected', 'token lifetime must be positive')
    this.#clock = clock
    this.#ttlMs = ttlMs
  }

  start(input: { limit: Money; finishUri: string; nonce: string; interval: string }): Promise<{
    redirectUrl: string
    continueUri: string
    continueAccessToken: string
    interactNonce: string
    waitSeconds: number
  }> {
    return settle(() => {
      if (
        input.limit.assetCode !== 'COP' ||
        input.limit.assetScale !== 2 ||
        input.limit.amount <= 0n
      ) {
        throw new PaymentsNetworkError('rejected', 'grant limit does not match the store wallet')
      }
      if (input.nonce.length === 0 || input.finishUri.length === 0 || input.interval.length === 0) {
        throw new PaymentsNetworkError('rejected', 'grant request was incomplete')
      }
      const id = this.#next()
      const continueUri = `https://grant.invalid/continue/${id}`
      const continueAccessToken = `continue-${id}`
      this.#pending.set(continueUri, { continueAccessToken })
      return {
        redirectUrl: `https://grant.invalid/interact/${id}`,
        continueUri,
        continueAccessToken,
        interactNonce: `finish-${id}`,
        waitSeconds: 0,
      }
    })
  }

  finish(input: {
    continueUri: string
    continueAccessToken: string
    interactRef: string
  }): Promise<{ accessToken: string; manageUrl: string; tokenExpiresAt: Date }> {
    return settle(() => {
      const pending = this.#pending.get(input.continueUri)
      if (
        pending?.continueAccessToken !== input.continueAccessToken ||
        input.interactRef.length === 0
      ) {
        throw new PaymentsNetworkError('unauthorized', 'continuation was rejected')
      }
      this.#pending.delete(input.continueUri)
      return this.#issue()
    })
  }

  rotate(input: {
    manageUrl: string
    accessToken: string
  }): Promise<{ accessToken: string; manageUrl: string; tokenExpiresAt: Date }> {
    return settle(() => {
      const current = this.#tokens.get(input.manageUrl)
      if (current?.accessToken !== input.accessToken) {
        throw new PaymentsNetworkError('unauthorized', 'token rotation was rejected')
      }
      if (this.#clock.now().getTime() >= current.expiresAt) {
        this.#tokens.delete(input.manageUrl)
        throw new PaymentsNetworkError('unauthorized', 'token rotation was rejected')
      }
      this.#tokens.delete(input.manageUrl)
      return this.#issue()
    })
  }

  #issue(): { accessToken: string; manageUrl: string; tokenExpiresAt: Date } {
    const id = this.#next()
    const accessToken = `access-${id}`
    const manageUrl = `https://grant.invalid/token/${id}`
    const tokenExpiresAt = new Date(this.#clock.now().getTime() + this.#ttlMs)
    this.#tokens.set(manageUrl, { accessToken, expiresAt: tokenExpiresAt.getTime() })
    return { accessToken, manageUrl, tokenExpiresAt }
  }

  #next(): string {
    this.#sequence += 1
    return this.#sequence.toString()
  }
}

function settle<T>(run: () => T): Promise<T> {
  try {
    return Promise.resolve(run())
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error('grant gateway failed'))
  }
}
