import { describe, expect, it } from 'vitest'

import { ManualClock } from '../../../test/fakes/fake-grant-gateway.ts'
import { createMemoryCashInRepository } from '../../../test/fakes/memory-cash-in-repository.ts'
import { DomainError } from '../../shared/errors.ts'
import { money } from '../../shared/money.ts'
import { createQuoted } from '../domain/cash-in.ts'
import { transition } from '../domain/transitions.ts'
import type { CashInRepository } from '../repository.ts'
import { GetCashIn } from './get-cash-in.ts'

const NOW = new Date('2026-10-17T12:00:00.000Z')

function quoted(expiresAt: Date) {
  return createQuoted(
    {
      id: 'cash0001',
      cop: money(10_000n, 'COP', 2),
      usdc: money(100n, 'USDC', 2),
      copPerUsdc: money(10_000n, 'COP', 2),
      expiresAt,
      stellarAddress: `G${'A'.repeat(55)}`,
      customer: { phone: '3001112233', fullName: 'Ada Lovelace', documentNumber: '12345678' },
      incomingPaymentUrl: 'https://payments.invalid/incoming-payments/1',
      quoteId: 'https://payments.invalid/quotes/1',
    },
    { now: () => NOW },
  )
}

describe('GetCashIn', () => {
  it('returns not_found for an unknown id', async () => {
    const service = new GetCashIn({
      cashIns: createMemoryCashInRepository(),
      clock: new ManualClock(NOW),
    })
    await expect(service.get('missing')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('returns a live quote unchanged', async () => {
    const repo = createMemoryCashInRepository()
    const cashIn = quoted(new Date(NOW.getTime() + 1_000))
    await repo.insert(cashIn)
    const service = new GetCashIn({ cashIns: repo, clock: new ManualClock(NOW) })
    expect(await service.get(cashIn.id)).toEqual(cashIn)
  })

  it('expires a quoted cash-in whose deadline has passed', async () => {
    const repo = createMemoryCashInRepository()
    const cashIn = quoted(NOW)
    await repo.insert(cashIn)
    const service = new GetCashIn({ cashIns: repo, clock: new ManualClock(NOW) })
    const expired = await service.get(cashIn.id)
    expect(expired.status).toBe('expired')
    expect(expired.version).toBe(2)
    expect(await repo.get(cashIn.id)).toEqual(expired)
  })

  it('propagates a save failure that is not a version conflict', async () => {
    const repo = createMemoryCashInRepository()
    const cashIn = quoted(NOW)
    await repo.insert(cashIn)
    const failing: CashInRepository = {
      ...repo,
      save: () => Promise.reject(new Error('disk')),
    }
    const service = new GetCashIn({ cashIns: failing, clock: new ManualClock(NOW) })
    await expect(service.get(cashIn.id)).rejects.toThrow('disk')
  })

  it('returns the re-read row when the expiry save loses a version race', async () => {
    const repo = createMemoryCashInRepository()
    const cashIn = quoted(NOW)
    await repo.insert(cashIn)
    const winner = transition(cashIn, { type: 'Expire' }, NOW)
    const racing: CashInRepository = {
      ...repo,
      save: () => {
        return repo.save(winner, cashIn.version).then(() => {
          throw new DomainError('version_conflict', 'version conflict')
        })
      },
    }
    const service = new GetCashIn({ cashIns: racing, clock: new ManualClock(NOW) })
    expect((await service.get(cashIn.id)).status).toBe('expired')
  })
})
