import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { CashInRepository } from '../../src/cash-in/repository.ts'
import { createQuoted, type CashIn, type CashInStatus } from '../../src/cash-in/domain/cash-in.ts'
import { transition, type CashInEvent } from '../../src/cash-in/domain/transitions.ts'
import { DomainError } from '../../src/shared/errors.ts'
import { money, type Money } from '../../src/shared/money.ts'

export interface CashInRepositorySubject {
  readonly repo: CashInRepository
  close(): void
}

const NOW = new Date('2026-10-17T12:00:00.000Z')
const HUGE = 2n ** 53n + 1n

interface Fixture {
  readonly id: string
  readonly status?: CashInStatus
  readonly documentNumber?: string
  readonly cop?: bigint
  readonly usdc?: bigint
  readonly rate?: bigint
  readonly createdAt?: string
  readonly updatedAt?: string
  readonly expiresAt?: string
  readonly memo?: string
  readonly phone?: string
  readonly fullName?: string
  readonly stellarAddress?: string
  readonly outgoingPaymentId?: string
  readonly incomingCompleted?: boolean
  readonly stellarTxHash?: string
  readonly stellarEnvelopeXdr?: string
  readonly failureReason?: string
  readonly version?: number
}

function fixture(input: Fixture): CashIn {
  const createdAt = new Date(input.createdAt ?? '2026-10-17T12:00:00.000Z')
  const expiresAt = new Date(
    input.expiresAt ?? new Date(createdAt.getTime() + 60_000).toISOString(),
  )
  const outgoing = input.outgoingPaymentId
  const hash = input.stellarTxHash
  const envelope = input.stellarEnvelopeXdr
  const failure = input.failureReason
  return {
    id: input.id,
    status: input.status ?? 'quoted',
    cop: money(input.cop ?? 1_000n, 'COP', 2),
    usdc: money(input.usdc ?? 100n, 'USDC', 2),
    copPerUsdc: money(input.rate ?? 4_000n, 'COP', 2),
    expiresAt,
    stellarAddress: input.stellarAddress ?? 'G'.repeat(56),
    memo: input.memo ?? `WALLE-${input.id}`,
    customer: {
      phone: input.phone ?? '+573001112233',
      fullName: input.fullName ?? 'Ada Lovelace',
      documentNumber: input.documentNumber ?? 'DOC-A',
    },
    openPayments: {
      incomingPaymentUrl: `https://wallet.example.test/incoming/${input.id}`,
      quoteId: `quote-${input.id}`,
      incomingCompleted: input.incomingCompleted ?? false,
      ...(outgoing !== undefined ? { outgoingPaymentId: outgoing } : {}),
    },
    createdAt,
    updatedAt: new Date(input.updatedAt ?? createdAt.toISOString()),
    version: input.version ?? 1,
    ...(hash !== undefined ? { stellarTxHash: hash } : {}),
    ...(envelope !== undefined ? { stellarEnvelopeXdr: envelope } : {}),
    ...(failure !== undefined ? { failureReason: failure } : {}),
  }
}

async function withRepo(
  makeSubject: () => Promise<CashInRepositorySubject>,
  run: (repo: CashInRepository) => Promise<void>,
): Promise<void> {
  const subject = await makeSubject()
  try {
    await run(subject.repo)
  } finally {
    subject.close()
  }
}

function usdc(amount: bigint): Money {
  return money(amount, 'USDC', 2)
}

function cop(amount: bigint): Money {
  return money(amount, 'COP', 2)
}

const LIMIT_ROWS: readonly Fixture[] = [
  {
    id: 'a-live',
    status: 'quoted',
    createdAt: '2026-10-17T12:00:00.000Z',
    expiresAt: '2026-10-17T13:00:00.000Z',
    usdc: 100n,
    cop: 1_000n,
  },
  {
    id: 'a-exp-eq',
    status: 'quoted',
    createdAt: '2026-10-17T12:00:00.000Z',
    expiresAt: '2026-10-17T12:00:00.000Z',
    usdc: 11n,
    cop: 110n,
  },
  {
    id: 'a-exp-before',
    status: 'quoted',
    createdAt: '2026-10-17T11:00:00.000Z',
    expiresAt: '2026-10-17T11:30:00.000Z',
    usdc: 12n,
    cop: 120n,
  },
  {
    id: 'a-expired',
    status: 'expired',
    createdAt: '2026-10-17T10:00:00.000Z',
    usdc: 13n,
    cop: 130n,
  },
  {
    id: 'a-failed-pay',
    status: 'failed_payment',
    createdAt: '2026-10-17T09:00:00.000Z',
    outgoingPaymentId: 'out-failed',
    usdc: 14n,
    cop: 140n,
  },
  {
    id: 'a-settling',
    status: 'settling',
    createdAt: '2026-10-17T08:00:00.000Z',
    outgoingPaymentId: 'out-settling',
    usdc: 200n,
    cop: 2_000n,
  },
  {
    id: 'a-settled-midnight',
    status: 'settled',
    createdAt: '2026-10-17T00:00:00.000Z',
    incomingCompleted: true,
    outgoingPaymentId: 'out-settled',
    usdc: 300n,
    cop: 3_000n,
  },
  {
    id: 'a-sending-yday',
    status: 'sending_usdc',
    createdAt: '2026-10-16T23:59:59.999Z',
    stellarTxHash: 'hash-y',
    stellarEnvelopeXdr: 'xdr-y',
    usdc: 400n,
    cop: 4_000n,
  },
  {
    id: 'a-completed-prev',
    status: 'completed',
    createdAt: '2026-09-30T23:59:59.999Z',
    stellarTxHash: 'hash-p',
    stellarEnvelopeXdr: 'xdr-p',
    usdc: 500n,
    cop: 5_000n,
  },
  {
    id: 'a-failed-stellar-month',
    status: 'failed_stellar',
    createdAt: '2026-10-01T00:00:00.000Z',
    stellarTxHash: 'hash-m',
    stellarEnvelopeXdr: 'xdr-m',
    failureReason: 'horizon',
    usdc: 600n,
    cop: 6_000n,
  },
  {
    id: 'b-settling',
    status: 'settling',
    documentNumber: 'DOC-B',
    createdAt: '2026-10-17T12:00:00.000Z',
    outgoingPaymentId: 'out-b',
    usdc: 700n,
    cop: 7_000n,
  },
  {
    id: 'a-quote-yday',
    status: 'quoted',
    createdAt: '2026-10-16T23:59:59.999Z',
    expiresAt: '2026-10-17T13:00:00.000Z',
    usdc: 150n,
    cop: 1_500n,
  },
  {
    id: 'a-completed-today',
    status: 'completed',
    createdAt: '2026-10-17T07:00:00.000Z',
    stellarTxHash: 'hash-t',
    stellarEnvelopeXdr: 'xdr-t',
    usdc: 50n,
    cop: 500n,
  },
  {
    id: 'a-nov',
    status: 'settling',
    createdAt: '2026-11-01T00:00:00.000Z',
    outgoingPaymentId: 'out-nov',
    usdc: 17n,
    cop: 170n,
  },
]

export function runCashInRepositoryContract(
  name: string,
  makeSubject: () => Promise<CashInRepositorySubject>,
): void {
  describe(name, () => {
    it('round-trips every field, including omitted optionals and amounts above 2^53', async () => {
      await withRepo(makeSubject, async (repo) => {
        const minimal = fixture({ id: 'min' })
        const full = fixture({
          id: 'full',
          status: 'failed_stellar',
          documentNumber: '999',
          cop: HUGE,
          usdc: 2n ** 60n + 3n,
          rate: HUGE + 9n,
          createdAt: '2026-10-17T11:59:00.456Z',
          updatedAt: '2026-10-17T12:00:01.789Z',
          expiresAt: '2026-10-17T12:01:00.123Z',
          memo: 'WALLE-FULL',
          phone: '+573009998877',
          fullName: 'Grace Hopper',
          stellarAddress: 'GDEST',
          outgoingPaymentId: 'out-full',
          incomingCompleted: true,
          stellarTxHash: 'hash-full',
          stellarEnvelopeXdr: 'AAAA-envelope',
          failureReason: 'horizon down',
          version: 4,
        })

        await repo.insert(minimal)
        await repo.insert(full)

        expect(await repo.get('missing')).toBeUndefined()
        expect(await repo.get('min')).toEqual(minimal)
        expect(await repo.get('full')).toEqual(full)
        expect((await repo.get('min'))?.openPayments.outgoingPaymentId).toBeUndefined()
        expect((await repo.get('min'))?.stellarTxHash).toBeUndefined()
        expect((await repo.get('min'))?.stellarEnvelopeXdr).toBeUndefined()
        expect((await repo.get('min'))?.failureReason).toBeUndefined()
        expect((await repo.get('full'))?.cop.amount).toBe(HUGE)
        expect((await repo.get('full'))?.usdc.amount).toBe(2n ** 60n + 3n)
      })
    })

    it('rejects a duplicate id and a compare-and-swap that does not advance the stored version', async () => {
      await withRepo(makeSubject, async (repo) => {
        const original = fixture({ id: 'cas', version: 1, memo: 'original' })
        await repo.insert(original)
        const duplicate = fixture({ id: 'cas', version: 1, memo: 'duplicate' })
        await expect(repo.insert(duplicate)).rejects.toMatchObject({ code: 'version_conflict' })
        await expect(repo.insert(duplicate)).rejects.toBeInstanceOf(DomainError)
        expect(await repo.get('cas')).toEqual(original)

        const saved = fixture({ id: 'cas', version: 2, memo: 'saved', status: 'settling' })
        await repo.save(saved, 1)
        expect(await repo.get('cas')).toEqual(saved)

        const stale = fixture({ id: 'cas', version: 3, memo: 'stale' })
        await expect(repo.save(stale, 1)).rejects.toMatchObject({ code: 'version_conflict' })
        const jumped = fixture({ id: 'cas', version: 4, memo: 'jumped' })
        await expect(repo.save(jumped, 2)).rejects.toMatchObject({ code: 'version_conflict' })
        await expect(repo.save(fixture({ id: 'missing', version: 2 }), 1)).rejects.toMatchObject({
          code: 'version_conflict',
        })
        expect(await repo.get('cas')).toEqual(saved)
      })
    })

    it('lets exactly one of two saves with the same expected version win', async () => {
      await withRepo(makeSubject, async (repo) => {
        const original = fixture({ id: 'race', version: 1 })
        await repo.insert(original)
        const left = fixture({ id: 'race', version: 2, failureReason: 'left' })
        const right = fixture({ id: 'race', version: 2, failureReason: 'right' })
        const results = await Promise.allSettled([repo.save(left, 1), repo.save(right, 1)])
        const fulfilled = results.filter((result) => result.status === 'fulfilled')
        const rejected = results.filter((result) => result.status === 'rejected')
        expect(fulfilled).toHaveLength(1)
        expect(rejected).toHaveLength(1)
        const failure = rejected[0]
        if (failure === undefined) throw new Error('expected one rejected save')
        expect(failure.reason).toBeInstanceOf(DomainError)
        if (!(failure.reason instanceof DomainError)) throw new Error('expected DomainError')
        expect(failure.reason.code).toBe('version_conflict')
        expect([left, right]).toContainEqual(await repo.get('race'))
      })
    })

    it('clears a failure reason when a later version omits it', async () => {
      await withRepo(makeSubject, async (repo) => {
        const expiresAt = new Date('2026-10-17T15:01:00.000Z')
        let current = createQuoted(
          {
            id: 'path-1',
            cop: cop(10_000n),
            usdc: usdc(100n),
            copPerUsdc: cop(4_000n),
            expiresAt,
            stellarAddress: 'GPATH',
            customer: { phone: '300', fullName: 'Ada', documentNumber: 'DOC-A' },
            incomingPaymentUrl: 'https://wallet.example.test/incoming/path-1',
            quoteId: 'quote-path-1',
          },
          { now: () => new Date('2026-10-17T15:00:00.000Z') },
        )
        await repo.insert(current)
        const steps: readonly { event: CashInEvent; at: Date }[] = [
          {
            event: { type: 'Confirm' },
            at: new Date(expiresAt.getTime() - 1),
          },
          {
            event: { type: 'OutgoingCreated', outgoingPaymentId: 'out-path' },
            at: new Date('2026-10-17T15:00:01.500Z'),
          },
          { event: { type: 'IncomingCompleted' }, at: new Date('2026-10-17T15:00:02.000Z') },
          {
            event: {
              type: 'UsdcSendStarted',
              stellarEnvelopeXdr: 'xdr-path',
              stellarTxHash: 'hash-path',
            },
            at: new Date('2026-10-17T15:00:03.000Z'),
          },
          {
            event: { type: 'UsdcFailed', reason: 'horizon' },
            at: new Date('2026-10-17T15:00:04.000Z'),
          },
          { event: { type: 'Retry' }, at: new Date('2026-10-17T15:00:05.000Z') },
          {
            event: { type: 'UsdcSent', stellarTxHash: 'hash-path' },
            at: new Date('2026-10-17T15:00:06.000Z'),
          },
        ]
        for (const step of steps) {
          const next = transition(current, step.event, step.at)
          await repo.save(next, current.version)
          current = next
          expect(await repo.get(current.id)).toEqual(current)
        }
        expect(current.status).toBe('completed')
        expect(current.failureReason).toBeUndefined()
        expect((await repo.get(current.id))?.failureReason).toBeUndefined()
      })
    })

    it('lists newest cash-ins first and status queries oldest first', async () => {
      await withRepo(makeSubject, async (repo) => {
        const sameTime = '2026-10-17T09:00:00.000Z'
        const rows = [
          fixture({ id: 'b-same', status: 'quoted', createdAt: sameTime }),
          fixture({ id: 'a-same', status: 'quoted', createdAt: sameTime }),
          fixture({
            id: 'old-settling',
            status: 'settling',
            createdAt: '2026-10-17T08:00:00.000Z',
            outgoingPaymentId: 'out-old',
          }),
          fixture({
            id: 'new-settled',
            status: 'settled',
            createdAt: '2026-10-17T11:00:00.000Z',
            incomingCompleted: true,
            outgoingPaymentId: 'out-new',
          }),
          fixture({ id: 'mid-expired', status: 'expired', createdAt: '2026-10-17T10:00:00.000Z' }),
        ]
        for (const row of rows) await repo.insert(row)

        expect(await repo.listRecent(2)).toEqual([
          fixture({
            id: 'new-settled',
            status: 'settled',
            createdAt: '2026-10-17T11:00:00.000Z',
            incomingCompleted: true,
            outgoingPaymentId: 'out-new',
          }),
          fixture({ id: 'mid-expired', status: 'expired', createdAt: '2026-10-17T10:00:00.000Z' }),
        ])
        expect(await repo.listRecent(10).then((listed) => listed.map((row) => row.id))).toEqual([
          'new-settled',
          'mid-expired',
          'b-same',
          'a-same',
          'old-settling',
        ])
        expect(await repo.listByStatus(['settling', 'settled'])).toEqual([
          fixture({
            id: 'old-settling',
            status: 'settling',
            createdAt: '2026-10-17T08:00:00.000Z',
            outgoingPaymentId: 'out-old',
          }),
          fixture({
            id: 'new-settled',
            status: 'settled',
            createdAt: '2026-10-17T11:00:00.000Z',
            incomingCompleted: true,
            outgoingPaymentId: 'out-new',
          }),
        ])
        expect(await repo.listByStatus(['quoted'])).toEqual([
          fixture({ id: 'a-same', status: 'quoted', createdAt: sameTime }),
          fixture({ id: 'b-same', status: 'quoted', createdAt: sameTime }),
        ])
        expect(await repo.listByStatus([])).toEqual([])
        expect(await repo.listRecent(0)).toEqual([])
      })
    })

    it('counts level-1 usage on UTC day and month boundaries and ignores other documents', async () => {
      await withRepo(makeSubject, async (repo) => {
        for (const row of LIMIT_ROWS) await repo.insert(fixture(row))
        const usage = await repo.usageFor('DOC-A', NOW)
        expect(usage.usdcDay).toEqual(usdc(650n))
        expect(usage.usdcMonth).toEqual(usdc(1_800n))
        expect(usage.copMonth).toEqual(cop(18_000n))
        expect(await repo.usageFor('nobody', NOW)).toEqual({
          usdcDay: usdc(0n),
          usdcMonth: usdc(0n),
          copMonth: cop(0n),
        })
      })
    })

    it('reserves USDC that still has to leave inventory, excluding expired quotes', async () => {
      await withRepo(makeSubject, async (repo) => {
        for (const row of LIMIT_ROWS) await repo.insert(fixture(row))
        expect(await repo.reservedUsdc(NOW)).toEqual(usdc(2_467n))
        expect(await repo.reservedUsdc(new Date('2026-10-17T13:00:00.000Z'))).toEqual(usdc(2_217n))
      })
    })

    it('stores an idempotency key and rejects a second insert with that key', async () => {
      await withRepo(makeSubject, async (repo) => {
        const first = fixture({ id: 'idem-1' })
        await repo.insert(first, { key: 'key-1', body: '{"copAmount":"10.00"}' })
        expect(await repo.findIdempotency('key-1')).toEqual({
          cashIn: first,
          body: '{"copAmount":"10.00"}',
        })
        await expect(
          repo.insert(fixture({ id: 'idem-2' }), { key: 'key-1', body: '{"copAmount":"99.00"}' }),
        ).rejects.toMatchObject({ code: 'version_conflict' })
        expect(await repo.get('idem-2')).toBeUndefined()
        expect(await repo.findIdempotency('missing')).toBeUndefined()
        await repo.insert(fixture({ id: 'plain' }))
        expect((await repo.get('plain'))?.id).toBe('plain')
      })
    })

    it('reloads every valid transition sequence equal to the in-memory cash-in', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.integer({ min: 0, max: 20 }), { maxLength: 12 }),
          async (picks) => {
            const subject = await makeSubject()
            try {
              const expiresAt = new Date('2026-10-17T15:01:00.000Z')
              let state = createQuoted(
                {
                  id: 'prop-cash-in',
                  cop: cop(10_000n),
                  usdc: usdc(250n),
                  copPerUsdc: cop(4_000n),
                  expiresAt,
                  stellarAddress: 'GPROP',
                  customer: { phone: '300', fullName: 'Ada', documentNumber: 'DOC-A' },
                  incomingPaymentUrl: 'https://wallet.example.test/incoming/prop-cash-in',
                  quoteId: 'quote-prop',
                },
                { now: () => new Date('2026-10-17T15:00:00.000Z') },
              )
              await subject.repo.insert(state)
              expect(await subject.repo.get(state.id)).toEqual(state)

              for (const pick of picks) {
                const events = validEvents(state)
                if (events.length === 0) break
                const event = events[pick % events.length]
                if (event === undefined) throw new Error('missing event')
                const now = nowFor(state, event, expiresAt)
                const next = transition(state, event, now)
                await subject.repo.save(next, state.version)
                state = next
                expect(await subject.repo.get(state.id)).toEqual(state)
              }
            } finally {
              subject.close()
            }
          },
        ),
        { numRuns: 25 },
      )
    })
  })
}

function validEvents(cashIn: CashIn): CashInEvent[] {
  switch (cashIn.status) {
    case 'quoted':
      return [{ type: 'Confirm' }, { type: 'Expire' }]
    case 'settling':
      return cashIn.openPayments.outgoingPaymentId === undefined
        ? [
            { type: 'OutgoingCreated', outgoingPaymentId: 'out-prop' },
            { type: 'PaymentFailed', reason: 'declined' },
          ]
        : [{ type: 'IncomingCompleted' }, { type: 'PaymentFailed', reason: 'declined' }]
    case 'settled':
      return [
        { type: 'UsdcSendStarted', stellarEnvelopeXdr: 'xdr-prop', stellarTxHash: 'hash-prop' },
      ]
    case 'sending_usdc':
      return [
        { type: 'UsdcSent', stellarTxHash: cashIn.stellarTxHash ?? 'hash-prop' },
        { type: 'UsdcFailed', reason: 'horizon' },
      ]
    case 'failed_stellar':
      return [{ type: 'Retry' }]
    case 'completed':
    case 'expired':
    case 'failed_payment':
      return []
    default: {
      const unexpected: never = cashIn.status
      return unexpected
    }
  }
}

function nowFor(cashIn: CashIn, event: CashInEvent, expiresAt: Date): Date {
  if (cashIn.status === 'quoted' && event.type === 'Expire') return new Date(expiresAt.getTime())
  if (cashIn.status === 'quoted' && event.type === 'Confirm')
    return new Date(expiresAt.getTime() - 1)
  return new Date(expiresAt.getTime() + cashIn.version * 1_000)
}
