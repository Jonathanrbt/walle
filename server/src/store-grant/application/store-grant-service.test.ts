import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { PaymentsNetworkError } from '../../cash-in/payments-network.ts'
import { createQuoted } from '../../cash-in/domain/cash-in.ts'
import { DomainError } from '../../shared/errors.ts'
import { money } from '../../shared/money.ts'
import { Mutex } from '../../shared/mutex.ts'
import type { GrantGateway } from '../gateway.ts'
import type { StoredGrant, StoreGrantRepository } from '../repository.ts'
import { FakeGrantGateway, ManualClock } from '../../../test/fakes/fake-grant-gateway.ts'
import { createMemoryCashInRepository } from '../../../test/fakes/memory-cash-in-repository.ts'
import { createMemoryStoreGrantRepository } from '../../../test/fakes/memory-store-grant-repository.ts'
import { StoreGrantService, type TimeoutTimer } from './store-grant-service.ts'

const DAY_MS = 24 * 60 * 60 * 1000
const START = new Date('2026-10-17T00:00:00.000Z')

function finishHash(input: {
  readonly nonce: string
  readonly interactNonce: string
  readonly interactRef: string
  readonly grantEndpoint: string
}): string {
  return createHash('sha256')
    .update([input.nonce, input.interactNonce, input.interactRef, input.grantEndpoint].join('\n'))
    .digest('base64')
}

function harness(options?: { readonly ttlMs?: number; readonly limit?: string }) {
  const clock = new ManualClock(START)
  const ttlMs = options?.ttlMs ?? 120_000
  const inner = new FakeGrantGateway(clock, ttlMs)
  let finishCalls = 0
  let rotateCalls = 0
  let failRotate = false
  const seenStarts: unknown[] = []
  const gateway: GrantGateway = {
    start(input) {
      seenStarts.push(input)
      return inner.start(input)
    },
    finish(input) {
      finishCalls += 1
      return inner.finish(input)
    },
    rotate(input) {
      rotateCalls += 1
      if (failRotate) {
        return Promise.reject(new PaymentsNetworkError('unavailable', 'auth server down'))
      }
      return inner.rotate(input)
    },
  }
  const cashIns = createMemoryCashInRepository()
  const grants = createMemoryStoreGrantRepository(cashIns)
  let sequence = 0
  const service = new StoreGrantService({
    grants,
    gateway,
    clock,
    ids: { next: () => `nonce-${String(++sequence)}` },
    mutex: new Mutex(),
    dailyGrantLimitCop: options?.limit ?? '100.00',
    publicBaseUrl: 'http://localhost:3000/',
  })
  return {
    clock,
    service,
    grants,
    cashIns,
    seenStarts,
    setFailRotate(value: boolean) {
      failRotate = value
    },
    finishCalls: () => finishCalls,
    rotateCalls: () => rotateCalls,
  }
}

async function requirePending(grants: StoreGrantRepository): Promise<StoredGrant> {
  const pending = await grants.get()
  if (pending === undefined) throw new Error('grant was not stored')
  return pending
}

class ManualTimeouts implements TimeoutTimer {
  readonly #pending = new Map<number, () => void>()
  #next = 0

  start(_ms: number, onFire: () => void): () => void {
    const id = ++this.#next
    this.#pending.set(id, onFire)
    return () => {
      this.#pending.delete(id)
    }
  }

  armed(): number {
    return this.#pending.size
  }

  fireOldest(): void {
    const next = this.#pending.keys().next()
    if (next.done) throw new Error('no timeout armed')
    const onFire = this.#pending.get(next.value)
    this.#pending.delete(next.value)
    onFire?.()
  }
}

function rotationFlightHarness(grants?: StoreGrantRepository) {
  const clock = new ManualClock(START)
  const inner = new FakeGrantGateway(clock, 120_000)
  let rotateCalls = 0
  let parked: { resolve: () => void; reject: (error: unknown) => void } | undefined
  const gateway: GrantGateway = {
    start: (input) => inner.start(input),
    finish: (input) => inner.finish(input),
    rotate(input) {
      rotateCalls += 1
      return new Promise((resolve, reject) => {
        parked = {
          resolve() {
            resolve(inner.rotate(input))
          },
          reject,
        }
      })
    },
  }
  const store = grants ?? createMemoryStoreGrantRepository(createMemoryCashInRepository())
  const timer = new ManualTimeouts()
  const events: { name: string; version: number }[] = []
  let sequence = 0
  const service = new StoreGrantService({
    grants: store,
    gateway,
    clock,
    ids: { next: () => `nonce-${String(++sequence)}` },
    mutex: new Mutex(),
    dailyGrantLimitCop: '100.00',
    publicBaseUrl: 'http://localhost:3000',
    rotateTimeoutMs: 10_000,
    timer,
    onEvent(name, details) {
      events.push({ name, version: details.version })
    },
  })
  return {
    clock,
    service,
    grants: store,
    timer,
    events,
    rotateCalls: () => rotateCalls,
    settleRotation() {
      const current = parked
      if (current === undefined) throw new Error('rotation was not started')
      parked = undefined
      current.resolve()
    },
    failRotation(error: Error) {
      const current = parked
      if (current === undefined) throw new Error('rotation was not started')
      parked = undefined
      current.reject(error)
    },
  }
}

async function openActiveGrant(
  subject: { service: StoreGrantService; grants: StoreGrantRepository },
  interactRef = 'ref-flight',
): Promise<StoredGrant> {
  await subject.service.start()
  const pending = await requirePending(subject.grants)
  const hash = finishHash({
    nonce: pending.nonce,
    interactNonce: pending.interactNonce,
    interactRef,
    grantEndpoint: pending.grantEndpoint,
  })
  return subject.service.finish({ hash, interactRef })
}

async function activate(subject: ReturnType<typeof harness>, interactRef = 'ref-1') {
  const started = await subject.service.start()
  const pending = await requirePending(subject.grants)
  const hash = finishHash({
    nonce: pending.nonce,
    interactNonce: pending.interactNonce,
    interactRef,
    grantEndpoint: pending.grantEndpoint,
  })
  const active = await subject.service.finish({ hash, interactRef })
  return { started, pending, hash, interactRef, active }
}

describe('StoreGrantService', () => {
  it('starts a pending grant and finishes it into an active one', async () => {
    const subject = harness()
    const { started, pending, active } = await activate(subject)

    if (started.kind !== 'redirect') throw new Error('expected a redirect')
    expect(started.url).toMatch(/^https:\/\//)
    expect(pending.status).toBe('pending')
    expect(pending.version).toBe(1)
    expect(pending.nonce).toBe('nonce-1')
    expect(subject.seenStarts[0]).toMatchObject({
      finishUri: 'http://localhost:3000/api/grant/finish',
      nonce: 'nonce-1',
      interval: 'R/2026-10-17T00:00:00.000Z/P1D',
      limit: money(10_000n, 'COP', 2),
    })
    expect(active.status).toBe('active')
    expect(active.accessToken?.length).toBeGreaterThan(0)
    expect(active.manageUrl?.length).toBeGreaterThan(0)
    expect(active.grantExpiresAt?.toISOString()).toBe('2026-10-18T00:00:00.000Z')
    expect(subject.finishCalls()).toBe(1)
  })

  it('returns an already-active grant without starting another', async () => {
    const subject = harness()
    await activate(subject)
    const again = await subject.service.start()
    expect(again).toEqual({ kind: 'already_active' })
    expect(subject.seenStarts).toHaveLength(1)
  })

  it('rejects an invalid finish hash without calling the gateway', async () => {
    const subject = harness()
    await subject.service.start()
    const before = await requirePending(subject.grants)
    await expect(
      subject.service.finish({ hash: 'not-the-hash', interactRef: 'ref-1' }),
    ).rejects.toMatchObject({ code: 'invalid_finish' })
    expect(subject.finishCalls()).toBe(0)
    expect(await subject.grants.get()).toEqual(before)
  })

  it('treats a repeated finish as the active grant', async () => {
    const subject = harness()
    const { hash, interactRef, active } = await activate(subject)
    const again = await subject.service.finish({ hash, interactRef })
    expect(again).toEqual(active)
    expect(subject.finishCalls()).toBe(1)
  })

  it('reports missing, active, and expired, and resets spent at the interval boundary', async () => {
    const subject = harness()
    expect(await subject.service.status(subject.clock.now())).toEqual({ status: 'missing' })

    await subject.service.start()
    expect(await subject.service.status(subject.clock.now())).toEqual({ status: 'missing' })

    await activate(subject)
    const stored = await requirePending(subject.grants)
    if (stored.grantExpiresAt === undefined) throw new Error('expiry missing')
    await subject.grants.put(
      {
        ...stored,
        grantExpiresAt: new Date(stored.grantExpiresAt.getTime() + DAY_MS),
        version: stored.version + 1,
      },
      stored.version,
    )
    const quoted = createQuoted(
      {
        id: 'cash-1',
        cop: money(5_000n, 'COP', 2),
        usdc: money(1n, 'USDC', 2),
        copPerUsdc: money(4_000n, 'COP', 2),
        expiresAt: new Date('2026-10-17T02:00:00.000Z'),
        stellarAddress: 'GSTORE',
        customer: { phone: '300', fullName: 'Ada Lovelace', documentNumber: '123456' },
        incomingPaymentUrl: 'https://wallet.example.test/incoming/1',
        quoteId: 'quote-1',
      },
      { now: () => new Date('2026-10-17T01:00:00.000Z') },
    )
    await subject.cashIns.insert({ ...quoted, status: 'settling' })

    subject.clock.advance(2 * 60 * 60 * 1000)
    const during = await subject.service.status(subject.clock.now())
    expect(during.status).toBe('active')
    expect(during.spent).toEqual(money(5_000n, 'COP', 2))
    expect(during.limit).toEqual(money(10_000n, 'COP', 2))

    subject.clock.advance(22 * 60 * 60 * 1000)
    const nextWindow = await subject.service.status(subject.clock.now())
    expect(nextWindow.status).toBe('active')
    expect(nextWindow.spent).toEqual(money(0n, 'COP', 2))

    subject.clock.advance(DAY_MS)
    expect(await subject.service.status(subject.clock.now())).toMatchObject({ status: 'expired' })
  })

  it('accepts a debit that lands on the limit and rejects one cent over', async () => {
    const subject = harness()
    await activate(subject)
    await expect(subject.service.assertCapacity(money(10_000n, 'COP', 2))).resolves.toBeUndefined()
    await expect(subject.service.assertCapacity(money(10_001n, 'COP', 2))).rejects.toMatchObject({
      code: 'grant_exhausted',
    })
    const quoted = createQuoted(
      {
        id: 'spent-1',
        cop: money(4_000n, 'COP', 2),
        usdc: money(1n, 'USDC', 2),
        copPerUsdc: money(4_000n, 'COP', 2),
        expiresAt: new Date('2026-10-17T00:01:00.000Z'),
        stellarAddress: 'GSTORE',
        customer: { phone: '300', fullName: 'Ada Lovelace', documentNumber: '123456' },
        incomingPaymentUrl: 'https://wallet.example.test/incoming/spent',
        quoteId: 'quote-spent',
      },
      subject.clock,
    )
    await subject.cashIns.insert({ ...quoted, status: 'settling' })
    await expect(subject.service.assertCapacity(money(6_000n, 'COP', 2))).resolves.toBeUndefined()
    await expect(subject.service.assertCapacity(money(6_001n, 'COP', 2))).rejects.toMatchObject({
      code: 'grant_exhausted',
    })
  })

  it('rejects a grant whose interval is not a one-day window', async () => {
    const subject = harness()
    await activate(subject)
    const current = await subject.grants.get()
    if (current === undefined) throw new Error('grant missing')
    await subject.grants.put(
      { ...current, interval: 'P1M', version: current.version + 1 },
      current.version,
    )
    await expect(subject.service.status(subject.clock.now())).rejects.toMatchObject({
      code: 'invalid_amount',
    })
    await subject.grants.put(
      { ...current, interval: 'R/not-a-date/P1D', version: current.version + 2 },
      current.version + 1,
    )
    await expect(subject.service.status(subject.clock.now())).rejects.toMatchObject({
      code: 'invalid_amount',
    })
  })

  it('treats a missing grant as no_grant', async () => {
    const subject = harness()
    await expect(subject.service.assertCapacity(money(1n, 'COP', 2))).rejects.toMatchObject({
      code: 'no_grant',
    })
  })

  it('rotates a token that expires in under 60 seconds and leaves 60 seconds alone', async () => {
    const subject = harness()
    const { active } = await activate(subject)
    subject.clock.advance(60_000)
    const held = await subject.service.withAccessToken((token) => Promise.resolve(token))
    expect(held).toBe(active.accessToken)
    expect(subject.rotateCalls()).toBe(0)

    subject.clock.advance(1)
    const rotated = await subject.service.withAccessToken((token) => Promise.resolve(token))
    expect(rotated).not.toBe(active.accessToken)
    expect(subject.rotateCalls()).toBe(1)
    expect((await subject.grants.get())?.accessToken).toBe(rotated)
  })

  it('retries a rotation once after a version conflict', async () => {
    const clock = new ManualClock(START)
    const innerGateway = new FakeGrantGateway(clock, 120_000)
    let rotateCalls = 0
    const gateway: GrantGateway = {
      start: (input) => innerGateway.start(input),
      finish: (input) => innerGateway.finish(input),
      rotate(input) {
        rotateCalls += 1
        return innerGateway.rotate(input)
      },
    }
    const inner = createMemoryStoreGrantRepository(createMemoryCashInRepository())
    let armed = true
    const grants: StoreGrantRepository = {
      get: () => inner.get(),
      spentSince: (since) => inner.spentSince(since),
      async put(next, expected) {
        const current = await inner.get()
        const rotating =
          current?.status === 'active' &&
          next.accessToken !== undefined &&
          next.accessToken !== current.accessToken
        if (armed && rotating) {
          armed = false
          await inner.put(
            {
              ...current,
              updatedAt: new Date('2026-10-17T00:00:01.000Z'),
              version: current.version + 1,
            },
            current.version,
          )
          throw new DomainError('version_conflict', 'version conflict')
        }
        await inner.put(next, expected)
      },
    }
    let sequence = 0
    const service = new StoreGrantService({
      grants,
      gateway,
      clock,
      ids: { next: () => `nonce-${String(++sequence)}` },
      mutex: new Mutex(),
      dailyGrantLimitCop: '100.00',
      publicBaseUrl: 'http://localhost:3000',
    })
    await service.start()
    const pending = await grants.get()
    if (pending === undefined) throw new Error('pending missing')
    const interactRef = 'ref-conflict'
    const hash = finishHash({
      nonce: pending.nonce,
      interactNonce: pending.interactNonce,
      interactRef,
      grantEndpoint: pending.grantEndpoint,
    })
    const active = await service.finish({ hash, interactRef })
    clock.advance(61_000)
    const rotated = await service.withAccessToken((token) => Promise.resolve(token))
    expect(rotateCalls).toBe(1)
    expect(rotated).not.toBe(active.accessToken)
    expect((await grants.get())?.accessToken).toBe(rotated)
    expect((await grants.get())?.version).toBe(active.version + 2)
  })

  it('rotates once when concurrent callers share the mutex', async () => {
    const clock = new ManualClock(START)
    const inner = new FakeGrantGateway(clock, 120_000)
    let rotateCalls = 0
    const gateway: GrantGateway = {
      start: (input) => inner.start(input),
      finish: (input) => inner.finish(input),
      rotate: async (input) => {
        rotateCalls += 1
        await new Promise((resolve) => {
          setTimeout(resolve, 20)
        })
        return inner.rotate(input)
      },
    }
    const grants = createMemoryStoreGrantRepository(createMemoryCashInRepository())
    let sequence = 0
    const service = new StoreGrantService({
      grants,
      gateway,
      clock,
      ids: { next: () => `nonce-${String(++sequence)}` },
      mutex: new Mutex(),
      dailyGrantLimitCop: '100.00',
      publicBaseUrl: 'http://localhost:3000',
    })
    const started = await service.start()
    expect(started.kind).toBe('redirect')
    const pending = await grants.get()
    if (pending === undefined) throw new Error('pending missing')
    const interactRef = 'ref-concurrent'
    const hash = finishHash({
      nonce: pending.nonce,
      interactNonce: pending.interactNonce,
      interactRef,
      grantEndpoint: pending.grantEndpoint,
    })
    await service.finish({ hash, interactRef })
    clock.advance(61_000)

    const first = service.withAccessToken((token) => Promise.resolve(token))
    const second = service.withAccessToken((token) => Promise.resolve(token))
    const tokens = await Promise.all([first, second])
    expect(rotateCalls).toBe(1)
    expect(tokens[0]).toBe(tokens[1])
    expect((await grants.get())?.accessToken).toBe(tokens[0])
  })

  it('releases the mutex and leaves the grant untouched when rotation times out', async () => {
    const subject = rotationFlightHarness()
    const active = await openActiveGrant(subject, 'ref-timeout')
    subject.clock.advance(61_000)
    const before = await subject.grants.get()
    const hung = subject.service.withAccessToken((token) => Promise.resolve(token))
    await expect.poll(() => subject.timer.armed()).toBe(1)
    subject.timer.fireOldest()
    await expect(hung).rejects.toMatchObject({
      name: 'PaymentsNetworkError',
      kind: 'unavailable',
      message: 'token rotation timed out',
    })
    expect(await subject.grants.get()).toEqual(before)
    expect(before?.accessToken).toBe(active.accessToken)
    expect(subject.events).toEqual([{ name: 'rotation_timeout', version: active.version }])

    const joined = subject.service.withAccessToken((token) => Promise.resolve(token))
    await expect.poll(() => subject.timer.armed()).toBe(1)
    expect(subject.rotateCalls()).toBe(1)
    subject.timer.fireOldest()
    await expect(joined).rejects.toMatchObject({
      kind: 'unavailable',
      message: 'token rotation timed out',
    })
    expect(subject.rotateCalls()).toBe(1)
    expect(await subject.grants.get()).toEqual(before)
  })

  it('leaves the stored grant untouched when rotation fails', async () => {
    const subject = harness()
    const { active } = await activate(subject)
    subject.clock.advance(61_000)
    subject.setFailRotate(true)
    const before = await subject.grants.get()
    await expect(
      subject.service.withAccessToken((token) => Promise.resolve(token)),
    ).rejects.toMatchObject({ kind: 'unavailable' })
    expect(await subject.grants.get()).toEqual(before)
    expect(before?.accessToken).toBe(active.accessToken)
  })

  it('rotates once after an unauthorized payment call and retries it', async () => {
    const subject = harness()
    await activate(subject)
    let calls = 0
    const token = await subject.service.withAccessToken((accessToken) => {
      calls += 1
      if (calls === 1) {
        return Promise.reject(new PaymentsNetworkError('unauthorized', 'token was rejected'))
      }
      return Promise.resolve(accessToken)
    })
    expect(calls).toBe(2)
    expect(subject.rotateCalls()).toBe(1)
    expect(token).toBe((await subject.grants.get())?.accessToken)
  })

  it('does not rotate when the payment call fails for another reason', async () => {
    const subject = harness()
    const { active } = await activate(subject)
    await expect(
      subject.service.withAccessToken(() =>
        Promise.reject(new PaymentsNetworkError('rejected', 'quote was rejected')),
      ),
    ).rejects.toMatchObject({ kind: 'rejected' })
    expect(subject.rotateCalls()).toBe(0)
    expect((await subject.grants.get())?.accessToken).toBe(active.accessToken)
  })

  it('persists a rotation that succeeds after the caller timed out', async () => {
    const subject = rotationFlightHarness()
    const active = await openActiveGrant(subject, 'ref-late')
    subject.clock.advance(61_000)
    const hung = subject.service.withAccessToken((token) => Promise.resolve(token))
    await expect.poll(() => subject.timer.armed()).toBe(1)
    subject.timer.fireOldest()
    await expect(hung).rejects.toMatchObject({
      kind: 'unavailable',
      message: 'token rotation timed out',
    })

    const joined = subject.service.withAccessToken((token) => Promise.resolve(token))
    await expect.poll(() => subject.timer.armed()).toBe(1)
    expect(subject.rotateCalls()).toBe(1)
    subject.settleRotation()
    const token = await joined
    expect(token).not.toBe(active.accessToken)
    expect((await subject.grants.get())?.accessToken).toBe(token)
    expect(subject.rotateCalls()).toBe(1)
    expect(subject.events).toEqual([
      { name: 'rotation_timeout', version: active.version },
      { name: 'rotation_late_success', version: active.version + 1 },
    ])

    const again = await subject.service.withAccessToken((held) => Promise.resolve(held))
    expect(again).toBe(token)
    expect(subject.rotateCalls()).toBe(1)
  })

  it('lets a second caller join one slow rotation', async () => {
    const subject = rotationFlightHarness()
    await openActiveGrant(subject, 'ref-join')
    subject.clock.advance(61_000)
    const first = subject.service.withAccessToken((token) => Promise.resolve(token))
    await expect.poll(() => subject.timer.armed()).toBe(1)
    const second = subject.service.withAccessToken((token) => Promise.resolve(token))
    subject.settleRotation()
    const tokens = await Promise.all([first, second])
    expect(subject.rotateCalls()).toBe(1)
    expect(tokens[0]).toBe(tokens[1])
    expect((await subject.grants.get())?.accessToken).toBe(tokens[0])
    expect(subject.events).toEqual([])
  })

  it('does not let a late rotation overwrite a newer token', async () => {
    const subject = rotationFlightHarness()
    const active = await openActiveGrant(subject, 'ref-newer')
    subject.clock.advance(61_000)
    const hung = subject.service.withAccessToken((token) => Promise.resolve(token))
    await expect.poll(() => subject.timer.armed()).toBe(1)
    subject.timer.fireOldest()
    await expect(hung).rejects.toMatchObject({ kind: 'unavailable' })

    const current = await subject.grants.get()
    if (current === undefined) throw new Error('grant missing')
    const newerExpiry = new Date(subject.clock.now().getTime() + DAY_MS)
    await subject.grants.put(
      {
        ...current,
        accessToken: 'newer-access-token',
        manageUrl: 'https://grant.invalid/token/newer',
        tokenExpiresAt: newerExpiry,
        updatedAt: subject.clock.now(),
        version: current.version + 1,
      },
      current.version,
    )
    subject.settleRotation()
    await expect
      .poll(() => subject.events.some((event) => event.name === 'rotation_late_success'))
      .toBe(true)

    const stored = await subject.grants.get()
    expect(stored?.accessToken).toBe('newer-access-token')
    expect(stored?.manageUrl).toBe('https://grant.invalid/token/newer')
    expect(stored?.tokenExpiresAt?.toISOString()).toBe(newerExpiry.toISOString())
    expect(stored?.version).toBe(active.version + 1)
    expect(subject.rotateCalls()).toBe(1)
  })

  it('does not let a late rotation overwrite a newer token that expires sooner', async () => {
    const subject = rotationFlightHarness()
    const active = await openActiveGrant(subject, 'ref-sooner')
    subject.clock.advance(61_000)
    const hung = subject.service.withAccessToken((token) => Promise.resolve(token))
    await expect.poll(() => subject.timer.armed()).toBe(1)
    subject.timer.fireOldest()
    await expect(hung).rejects.toMatchObject({ kind: 'unavailable' })

    const current = await subject.grants.get()
    if (current === undefined) throw new Error('grant missing')
    const sooner = new Date(subject.clock.now().getTime() + 1_000)
    await subject.grants.put(
      {
        ...current,
        accessToken: 'newer-access-token',
        manageUrl: 'https://grant.invalid/token/sooner',
        tokenExpiresAt: sooner,
        updatedAt: subject.clock.now(),
        version: current.version + 1,
      },
      current.version,
    )
    subject.settleRotation()
    await expect
      .poll(() => subject.events.some((event) => event.name === 'rotation_late_success'))
      .toBe(true)

    const stored = await subject.grants.get()
    expect(stored?.accessToken).toBe('newer-access-token')
    expect(stored?.manageUrl).toBe('https://grant.invalid/token/sooner')
    expect(stored?.tokenExpiresAt?.toISOString()).toBe(sooner.toISOString())
    expect(stored?.version).toBe(active.version + 1)
  })

  it('leaves the stored grant when a timed-out rotation fails later', async () => {
    const subject = rotationFlightHarness()
    const active = await openActiveGrant(subject, 'ref-late-fail')
    subject.clock.advance(61_000)
    const before = await subject.grants.get()
    const hung = subject.service.withAccessToken((token) => Promise.resolve(token))
    await expect.poll(() => subject.timer.armed()).toBe(1)
    subject.timer.fireOldest()
    await expect(hung).rejects.toMatchObject({
      kind: 'unavailable',
      message: 'token rotation timed out',
    })

    subject.failRotation(new PaymentsNetworkError('unauthorized', 'token rotation was rejected'))
    await expect
      .poll(() => subject.events.some((event) => event.name === 'rotation_late_failure'))
      .toBe(true)
    expect(await subject.grants.get()).toEqual(before)
    expect(before?.accessToken).toBe(active.accessToken)
    expect(subject.events).toEqual([
      { name: 'rotation_timeout', version: active.version },
      { name: 'rotation_late_failure', version: active.version },
    ])

    const retry = subject.service.withAccessToken((token) => Promise.resolve(token))
    await expect.poll(() => subject.rotateCalls()).toBe(2)
    subject.settleRotation()
    const rotated = await retry
    expect(rotated).not.toBe(active.accessToken)
    expect((await subject.grants.get())?.accessToken).toBe(rotated)
  })

  it('retries a late rotation save once after a version conflict', async () => {
    const inner = createMemoryStoreGrantRepository(createMemoryCashInRepository())
    let armed = true
    let conflictPuts = 0
    const grants: StoreGrantRepository = {
      get: () => inner.get(),
      spentSince: (since) => inner.spentSince(since),
      async put(next, expected) {
        const current = await inner.get()
        const rotating =
          current?.status === 'active' &&
          next.accessToken !== undefined &&
          next.accessToken !== current.accessToken
        if (armed && rotating) {
          armed = false
          conflictPuts += 1
          await inner.put(
            {
              ...current,
              updatedAt: new Date('2026-10-17T00:01:02.000Z'),
              version: current.version + 1,
            },
            current.version,
          )
          throw new DomainError('version_conflict', 'version conflict')
        }
        await inner.put(next, expected)
      },
    }
    const subject = rotationFlightHarness(grants)
    const active = await openActiveGrant(subject, 'ref-late-conflict')
    subject.clock.advance(61_000)
    const hung = subject.service.withAccessToken((token) => Promise.resolve(token))
    await expect.poll(() => subject.timer.armed()).toBe(1)
    subject.timer.fireOldest()
    await expect(hung).rejects.toMatchObject({ kind: 'unavailable' })

    const joined = subject.service.withAccessToken((token) => Promise.resolve(token))
    await expect.poll(() => subject.timer.armed()).toBe(1)
    expect(subject.rotateCalls()).toBe(1)
    subject.settleRotation()
    const token = await joined
    expect(conflictPuts).toBe(1)
    expect(subject.rotateCalls()).toBe(1)
    expect(token).not.toBe(active.accessToken)
    expect((await subject.grants.get())?.accessToken).toBe(token)
    expect((await subject.grants.get())?.version).toBe(active.version + 2)
    expect(subject.events).toEqual([
      { name: 'rotation_timeout', version: active.version },
      { name: 'rotation_late_success', version: active.version + 2 },
    ])
  })
})
