import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DomainError } from '../../shared/errors.ts'
import { money } from '../../shared/money.ts'
import type { Clock } from '../../shared/ports.ts'
import { createQuoted, type CashIn, type CashInStatus } from './cash-in.ts'
import { transition, type CashInEvent } from './transitions.ts'

const T0 = new Date('2026-10-17T15:00:00.000Z')
const T1 = new Date('2026-10-17T15:00:01.000Z')
const EXPIRES = new Date('2026-10-17T15:01:00.000Z')
const XDR = 'AAAA-envelope'
const HASH = 'hash-1'
const OUTGOING = 'out-1'

const STATUSES = [
  'quoted',
  'settling',
  'settled',
  'sending_usdc',
  'completed',
  'failed_payment',
  'failed_stellar',
  'expired',
] as const satisfies readonly CashInStatus[]

const EVENT_TYPES = [
  'Confirm',
  'Expire',
  'IncomingCompleted',
  'PaymentFailed',
  'UsdcSendStarted',
  'UsdcSent',
  'UsdcFailed',
  'Retry',
] as const satisfies readonly CashInEvent['type'][]

const TERMINAL = new Set<CashInStatus>(['completed', 'expired', 'failed_payment'])

function clockAt(date: Date): Clock {
  return { now: () => new Date(date.getTime()) }
}

function quotedCashIn(): CashIn {
  return createQuoted(
    {
      id: 'id-abc12345',
      cop: money(10_000_000n, 'COP', 2),
      usdc: money(2489n, 'USDC', 2),
      copPerUsdc: money(401_700n, 'COP', 2),
      expiresAt: EXPIRES,
      stellarAddress: 'GADDRESS',
      customer: { phone: '300', fullName: 'Ada', documentNumber: '42' },
      incomingPaymentUrl: 'https://wallet.example.test/in/1',
      quoteId: 'quote-1',
    },
    clockAt(T0),
  )
}

function reach(status: CashInStatus): CashIn {
  const quoted = quotedCashIn()
  if (status === 'quoted') return quoted
  if (status === 'expired') return transition(quoted, { type: 'Expire' }, EXPIRES)

  const settling = transition(quoted, { type: 'Confirm', outgoingPaymentId: OUTGOING }, T1)
  if (status === 'settling') return settling
  if (status === 'failed_payment') {
    return transition(settling, { type: 'PaymentFailed', reason: 'declined' }, T1)
  }

  const settled = transition(settling, { type: 'IncomingCompleted' }, T1)
  if (status === 'settled') return settled

  const sending = transition(
    settled,
    { type: 'UsdcSendStarted', stellarEnvelopeXdr: XDR, stellarTxHash: HASH },
    T1,
  )
  if (status === 'sending_usdc') return sending
  if (status === 'failed_stellar') {
    return transition(sending, { type: 'UsdcFailed', reason: 'horizon' }, T1)
  }
  return transition(sending, { type: 'UsdcSent', stellarTxHash: HASH }, T1)
}

function eventFor(type: CashInEvent['type'], cashIn: CashIn): CashInEvent {
  switch (type) {
    case 'Confirm':
      return { type, outgoingPaymentId: OUTGOING }
    case 'Expire':
      return { type }
    case 'IncomingCompleted':
      return { type }
    case 'PaymentFailed':
      return { type, reason: 'declined' }
    case 'UsdcSendStarted':
      return { type, stellarEnvelopeXdr: XDR, stellarTxHash: HASH }
    case 'UsdcSent':
      return { type, stellarTxHash: cashIn.stellarTxHash ?? HASH }
    case 'UsdcFailed':
      return { type, reason: 'horizon' }
    case 'Retry':
      return { type }
    default: {
      const neverType: never = type
      return neverType
    }
  }
}

function nowFor(status: CashInStatus, type: CashInEvent['type']): Date {
  if (status === 'quoted' && type === 'Expire') return EXPIRES
  if (status === 'quoted' && type === 'Confirm') return new Date(EXPIRES.getTime() - 1)
  return T1
}

function allowed(status: CashInStatus, type: CashInEvent['type']): boolean {
  return (
    (status === 'quoted' && (type === 'Confirm' || type === 'Expire')) ||
    (status === 'settling' && (type === 'IncomingCompleted' || type === 'PaymentFailed')) ||
    (status === 'settled' && type === 'UsdcSendStarted') ||
    (status === 'sending_usdc' && (type === 'UsdcSent' || type === 'UsdcFailed')) ||
    (status === 'failed_stellar' && type === 'Retry')
  )
}

describe('transition table', () => {
  it.each(STATUSES.flatMap((status) => EVENT_TYPES.map((type) => [status, type] as const)))(
    '%s + %s follows the state table',
    (status, type) => {
      const before = reach(status)
      const now = nowFor(status, type)
      const event = eventFor(type, before)
      if (!allowed(status, type)) {
        expect(codeOf(() => transition(before, event, now))).toBe('invalid_transition')
        expect(before.status).toBe(status)
        return
      }

      const after = transition(before, event, now)
      expect(before.status).toBe(status)
      expect(after.version).toBe(before.version + 1)
      expect(after.updatedAt.toISOString()).toBe(now.toISOString())
      expect(after.createdAt).toEqual(before.createdAt)
      expect(after.id).toBe(before.id)

      switch (type) {
        case 'Confirm':
          expect(after.status).toBe('settling')
          expect(after.openPayments.outgoingPaymentId).toBe(OUTGOING)
          expect(after.openPayments.incomingCompleted).toBe(false)
          break
        case 'Expire':
          expect(after.status).toBe('expired')
          break
        case 'IncomingCompleted':
          expect(after.status).toBe('settled')
          expect(after.openPayments.incomingCompleted).toBe(true)
          expect(after.openPayments.outgoingPaymentId).toBe(OUTGOING)
          break
        case 'PaymentFailed':
          expect(after.status).toBe('failed_payment')
          expect(after.failureReason).toBe('declined')
          break
        case 'UsdcSendStarted':
          expect(after.status).toBe('sending_usdc')
          expect(after.stellarEnvelopeXdr).toBe(XDR)
          expect(after.stellarTxHash).toBe(HASH)
          break
        case 'UsdcSent':
          expect(after.status).toBe('completed')
          expect(after.stellarTxHash).toBe(HASH)
          expect(after.stellarEnvelopeXdr).toBe(XDR)
          break
        case 'UsdcFailed':
          expect(after.status).toBe('failed_stellar')
          expect(after.failureReason).toBe('horizon')
          expect(after.stellarEnvelopeXdr).toBe(XDR)
          expect(after.stellarTxHash).toBe(HASH)
          break
        case 'Retry':
          expect(after.status).toBe('sending_usdc')
          expect(after.stellarEnvelopeXdr).toBe(before.stellarEnvelopeXdr)
          expect(after.stellarTxHash).toBe(before.stellarTxHash)
          expect(after.failureReason).toBeUndefined()
          break
        default: {
          const neverType: never = type
          throw new Error(neverType)
        }
      }
    },
  )

  it('expires a quote only at or after expiresAt, and confirm then raises quote_expired', () => {
    const quoted = quotedCashIn()
    expect(
      codeOf(() => transition(quoted, { type: 'Expire' }, new Date(EXPIRES.getTime() - 1))),
    ).toBe('invalid_transition')
    expect(
      codeOf(() => transition(quoted, { type: 'Confirm', outgoingPaymentId: OUTGOING }, EXPIRES)),
    ).toBe('quote_expired')
    const expired = transition(quoted, { type: 'Expire' }, EXPIRES)
    expect(expired.status).toBe('expired')
  })

  it('refuses a completion hash that differs from the stored envelope', () => {
    const sending = reach('sending_usdc')
    expect(
      codeOf(() => transition(sending, { type: 'UsdcSent', stellarTxHash: 'other' }, T1)),
    ).toBe('invalid_transition')
  })

  it('refuses a retry when the stored envelope is missing', () => {
    const failed = reach('failed_stellar')
    const { stellarEnvelopeXdr: envelope, stellarTxHash: hash, ...rest } = failed
    expect(envelope).toBe(XDR)
    expect(hash).toBe(HASH)
    expect(codeOf(() => transition(rest, { type: 'Retry' }, T1))).toBe('invalid_transition')
  })

  it('does not replace an envelope that was already stored', () => {
    const settled = reach('settled')
    const stored: CashIn = {
      ...settled,
      stellarEnvelopeXdr: 'original-xdr',
      stellarTxHash: 'original-hash',
    }
    expect(
      codeOf(() =>
        transition(
          stored,
          { type: 'UsdcSendStarted', stellarEnvelopeXdr: 'new-xdr', stellarTxHash: 'new-hash' },
          T1,
        ),
      ),
    ).toBe('invalid_transition')
  })
})

describe('transition properties', () => {
  const eventArb: fc.Arbitrary<CashInEvent> = fc.oneof(
    fc.record({
      type: fc.constant('Confirm' as const),
      outgoingPaymentId: fc.string({ minLength: 1, maxLength: 12 }),
    }),
    fc.constant({ type: 'Expire' as const }),
    fc.constant({ type: 'IncomingCompleted' as const }),
    fc.record({
      type: fc.constant('PaymentFailed' as const),
      reason: fc.string({ minLength: 1, maxLength: 20 }),
    }),
    fc.record({
      type: fc.constant('UsdcSendStarted' as const),
      stellarEnvelopeXdr: fc.constant(XDR),
      stellarTxHash: fc.constant(HASH),
    }),
    fc.record({
      type: fc.constant('UsdcSent' as const),
      stellarTxHash: fc.constantFrom(HASH, 'other-hash'),
    }),
    fc.record({
      type: fc.constant('UsdcFailed' as const),
      reason: fc.string({ minLength: 1, maxLength: 20 }),
    }),
    fc.constant({ type: 'Retry' as const }),
  )

  it('keeps version, terminals, and the stored envelope stable', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ event: eventArb, atExpiry: fc.boolean() }), { maxLength: 24 }),
        (steps) => {
          let state = quotedCashIn()
          let locked: { readonly xdr: string; readonly hash: string } | undefined

          for (const step of steps) {
            const before = state
            const now = step.atExpiry ? EXPIRES : new Date(EXPIRES.getTime() - 1)
            try {
              const next = transition(before, step.event, now)
              expect(next.version).toBe(before.version + 1)
              expect(TERMINAL.has(before.status)).toBe(false)
              if (next.status === 'completed') expect(before.status).toBe('sending_usdc')
              if (locked) {
                expect(next.stellarEnvelopeXdr).toBe(locked.xdr)
                expect(next.stellarTxHash).toBe(locked.hash)
              }
              if (next.stellarEnvelopeXdr !== undefined && next.stellarTxHash !== undefined) {
                locked = { xdr: next.stellarEnvelopeXdr, hash: next.stellarTxHash }
              }
              state = next
            } catch (error) {
              expect(error).toBeInstanceOf(DomainError)
              if (!(error instanceof DomainError)) throw error
              expect(['invalid_transition', 'quote_expired']).toContain(error.code)
              expect(state).toBe(before)
              expect(state.version).toBe(before.version)
            }
          }
        },
      ),
    )
  })
})

function codeOf(run: () => void): string {
  try {
    run()
  } catch (error) {
    if (error instanceof DomainError) return error.code
    throw error
  }
  throw new Error('expected DomainError')
}
