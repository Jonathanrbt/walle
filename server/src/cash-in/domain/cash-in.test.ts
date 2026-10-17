import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { Clock } from '../../shared/ports.ts'
import { money } from '../../shared/money.ts'
import { createQuoted, memoFromId } from './cash-in.ts'

const T0 = new Date('2026-10-17T15:00:00.000Z')

function clockAt(date: Date): Clock {
  return { now: () => new Date(date.getTime()) }
}

describe('memoFromId', () => {
  it('keeps the WALLE- prefix and the first 8 alphanumerics', () => {
    expect(memoFromId('ab-cd_12 34efgh')).toBe('WALLE-ABCD1234')
    expect(memoFromId('xyz')).toBe('WALLE-XYZ')
    expect(Buffer.byteLength(memoFromId('ab-cd_12 34efgh'))).toBeLessThanOrEqual(28)
  })

  it('stays inside the Stellar text-memo limit for any id', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (id) => {
        const memo = memoFromId(id)
        expect(memo.startsWith('WALLE-')).toBe(true)
        expect(memo.slice('WALLE-'.length)).toMatch(/^[0-9A-Z]{0,8}$/)
        expect(Buffer.byteLength(memo)).toBeLessThanOrEqual(28)
      }),
    )
  })
})

describe('createQuoted', () => {
  it('starts a version-1 quoted cash-in from the clock', () => {
    const expiresAt = new Date('2026-10-17T15:01:00.000Z')
    const cashIn = createQuoted(
      {
        id: 'cash-in-abcd1234',
        cop: money(10_000_000n, 'COP', 2),
        usdc: money(2489n, 'USDC', 2),
        copPerUsdc: money(401_700n, 'COP', 2),
        expiresAt,
        stellarAddress: 'G'.repeat(56),
        customer: { phone: '+573000000000', fullName: 'Ada Lovelace', documentNumber: '123' },
        incomingPaymentUrl: 'https://wallet.example.test/incoming/1',
        quoteId: 'quote-1',
      },
      clockAt(T0),
    )

    expect(cashIn.status).toBe('quoted')
    expect(cashIn.version).toBe(1)
    expect(cashIn.memo).toBe('WALLE-CASHINAB')
    expect(cashIn.createdAt.toISOString()).toBe(T0.toISOString())
    expect(cashIn.updatedAt.toISOString()).toBe(T0.toISOString())
    expect(cashIn.expiresAt).toBe(expiresAt)
    expect(cashIn.openPayments).toEqual({
      incomingPaymentUrl: 'https://wallet.example.test/incoming/1',
      quoteId: 'quote-1',
      incomingCompleted: false,
    })
    expect(cashIn.openPayments.outgoingPaymentId).toBeUndefined()
    expect(cashIn.stellarTxHash).toBeUndefined()
    expect(cashIn.stellarEnvelopeXdr).toBeUndefined()
    expect(cashIn.failureReason).toBeUndefined()
  })
})
