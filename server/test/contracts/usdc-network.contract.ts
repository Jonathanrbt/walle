import {
  FeeBumpTransaction,
  Keypair,
  MemoText,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk'
import { beforeAll, describe, expect, it } from 'vitest'
import { money, type Money } from '../../src/shared/money.ts'
import {
  StellarError,
  type PreparedTransfer,
  type UsdcNetwork,
} from '../../src/treasury/usdc-network.ts'
import { TESTNET_PASSPHRASE, TRANSFER_WINDOW_SECONDS } from '../../src/adapters/stellar/envelope.ts'

export interface UsdcNetworkFixture {
  readonly network: UsdcNetwork
  readonly usdcIssuer: string
  /** `blocked` means this subject cannot fund a USDC payment. Detail is safe to print. */
  readonly funding: 'ready' | 'blocked'
  readonly fundingDetail: string
  createAccount(): Promise<{ address: string; secret: string }>
  addUsdcTrustline(secret: string): Promise<void>
  /** Fake only: the next submit applies the envelope and then reports a timeout. */
  loseNextSubmitResponse?: () => void
}

const ONE_USDC = money(100n, 'USDC', 2)
const TENTH = money(1_000_000n, 'USDC', 7)
const FIFTH = money(2_000_000n, 'USDC', 7)

export function runUsdcNetworkContract(
  name: string,
  makeSubject: () => Promise<UsdcNetworkFixture>,
): void {
  describe(name, () => {
    let fx: UsdcNetworkFixture
    let bare = ''
    let ready = ''

    beforeAll(async () => {
      fx = await makeSubject()
      const withoutTrust = await fx.createAccount()
      bare = withoutTrust.address
      const withTrust = await fx.createAccount()
      await fx.addUsdcTrustline(withTrust.secret)
      ready = withTrust.address
    }, 180_000)

    it('rejects a malformed address, a missing account, and an account without USDC', async () => {
      expect(await fx.network.validateDestination('not-an-address')).toEqual({
        ok: false,
        reason: 'invalid_address',
      })
      expect(await fx.network.validateDestination('SNOTASECRET')).toEqual({
        ok: false,
        reason: 'invalid_address',
      })
      expect(await fx.network.validateDestination(Keypair.random().publicKey())).toEqual({
        ok: false,
        reason: 'account_not_found',
      })
      expect(await fx.network.validateDestination(bare)).toEqual({
        ok: false,
        reason: 'no_trustline',
      })
      expect(await fx.network.validateDestination(ready)).toEqual({ ok: true })
    }, 60_000)

    it('round-trips a signed payment envelope at scale 2', async () => {
      const prepared = await fx.network.prepareTransfer({
        to: ready,
        amount: ONE_USDC,
        memo: 'cash-in',
      })
      const tx = readPayment(prepared)
      expect(tx.hash().toString('hex')).toBe(prepared.txHash)
      expect(tx.sequence).toBe(prepared.sequence)
      const operation = tx.operations[0]
      expect(operation?.type).toBe('payment')
      if (operation?.type !== 'payment') return
      expect(operation.destination).toBe(ready)
      expect(operation.amount).toBe('1.0000000')
      expect(operation.asset.code).toBe('USDC')
      expect(operation.asset.issuer).toBe(fx.usdcIssuer)
      expect(tx.memo.type).toBe(MemoText)
      expect(memoText(tx.memo.value)).toBe('cash-in')
      const maxTime = Number(tx.timeBounds?.maxTime ?? '0')
      const now = Math.floor(Date.now() / 1000)
      expect(Math.abs(maxTime - (now + TRANSFER_WINDOW_SECONDS))).toBeLessThanOrEqual(120)
    }, 60_000)

    it('rejects a memo longer than 28 bytes before signing', async () => {
      await expect(
        fx.network.prepareTransfer({ to: ready, amount: TENTH, memo: 'a'.repeat(29) }),
      ).rejects.toBeInstanceOf(StellarError)
    })

    it('moves USDC once when the same envelope is submitted twice', async (ctx) => {
      if (fx.funding === 'blocked') {
        ctx.skip(fx.fundingDetail)
        return
      }
      const before = await fx.network.balance()
      const prepared = await fx.network.prepareTransfer({
        to: ready,
        amount: ONE_USDC,
        memo: 'paid-once',
      })
      const first = await fx.network.submit(prepared)
      expect(first.kind).toBe('success')
      const after = await fx.network.balance()
      expect(after.amount).toBe(before.amount - 10_000_000n)
      expect(after.assetScale).toBe(7)
      const second = await fx.network.submit(prepared)
      expect(second).toEqual(first)
      expect((await fx.network.balance()).amount).toBe(after.amount)
      expect(await fx.network.lookup(prepared.txHash)).toEqual(first)
    }, 90_000)

    it('resolves a lost submit response from lookup without paying twice', async (ctx) => {
      if (fx.loseNextSubmitResponse === undefined) {
        ctx.skip('timeout-after-apply is injected on the in-memory ledger only')
        return
      }
      if (fx.funding === 'blocked') {
        ctx.skip(fx.fundingDetail)
        return
      }
      const before = await fx.network.balance()
      const prepared = await fx.network.prepareTransfer({
        to: ready,
        amount: TENTH,
        memo: 'lost-response',
      })
      fx.loseNextSubmitResponse()
      const outcome = await fx.network.submit(prepared)
      expect(outcome).toEqual({ kind: 'unknown' })
      const found = await fx.network.lookup(prepared.txHash)
      expect(found.kind).toBe('success')
      const spent = (await fx.network.balance()).amount
      expect(spent).toBe(before.amount - TENTH.amount)
      const retry = await fx.network.submit(prepared)
      expect(retry).toEqual(found)
      expect((await fx.network.balance()).amount).toBe(spent)
    }, 60_000)

    it('marks an envelope dead after another transaction consumes its sequence', async (ctx) => {
      if (fx.funding === 'blocked') {
        ctx.skip(fx.fundingDetail)
        return
      }
      const before = await fx.network.balance()
      const original = await fx.network.prepareTransfer({
        to: ready,
        amount: TENTH,
        memo: 'never-sent',
      })
      const other = await fx.network.prepareTransfer({
        to: ready,
        amount: FIFTH,
        memo: 'consumed-seq',
      })
      expect(other.sequence).toBe(original.sequence)
      const sent = await fx.network.submit(other)
      expect(sent.kind).toBe('success')
      expect(await fx.network.lookup(original.txHash)).toEqual({ kind: 'not_found' })
      expect(await fx.network.isEnvelopeDead(original)).toBe(true)
      const retry = await fx.network.submit(original)
      expect(retry).toEqual({ kind: 'rejected', code: 'tx_bad_seq' })
      expect((await fx.network.balance()).amount).toBe(before.amount - FIFTH.amount)
    }, 90_000)
  })
}

function readPayment(prepared: PreparedTransfer): Transaction {
  const parsed = TransactionBuilder.fromXDR(prepared.envelopeXdr, TESTNET_PASSPHRASE)
  expect(parsed).not.toBeInstanceOf(FeeBumpTransaction)
  if (!(parsed instanceof Transaction)) throw new Error('expected a transaction envelope')
  return parsed
}

function memoText(value: string | Buffer | null): string {
  if (typeof value === 'string') return value
  if (value instanceof Uint8Array) return Buffer.from(value).toString('utf8')
  return ''
}

export const PAYMENT_FLOOR: Money = money(200n, 'USDC', 2)
export const REFILL_TARGET: Money = money(2000n, 'USDC', 2)
