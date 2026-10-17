import { describe, expect, it } from 'vitest'

import { SqliteCashInRepository } from '../../adapters/sqlite/cash-in-repository.ts'
import { openDatabase } from '../../adapters/sqlite/database.ts'
import { migrate } from '../../adapters/sqlite/migrate.ts'
import { ManualClock } from '../../../test/fakes/fake-grant-gateway.ts'
import { FakeUsdcNetwork } from '../../../test/fakes/fake-usdc-network.ts'
import { money } from '../../shared/money.ts'
import type { StoreGrantService } from '../../store-grant/application/store-grant-service.ts'
import type { PaymentsNetwork } from '../payments-network.ts'
import { createQuoted, memoFromId, type CashIn } from '../domain/cash-in.ts'
import { transition, type CashInEvent } from '../domain/transitions.ts'
import { SettlementProcessor, type Logger, type Scheduler } from './settlement-processor.ts'

const NOW = new Date('2026-10-17T12:00:00.000Z')
const COP = money(10_000n, 'COP', 2)
const USDC = money(100n, 'USDC', 2)
const RATE = money(10_000n, 'COP', 2)
const FUNDED = money(50_000_000n, 'USDC', 7)

const noop = (): undefined => undefined

const silent: Logger = {
  info: noop,
  warn: noop,
  error: noop,
}

const idle: Scheduler = {
  setTimeout() {
    return 0
  },
  clearTimeout: noop,
}

const payments: PaymentsNetwork = {
  createIncomingPayment: () => Promise.reject(new Error('unused')),
  createQuote: () => Promise.reject(new Error('unused')),
  createOutgoingPayment: () => Promise.reject(new Error('unused')),
  findOutgoingPaymentByQuote: () => Promise.resolve(undefined),
  getOutgoingPayment: () => Promise.reject(new Error('unused')),
  getIncomingPayment: () => Promise.reject(new Error('unused')),
  completeIncomingPayment: () => Promise.reject(new Error('unused')),
}

const grant: Pick<StoreGrantService, 'withAccessToken'> = {
  withAccessToken: (fn) => fn('grant-token'),
}

function processor(repo: SqliteCashInRepository, usdc: FakeUsdcNetwork) {
  return new SettlementProcessor({
    cashIns: repo,
    payments,
    usdc,
    storeGrant: grant,
    clock: new ManualClock(NOW),
    log: silent,
    scheduler: idle,
  })
}

async function ledger() {
  const usdc = new FakeUsdcNetwork()
  await usdc.ensureOperatorReady()
  usdc.creditOperator(FUNDED)
  const dest = await usdc.createAccount()
  await usdc.addUsdcTrustline(dest.secret)
  const db = openDatabase(':memory:')
  migrate(db)
  const repo = new SqliteCashInRepository(db)
  return { usdc, dest, db, repo }
}

async function at(
  repo: SqliteCashInRepository,
  address: string,
  events: readonly CashInEvent[],
): Promise<CashIn> {
  const clock = new ManualClock(NOW)
  let current = createQuoted(
    {
      id: 'cash-1',
      cop: COP,
      usdc: USDC,
      copPerUsdc: RATE,
      expiresAt: new Date(NOW.getTime() + 60_000),
      stellarAddress: address,
      customer: { phone: '3001112233', fullName: 'Ada Lovelace', documentNumber: '12345678' },
      incomingPaymentUrl: 'https://payments.invalid/incoming/1',
      quoteId: 'https://payments.invalid/quotes/1',
    },
    clock,
  )
  await repo.insert(current)
  for (const event of events) {
    const next = transition(current, event, clock.now())
    await repo.save(next, current.version)
    current = next
  }
  return current
}

const SETTLED: CashInEvent[] = [
  { type: 'Confirm' },
  { type: 'OutgoingCreated', outgoingPaymentId: 'https://payments.invalid/outgoing/1' },
  { type: 'IncomingCompleted' },
]

describe('settlement crash recovery', () => {
  it('submits a saved envelope exactly once after the process that prepared it is gone', async () => {
    const { usdc, repo, db } = await ledger()
    try {
      const { dest } = await destination(usdc)
      await at(repo, dest, SETTLED)
      await processor(repo, usdc).runOnce()
      expect((await repo.get('cash-1'))?.status).toBe('sending_usdc')
      expect(await usdc.balance()).toEqual(FUNDED)

      usdc.loseNextSubmitResponse()
      await processor(repo, usdc).runOnce()
      expect((await repo.get('cash-1'))?.status).toBe('sending_usdc')
      expect(await usdc.balance()).toEqual(money(40_000_000n, 'USDC', 7))

      await processor(repo, usdc).runOnce()
      expect((await repo.get('cash-1'))?.status).toBe('completed')
      expect((await repo.get('cash-1'))?.stellarTxHash).toMatch(/^[0-9a-f]{64}$/)
      expect(await usdc.balance()).toEqual(money(40_000_000n, 'USDC', 7))
    } finally {
      db.close()
    }
  })

  it('lets two processors share one database without paying twice', async () => {
    const { usdc, repo, db } = await ledger()
    try {
      const { dest } = await destination(usdc)
      await at(repo, dest, SETTLED)
      const other = new SqliteCashInRepository(db)
      await Promise.all([processor(repo, usdc).runOnce(), processor(other, usdc).runOnce()])
      expect((await repo.get('cash-1'))?.status).toBe('sending_usdc')
      await Promise.all([processor(repo, usdc).runOnce(), processor(other, usdc).runOnce()])
      expect((await repo.get('cash-1'))?.status).toBe('completed')
      expect(await usdc.balance()).toEqual(money(40_000_000n, 'USDC', 7))
    } finally {
      db.close()
    }
  })

  it('rebuilds an envelope that can no longer apply and pays once', async () => {
    const { usdc, repo, db } = await ledger()
    try {
      const { dest } = await destination(usdc)
      const current = await at(repo, dest, SETTLED)
      const prepared = await usdc.prepareTransfer({
        to: dest,
        amount: USDC,
        memo: current.memo,
      })
      const sending = transition(
        current,
        {
          type: 'UsdcSendStarted',
          stellarEnvelopeXdr: prepared.envelopeXdr,
          stellarTxHash: prepared.txHash,
        },
        NOW,
      )
      await repo.save(sending, current.version)
      const other = await usdc.createAccount()
      await usdc.addUsdcTrustline(other.secret)
      const bump = await usdc.prepareTransfer({
        to: other.address,
        amount: USDC,
        memo: 'BUMP-1',
      })
      await usdc.submit(bump)
      expect(await usdc.isEnvelopeDead(prepared)).toBe(true)

      await processor(repo, usdc).runOnce()
      const rebuilt = await repo.get('cash-1')
      expect(rebuilt?.status).toBe('sending_usdc')
      expect(rebuilt?.stellarTxHash).not.toBe(prepared.txHash)
      await processor(repo, usdc).runOnce()
      expect((await repo.get('cash-1'))?.status).toBe('completed')
      expect(await usdc.balance()).toEqual(money(30_000_000n, 'USDC', 7))
      expect(rebuilt?.memo).toBe(memoFromId('cash-1'))
    } finally {
      db.close()
    }
  })
})

async function destination(usdc: FakeUsdcNetwork): Promise<{ dest: string }> {
  const account = await usdc.createAccount()
  await usdc.addUsdcTrustline(account.secret)
  return { dest: account.address }
}
