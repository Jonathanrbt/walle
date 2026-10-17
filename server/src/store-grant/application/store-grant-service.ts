import { PaymentsNetworkError } from '../../cash-in/payments-network.ts'
import { DomainError } from '../../shared/errors.ts'
import { add, compare, parseDecimal, type Money } from '../../shared/money.ts'
import type { Mutex } from '../../shared/mutex.ts'
import type { Clock, IdGenerator } from '../../shared/ports.ts'
import { verifyFinishHash, type GrantGateway } from '../gateway.ts'
import type { StoredGrant, StoreGrantRepository } from '../repository.ts'
import { StoreGrantError } from './errors.ts'

const DAY_MS = 24 * 60 * 60 * 1000
const ROTATE_BEFORE_MS = 60_000
const DEFAULT_ROTATE_TIMEOUT_MS = 10_000

/** Starts a one-shot timer. The returned function cancels it. */
export interface TimeoutTimer {
  start(ms: number, onFire: () => void): () => void
}

export interface GrantSnapshot {
  readonly status: 'active' | 'missing' | 'expired'
  readonly limit?: Money
  readonly spent?: Money
  readonly expiresAt?: Date
}

export type StartResult =
  { readonly kind: 'already_active' } | { readonly kind: 'redirect'; readonly url: string }

export interface FinishInput {
  readonly hash: string
  readonly interactRef: string
}

export interface StoreGrantServiceDeps {
  readonly grants: StoreGrantRepository
  readonly gateway: GrantGateway
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly mutex: Mutex
  readonly dailyGrantLimitCop: string
  readonly publicBaseUrl: string
  readonly rotateTimeoutMs?: number
  readonly timer?: TimeoutTimer
}

export class StoreGrantService {
  readonly #grants: StoreGrantRepository
  readonly #gateway: GrantGateway
  readonly #clock: Clock
  readonly #ids: IdGenerator
  readonly #mutex: Mutex
  readonly #dailyGrantLimitCop: string
  readonly #publicBaseUrl: string
  readonly #rotateTimeoutMs: number
  readonly #timer: TimeoutTimer

  constructor(deps: StoreGrantServiceDeps) {
    this.#grants = deps.grants
    this.#gateway = deps.gateway
    this.#clock = deps.clock
    this.#ids = deps.ids
    this.#mutex = deps.mutex
    this.#dailyGrantLimitCop = deps.dailyGrantLimitCop
    this.#publicBaseUrl = deps.publicBaseUrl
    this.#rotateTimeoutMs = deps.rotateTimeoutMs ?? DEFAULT_ROTATE_TIMEOUT_MS
    this.#timer = deps.timer ?? defaultTimer()
  }

  start(): Promise<StartResult> {
    return this.#mutex.run(() => this.#start())
  }

  finish(input: FinishInput): Promise<StoredGrant> {
    return this.#mutex.run(() => this.#finish(input))
  }

  async status(now: Date): Promise<GrantSnapshot> {
    const current = await this.#grants.get()
    if (!isActive(current) || current.grantExpiresAt === undefined || current.limit === undefined) {
      return { status: 'missing' }
    }
    if (now.getTime() >= current.grantExpiresAt.getTime()) {
      return { status: 'expired', expiresAt: current.grantExpiresAt }
    }
    const spent = await this.#grants.spentSince(
      currentIntervalStart(anchorOf(current.interval), now),
    )
    return {
      status: 'active',
      limit: current.limit,
      spent,
      expiresAt: current.grantExpiresAt,
    }
  }

  async assertCapacity(debit: Money): Promise<void> {
    const snapshot = await this.status(this.#clock.now())
    if (
      snapshot.status !== 'active' ||
      snapshot.limit === undefined ||
      snapshot.spent === undefined
    ) {
      throw new StoreGrantError('no_grant', 'store grant is not active')
    }
    if (compare(add(snapshot.spent, debit), snapshot.limit) > 0) {
      throw new StoreGrantError('grant_exhausted', 'daily grant is exhausted')
    }
  }

  // The lock covers the payment call too: a rotation must not invalidate a token another caller is sending.
  withAccessToken<T>(fn: (token: string) => Promise<T>): Promise<T> {
    return this.#mutex.run(() => this.#withAccessToken(fn))
  }

  async #start(): Promise<StartResult> {
    const now = this.#clock.now()
    const existing = await this.#grants.get()
    if (existing !== undefined && isLive(existing, now)) return { kind: 'already_active' }

    const nonce = this.#ids.next()
    const interval = `R/${now.toISOString()}/P1D`
    const limit = parseDecimal(this.#dailyGrantLimitCop, 'COP', 2)
    const started = await this.#gateway.start({
      limit,
      finishUri: joinUrl(this.#publicBaseUrl, '/api/grant/finish'),
      nonce,
      interval,
    })
    const pending: StoredGrant = {
      status: 'pending',
      nonce,
      interactNonce: started.interactNonce,
      grantEndpoint: started.grantEndpoint,
      continueUri: started.continueUri,
      continueAccessToken: started.continueAccessToken,
      limit,
      interval,
      createdAt: now,
      updatedAt: now,
      version: existing === undefined ? 1 : existing.version + 1,
    }
    await this.#grants.put(pending, existing === undefined ? null : existing.version)
    return { kind: 'redirect', url: started.redirectUrl }
  }

  async #finish(input: FinishInput): Promise<StoredGrant> {
    const current = await this.#grants.get()
    if (current === undefined) throw new StoreGrantError('no_grant', 'store grant is missing')
    const valid = verifyFinishHash({
      nonce: current.nonce,
      interactNonce: current.interactNonce,
      interactRef: input.interactRef,
      grantEndpoint: current.grantEndpoint,
      hash: input.hash,
    })
    if (!valid) throw new StoreGrantError('invalid_finish', 'finish hash did not match')
    if (current.status === 'active') return current
    if (current.status !== 'pending') {
      throw new StoreGrantError('no_grant', 'store grant is not pending')
    }

    const finished = await this.#gateway.finish({
      continueUri: current.continueUri,
      continueAccessToken: current.continueAccessToken,
      interactRef: input.interactRef,
    })
    const authorizedAt = this.#clock.now()
    const active: StoredGrant = {
      ...current,
      status: 'active',
      accessToken: finished.accessToken,
      manageUrl: finished.manageUrl,
      tokenExpiresAt: finished.tokenExpiresAt,
      grantExpiresAt: new Date(authorizedAt.getTime() + DAY_MS),
      updatedAt: authorizedAt,
      version: current.version + 1,
    }
    await this.#grants.put(active, current.version)
    return active
  }

  async #withAccessToken<T>(fn: (token: string) => Promise<T>): Promise<T> {
    let grant = await this.#requireLive()
    if (expiresSoon(grant, this.#clock.now())) grant = await this.#rotate(grant)
    try {
      return await fn(accessTokenOf(grant))
    } catch (error) {
      if (!isUnauthorized(error)) throw error
      const latest = await this.#requireLive()
      const rotated = await this.#rotate(latest)
      return fn(accessTokenOf(rotated))
    }
  }

  async #requireLive(): Promise<StoredGrant> {
    const current = await this.#grants.get()
    if (current === undefined || !isLive(current, this.#clock.now())) {
      throw new StoreGrantError('no_grant', 'store grant is not active')
    }
    return current
  }

  async #rotate(current: StoredGrant): Promise<StoredGrant> {
    const accessToken = current.accessToken
    const manageUrl = current.manageUrl
    if (accessToken === undefined || manageUrl === undefined) {
      throw new StoreGrantError('no_grant', 'store grant has no access token')
    }
    const rotated = await withDeadline(
      this.#gateway.rotate({ manageUrl, accessToken }),
      this.#rotateTimeoutMs,
      this.#timer,
    )
    return this.#persistRotation(current, rotated)
  }

  async #persistRotation(
    current: StoredGrant,
    rotated: { accessToken: string; manageUrl: string; tokenExpiresAt: Date },
  ): Promise<StoredGrant> {
    const write = (base: StoredGrant): StoredGrant => ({
      ...base,
      accessToken: rotated.accessToken,
      manageUrl: rotated.manageUrl,
      tokenExpiresAt: rotated.tokenExpiresAt,
      updatedAt: this.#clock.now(),
      version: base.version + 1,
    })
    const next = write(current)
    try {
      await this.#grants.put(next, current.version)
      return next
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== 'version_conflict') throw error
      const latest = await this.#grants.get()
      if (latest === undefined || !isLive(latest, this.#clock.now())) throw error
      const retry = write(latest)
      await this.#grants.put(retry, latest.version)
      return retry
    }
  }
}

function defaultTimer(): TimeoutTimer {
  return {
    start(ms, onFire) {
      const handle = setTimeout(onFire, ms)
      return () => {
        clearTimeout(handle)
      }
    },
  }
}

function withDeadline<T>(work: Promise<T>, ms: number, timer: TimeoutTimer): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false
    const cancel = timer.start(ms, () => {
      if (settled) return
      settled = true
      reject(new PaymentsNetworkError('unavailable', 'token rotation timed out'))
    })
    const finish = (settle: () => void): void => {
      if (settled) return
      settled = true
      cancel()
      settle()
    }
    work.then(
      (value) => {
        finish(() => {
          resolve(value)
        })
      },
      (error: unknown) => {
        finish(() => {
          reject(error instanceof Error ? error : new Error('token rotation failed'))
        })
      },
    )
  })
}

function isActive(grant: StoredGrant | undefined): grant is StoredGrant {
  return grant?.status === 'active'
}

function isLive(grant: StoredGrant, now: Date): boolean {
  return (
    grant.status === 'active' &&
    grant.grantExpiresAt !== undefined &&
    grant.limit !== undefined &&
    now.getTime() < grant.grantExpiresAt.getTime()
  )
}

function expiresSoon(grant: StoredGrant, now: Date): boolean {
  if (grant.tokenExpiresAt === undefined) return true
  return grant.tokenExpiresAt.getTime() - now.getTime() < ROTATE_BEFORE_MS
}

function accessTokenOf(grant: StoredGrant): string {
  if (grant.accessToken === undefined) {
    throw new StoreGrantError('no_grant', 'store grant has no access token')
  }
  return grant.accessToken
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof PaymentsNetworkError && error.kind === 'unauthorized'
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, '')}${path}`
}

function anchorOf(interval: string): Date {
  const matched = /^R\/(.+)\/P1D$/.exec(interval)?.[1]
  if (matched === undefined) {
    throw new DomainError('invalid_amount', 'grant interval is not a one-day window')
  }
  const anchor = new Date(matched)
  if (Number.isNaN(anchor.getTime())) {
    throw new DomainError('invalid_amount', 'grant interval start is not a date')
  }
  return anchor
}

function currentIntervalStart(anchor: Date, now: Date): Date {
  const days = Math.floor((now.getTime() - anchor.getTime()) / DAY_MS)
  return new Date(anchor.getTime() + days * DAY_MS)
}
