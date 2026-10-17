import { describe, expect, it } from 'vitest'
import type { CashInRepository } from '../../src/cash-in/repository.ts'
import type { CashIn, CashInStatus } from '../../src/cash-in/domain/cash-in.ts'
import type { StoredGrant, StoreGrantRepository } from '../../src/store-grant/repository.ts'
import { DomainError } from '../../src/shared/errors.ts'
import { money } from '../../src/shared/money.ts'

export interface StoreGrantRepositorySubject {
  readonly grants: StoreGrantRepository
  readonly cashIns: CashInRepository
  close(): void
}

const HUGE = 2n ** 53n + 1n

function grant(
  overrides: Partial<StoredGrant> & Pick<StoredGrant, 'version' | 'status'>,
): StoredGrant {
  const accessToken = overrides.accessToken
  const manageUrl = overrides.manageUrl
  const tokenExpiresAt = overrides.tokenExpiresAt
  const limit = overrides.limit
  const grantExpiresAt = overrides.grantExpiresAt
  return {
    status: overrides.status,
    nonce: overrides.nonce ?? 'nonce-1',
    continueUri: overrides.continueUri ?? 'https://wallet.example.test/continue',
    continueAccessToken: overrides.continueAccessToken ?? 'continue-token',
    interval: overrides.interval ?? 'P1M',
    createdAt: overrides.createdAt ?? new Date('2026-10-17T00:00:00.000Z'),
    updatedAt: overrides.updatedAt ?? new Date('2026-10-17T00:00:00.000Z'),
    version: overrides.version,
    ...(accessToken !== undefined ? { accessToken } : {}),
    ...(manageUrl !== undefined ? { manageUrl } : {}),
    ...(tokenExpiresAt !== undefined ? { tokenExpiresAt } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(grantExpiresAt !== undefined ? { grantExpiresAt } : {}),
  }
}

function cashIn(input: {
  readonly id: string
  readonly status: CashInStatus
  readonly cop: bigint
  readonly createdAt: string
  readonly outgoingPaymentId?: string
}): CashIn {
  const createdAt = new Date(input.createdAt)
  const outgoing = input.outgoingPaymentId
  return {
    id: input.id,
    status: input.status,
    cop: money(input.cop, 'COP', 2),
    usdc: money(10n, 'USDC', 2),
    copPerUsdc: money(4_000n, 'COP', 2),
    expiresAt: new Date(createdAt.getTime() + 60_000),
    stellarAddress: 'GSTORE',
    memo: `WALLE-${input.id}`,
    customer: { phone: '300', fullName: 'Ada', documentNumber: 'DOC-A' },
    openPayments: {
      incomingPaymentUrl: `https://wallet.example.test/incoming/${input.id}`,
      quoteId: `quote-${input.id}`,
      incomingCompleted: false,
      ...(outgoing !== undefined ? { outgoingPaymentId: outgoing } : {}),
    },
    createdAt,
    updatedAt: createdAt,
    version: 1,
  }
}

async function withSubject(
  makeSubject: () => Promise<StoreGrantRepositorySubject>,
  run: (subject: StoreGrantRepositorySubject) => Promise<void>,
): Promise<void> {
  const subject = await makeSubject()
  try {
    await run(subject)
  } finally {
    subject.close()
  }
}

export function runStoreGrantRepositoryContract(
  name: string,
  makeSubject: () => Promise<StoreGrantRepositorySubject>,
): void {
  describe(name, () => {
    it('stores one grant and round-trips secrets and optional fields', async () => {
      await withSubject(makeSubject, async ({ grants }) => {
        expect(await grants.get()).toBeUndefined()
        const pending = grant({ status: 'pending', version: 1 })
        await grants.put(pending, null)
        expect(await grants.get()).toEqual(pending)
        expect((await grants.get())?.accessToken).toBeUndefined()
        expect((await grants.get())?.limit).toBeUndefined()

        const active = grant({
          status: 'active',
          version: 2,
          nonce: 'nonce-2',
          continueUri: 'https://wallet.example.test/continue/2',
          continueAccessToken: 'continue-secret',
          accessToken: 'access-secret',
          manageUrl: 'https://wallet.example.test/manage',
          tokenExpiresAt: new Date('2026-10-18T00:00:00.123Z'),
          limit: money(HUGE, 'COP', 2),
          interval: 'P1D',
          grantExpiresAt: new Date('2026-11-17T00:00:00.000Z'),
          createdAt: new Date('2026-10-17T00:00:00.000Z'),
          updatedAt: new Date('2026-10-17T01:02:03.004Z'),
        })
        await grants.put(active, 1)
        expect(await grants.get()).toEqual(active)
        expect((await grants.get())?.limit?.amount).toBe(HUGE)
        expect((await grants.get())?.continueAccessToken).toBe('continue-secret')
        expect((await grants.get())?.accessToken).toBe('access-secret')

        const cleared = grant({ status: 'revoked', version: 3, nonce: 'nonce-3' })
        await grants.put(cleared, 2)
        expect(await grants.get()).toEqual(cleared)
        expect((await grants.get())?.accessToken).toBeUndefined()
        expect((await grants.get())?.limit).toBeUndefined()
        expect((await grants.get())?.manageUrl).toBeUndefined()
        expect((await grants.get())?.tokenExpiresAt).toBeUndefined()
        expect((await grants.get())?.grantExpiresAt).toBeUndefined()
      })
    })

    it('rejects a compare-and-swap that is not the next version', async () => {
      await withSubject(makeSubject, async ({ grants }) => {
        const first = grant({ status: 'pending', version: 1 })
        await grants.put(first, null)
        await expect(
          grants.put(grant({ status: 'pending', version: 1, nonce: 'other' }), null),
        ).rejects.toMatchObject({
          code: 'version_conflict',
        })
        await expect(grants.put(grant({ status: 'active', version: 3 }), 1)).rejects.toMatchObject({
          code: 'version_conflict',
        })
        await expect(grants.put(grant({ status: 'active', version: 2 }), 4)).rejects.toMatchObject({
          code: 'version_conflict',
        })
        expect(await grants.get()).toEqual(first)
        await expect(grants.put(first, null)).rejects.toBeInstanceOf(DomainError)
      })
    })

    it('lets exactly one of two puts with the same expected version win', async () => {
      await withSubject(makeSubject, async ({ grants }) => {
        await grants.put(grant({ status: 'pending', version: 1 }), null)
        const left = grant({ status: 'active', version: 2, nonce: 'left' })
        const right = grant({ status: 'revoked', version: 2, nonce: 'right' })
        const results = await Promise.allSettled([grants.put(left, 1), grants.put(right, 1)])
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
        const rejected = results.filter((result) => result.status === 'rejected')
        expect(rejected).toHaveLength(1)
        const failure = rejected[0]
        if (failure === undefined) throw new Error('expected one rejected put')
        expect(failure.reason).toBeInstanceOf(DomainError)
        expect([left, right]).toContainEqual(await grants.get())
      })
    })

    it('rejects the first put when a version is already expected', async () => {
      await withSubject(makeSubject, async ({ grants }) => {
        await expect(grants.put(grant({ status: 'pending', version: 1 }), 0)).rejects.toMatchObject(
          {
            code: 'version_conflict',
          },
        )
        expect(await grants.get()).toBeUndefined()
      })
    })

    it('sums COP spent since a timestamp for the settlement statuses only', async () => {
      await withSubject(makeSubject, async ({ grants, cashIns }) => {
        const since = new Date('2026-10-17T00:00:00.000Z')
        const rows = [
          cashIn({
            id: 'at-since',
            status: 'settling',
            cop: 10n,
            createdAt: '2026-10-17T00:00:00.000Z',
            outgoingPaymentId: 'o1',
          }),
          cashIn({
            id: 'before',
            status: 'settled',
            cop: 20n,
            createdAt: '2026-10-16T23:59:59.999Z',
            outgoingPaymentId: 'o2',
          }),
          cashIn({
            id: 'completed',
            status: 'completed',
            cop: 30n,
            createdAt: '2026-10-17T01:00:00.000Z',
          }),
          cashIn({
            id: 'stellar',
            status: 'failed_stellar',
            cop: 40n,
            createdAt: '2026-10-17T02:00:00.000Z',
          }),
          cashIn({
            id: 'sending',
            status: 'sending_usdc',
            cop: 50n,
            createdAt: '2026-10-17T03:00:00.000Z',
          }),
          cashIn({
            id: 'failed-pay',
            status: 'failed_payment',
            cop: 60n,
            createdAt: '2026-10-17T04:00:00.000Z',
            outgoingPaymentId: 'o3',
          }),
          cashIn({
            id: 'quoted',
            status: 'quoted',
            cop: 70n,
            createdAt: '2026-10-17T05:00:00.000Z',
          }),
          cashIn({
            id: 'expired',
            status: 'expired',
            cop: 80n,
            createdAt: '2026-10-17T06:00:00.000Z',
          }),
        ]
        for (const row of rows) await cashIns.insert(row)
        expect(await grants.spentSince(since)).toEqual(money(130n, 'COP', 2))
        expect(await grants.spentSince(new Date('2026-10-18T00:00:00.000Z'))).toEqual(
          money(0n, 'COP', 2),
        )
      })
    })
  })
}
