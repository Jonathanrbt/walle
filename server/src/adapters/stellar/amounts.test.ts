import { Keypair, Networks } from '@stellar/stellar-sdk'
import { describe, expect, it } from 'vitest'
import { money } from '../../shared/money.ts'
import { StellarError } from '../../treasury/usdc-network.ts'
import {
  assertMemoText,
  assertTransferDestination,
  doubledBaseFee,
  trustlineCanReceive,
  usdcPaymentAmount,
} from './amounts.ts'
import { envelopeIsDead } from './dead-envelope.ts'
import { attemptFromHorizonError, settleSubmit } from './submit-outcome.ts'
import { TESTNET_PASSPHRASE, TRANSFER_WINDOW_SECONDS } from './envelope.ts'

describe('USDC amount conversion', () => {
  it('converts scale 2 to scale 7 without rounding', () => {
    expect(usdcPaymentAmount(money(100n, 'USDC', 2))).toBe('1.0000000')
    expect(usdcPaymentAmount(money(1n, 'USDC', 2))).toBe('0.0100000')
    expect(usdcPaymentAmount(money(2427n, 'USDC', 2))).toBe('24.2700000')
  })

  it('keeps scale 7 unchanged', () => {
    expect(usdcPaymentAmount(money(10_000_000n, 'USDC', 7))).toBe('1.0000000')
    expect(usdcPaymentAmount(money(1n, 'USDC', 7))).toBe('0.0000001')
  })

  it('rejects a non-USDC asset, a zero amount, and any other scale', () => {
    expect(kind(() => usdcPaymentAmount(money(1n, 'COP', 2)))).toBe('invalid')
    expect(kind(() => usdcPaymentAmount(money(0n, 'USDC', 7)))).toBe('invalid')
    expect(kind(() => usdcPaymentAmount(money(1n, 'USDC', 3)))).toBe('invalid')
    expect(kind(() => usdcPaymentAmount(money(1n, 'USDC', 8)))).toBe('invalid')
  })
})

describe('transfer destination', () => {
  it('accepts an Ed25519 account and rejects other shapes', () => {
    expect(() => {
      assertTransferDestination(Keypair.random().publicKey())
    }).not.toThrow()
    expect(
      kind(() => {
        assertTransferDestination('not-an-address')
      }),
    ).toBe('invalid')
    expect(
      kind(() => {
        assertTransferDestination(`S${'A'.repeat(55)}`)
      }),
    ).toBe('invalid')
  })
})

describe('trustline room', () => {
  it('counts buying liabilities against the limit and ignores selling liabilities', () => {
    expect(
      trustlineCanReceive({
        balance: 5n,
        buyingLiabilities: 4n,
        limit: 10n,
        authorized: true,
      }),
    ).toBe(true)
    expect(
      trustlineCanReceive({
        balance: 5n,
        buyingLiabilities: 5n,
        limit: 10n,
        authorized: true,
      }),
    ).toBe(false)
    expect(
      trustlineCanReceive({
        balance: 0n,
        buyingLiabilities: 0n,
        limit: 10n,
        authorized: false,
      }),
    ).toBe(false)
  })
})

describe('MEMO_TEXT', () => {
  it('accepts 28 bytes and rejects a longer memo', () => {
    expect(() => {
      assertMemoText('a'.repeat(28))
    }).not.toThrow()
    expect(() => {
      assertMemoText('é'.repeat(14))
    }).not.toThrow()
    expect(
      kind(() => {
        assertMemoText('')
      }),
    ).toBe('invalid')
    expect(
      kind(() => {
        assertMemoText('a'.repeat(29))
      }),
    ).toBe('invalid')
    expect(
      kind(() => {
        assertMemoText('é'.repeat(15))
      }),
    ).toBe('invalid')
  })
})

describe('network fee and passphrase', () => {
  it('doubles the network base fee', () => {
    expect(doubledBaseFee(100)).toBe('200')
    expect(
      kind(() => {
        doubledBaseFee(0)
      }),
    ).toBe('unavailable')
    expect(
      kind(() => {
        doubledBaseFee(1.5)
      }),
    ).toBe('unavailable')
  })

  it('uses the public testnet passphrase and a 24 hour window', () => {
    expect(TESTNET_PASSPHRASE).toBe('Test SDF Network ; September 2015')
    expect(Networks.TESTNET).toBe(TESTNET_PASSPHRASE)
    expect(TRANSFER_WINDOW_SECONDS).toBe(24 * 60 * 60)
  })
})

describe('submit idempotency decision', () => {
  it('returns success when the hash is already on the ledger', () => {
    expect(
      settleSubmit({ kind: 'success', ledger: 4 }, { kind: 'rejected', code: 'tx_bad_seq' }, null),
    ).toEqual({ kind: 'success', ledger: 4 })
  })

  it('returns the original failure when that hash already failed', () => {
    expect(
      settleSubmit({ kind: 'failed', code: 'op_underfunded' }, { kind: 'unknown' }, null),
    ).toEqual({ kind: 'rejected', code: 'op_underfunded' })
  })

  it('treats tx_bad_seq as success only when a later lookup shows that hash', () => {
    expect(
      settleSubmit(
        { kind: 'not_found' },
        { kind: 'rejected', code: 'tx_bad_seq' },
        { kind: 'success', ledger: 9 },
      ),
    ).toEqual({ kind: 'success', ledger: 9 })
    expect(
      settleSubmit(
        { kind: 'not_found' },
        { kind: 'rejected', code: 'tx_bad_seq' },
        { kind: 'not_found' },
      ),
    ).toEqual({ kind: 'rejected', code: 'tx_bad_seq' })
  })

  it('keeps a timeout unknown and a normal rejection rejected', () => {
    expect(settleSubmit({ kind: 'not_found' }, { kind: 'unknown' }, null)).toEqual({
      kind: 'unknown',
    })
    expect(
      settleSubmit({ kind: 'not_found' }, { kind: 'rejected', code: 'op_underfunded' }, null),
    ).toEqual({ kind: 'rejected', code: 'op_underfunded' })
    expect(settleSubmit({ kind: 'not_found' }, { kind: 'success', ledger: 3 }, null)).toEqual({
      kind: 'success',
      ledger: 3,
    })
  })
})

describe('horizon submit errors', () => {
  it('reads tx_bad_seq from an axios-shaped response and from a bare horizon body', () => {
    const axiosShaped = Object.assign(new Error('submit failed'), {
      response: {
        status: 400,
        data: { extras: { result_codes: { transaction: 'tx_bad_seq', operations: [] } } },
      },
    })
    expect(attemptFromHorizonError(axiosShaped)).toEqual({ kind: 'rejected', code: 'tx_bad_seq' })

    const bodyShaped = Object.assign(new Error('submit failed'), {
      response: {
        status: 400,
        extras: { result_codes: { transaction: 'tx_failed', operations: ['op_underfunded'] } },
      },
    })
    expect(attemptFromHorizonError(bodyShaped)).toEqual({
      kind: 'rejected',
      code: 'op_underfunded',
    })
    expect(attemptFromHorizonError(new Error('socket hang up'))).toEqual({ kind: 'unknown' })
  })
})

describe('isEnvelopeDead decision', () => {
  const alive = { maxTime: 2_000n, nowSeconds: 1_000n, accountSequence: 5n, envelopeSequence: 6n }

  it('is false when the hash is already on the ledger', () => {
    expect(envelopeIsDead({ ...alive, lookup: { kind: 'success', ledger: 1 } })).toBe(false)
    expect(envelopeIsDead({ ...alive, lookup: { kind: 'failed', code: 'op_underfunded' } })).toBe(
      false,
    )
  })

  it('is true when the sequence was consumed or the deadline passed, and the hash is absent', () => {
    expect(envelopeIsDead({ ...alive, lookup: { kind: 'not_found' } })).toBe(false)
    expect(
      envelopeIsDead({
        ...alive,
        lookup: { kind: 'not_found' },
        accountSequence: 6n,
      }),
    ).toBe(true)
    expect(
      envelopeIsDead({
        ...alive,
        lookup: { kind: 'not_found' },
        maxTime: 1_000n,
        nowSeconds: 1_000n,
      }),
    ).toBe(true)
  })
})

function kind(run: () => void): string {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(StellarError)
    if (error instanceof StellarError) return error.kind
  }
  throw new Error('expected StellarError')
}
