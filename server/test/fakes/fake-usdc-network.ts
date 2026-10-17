import { Asset, Keypair, Operation, StrKey, xdr } from '@stellar/stellar-sdk'
import { signOperation } from '../../src/adapters/stellar/envelope.ts'
import {
  assertMemoText,
  assertTransferDestination,
  decimalStroops,
  doubledBaseFee,
  stroopsDecimal,
  trustlineCanReceive,
  usdcAtScale7,
  usdcPaymentAmount,
  usdcTarget,
  USDC_CODE,
  USDC_SCALE,
} from '../../src/adapters/stellar/amounts.ts'
import {
  envelopeIsDead,
  ENVELOPE_DEAD_MARGIN_SECONDS,
} from '../../src/adapters/stellar/dead-envelope.ts'
import { Mutex } from '../../src/adapters/stellar/mutex.ts'
import { settleSubmit } from '../../src/adapters/stellar/submit-outcome.ts'
import { readEnvelope } from '../../src/adapters/stellar/envelope.ts'
import { money, type Money } from '../../src/shared/money.ts'
import {
  StellarError,
  type EnvelopeVerdict,
  type LookupResult,
  type PreparedTransfer,
  type RefillResult,
  type SubmitOutcome,
  type UsdcNetwork,
} from '../../src/treasury/usdc-network.ts'

const BASE_FEE = 100
/** 1.5 XLM cannot buy 1 USDC. The contract uses that balance to prove `no_path`. */
const XLM_STROOPS_PER_USDC_STROOP = 2n
const DEFAULT_XLM = 100n * 10_000_000n
const MAX_LIMIT = 9223372036854775807n

type SubmitFault = 'timeout' | 'bad_seq' | 'underfunded'

interface Trustline {
  balance: bigint
  sellingLiabilities: bigint
  buyingLiabilities: bigint
  limit: bigint
  authorized: boolean
}

interface AccountState {
  secret: string
  sequence: bigint
  xlm: bigint
  usdc: Trustline | null
}

interface LedgerTx {
  kind: 'success' | 'failed'
  ledger: number
  code: string
}

export interface TrustlineSeed {
  readonly limit: Money
  readonly balance: Money
  readonly buyingLiabilities?: Money
}

/**
 * In-memory USDC ledger. Envelopes are built with the real SDK, so hashes match Horizon.
 * `failNextSubmitWith('timeout')` does not apply. `loseNextSubmitResponse` applies, then
 * reports a timeout so a later lookup is the only proof. `hideNextLookup` drops one lookup.
 */
export class FakeUsdcNetwork implements UsdcNetwork {
  readonly usdcIssuer: string
  private readonly operator: Keypair
  private readonly accounts = new Map<string, AccountState>()
  private readonly txs = new Map<string, LedgerTx>()
  private readonly mutex = new Mutex()
  private ledger = 0
  private fault: SubmitFault | null = null
  private loseResponse = false
  private hideLookup = false
  private applyBetweenReads = false
  private now: () => Date = () => new Date()
  private deadMarginSeconds: bigint = ENVELOPE_DEAD_MARGIN_SECONDS

  constructor() {
    this.operator = Keypair.random()
    this.usdcIssuer = Keypair.random().publicKey()
    this.accounts.set(this.operator.publicKey(), {
      secret: this.operator.secret(),
      sequence: 0n,
      xlm: DEFAULT_XLM,
      usdc: null,
    })
  }

  creditOperator(amount: Money): void {
    const line = this.operatorLine()
    line.balance += usdcAtScale7(amount).amount
  }

  setOperatorUsdc(amount: Money): void {
    this.operatorLine().balance = usdcTarget(amount).amount
  }

  setOperatorXlm(amount: Money): void {
    if (amount.assetCode !== 'XLM' || amount.assetScale !== USDC_SCALE) {
      throw new StellarError('invalid', 'XLM amount scale must be 7')
    }
    this.requireOperator().xlm = amount.amount
  }

  removeOperator(): void {
    this.accounts.delete(this.operator.publicKey())
  }

  failNextSubmitWith(fault: SubmitFault): void {
    this.fault = fault
  }

  loseNextSubmitResponse(): void {
    this.loseResponse = true
  }

  hideNextLookup(): void {
    this.hideLookup = true
  }

  /**
   * The next `isEnvelopeDead` includes this envelope after it has sampled the
   * account sequence and before it looks the hash up.
   */
  armApplyBetweenDeadReads(): void {
    this.applyBetweenReads = true
  }

  useNow(now: () => Date): void {
    this.now = now
  }

  createAccount(): Promise<{ address: string; secret: string }> {
    const keypair = Keypair.random()
    const address = keypair.publicKey()
    this.accounts.set(address, {
      secret: keypair.secret(),
      sequence: 0n,
      xlm: DEFAULT_XLM,
      usdc: null,
    })
    return Promise.resolve({ address, secret: keypair.secret() })
  }

  addUsdcTrustline(secret: string, seed?: TrustlineSeed): Promise<void> {
    const account = this.accountBySecret(secret)
    const limit = seed === undefined ? MAX_LIMIT : usdcTarget(seed.limit).amount
    const balance = seed === undefined ? 0n : usdcTarget(seed.balance).amount
    const buyingLiabilities =
      seed?.buyingLiabilities === undefined ? 0n : usdcTarget(seed.buyingLiabilities).amount
    account.usdc = { balance, sellingLiabilities: 0n, buyingLiabilities, limit, authorized: true }
    return Promise.resolve()
  }

  async ensureOperatorReady(): Promise<void> {
    await this.mutex.run(() => {
      const account = this.requireOperator()
      if (account.usdc !== null) return Promise.resolve()
      const prepared = this.sign(account, Operation.changeTrust({ asset: this.asset() }), null)
      account.usdc = {
        balance: 0n,
        sellingLiabilities: 0n,
        buyingLiabilities: 0n,
        limit: MAX_LIMIT,
        authorized: true,
      }
      this.advance(account, this.envelopeSequence(prepared), prepared.txHash, 'success', '')
      return Promise.resolve()
    })
  }

  balance(): Promise<Money> {
    try {
      return Promise.resolve(money(this.operatorLine().balance, USDC_CODE, USDC_SCALE))
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error('operator balance failed'))
    }
  }

  validateDestination(
    address: string,
  ): Promise<
    { ok: true } | { ok: false; reason: 'invalid_address' | 'account_not_found' | 'no_trustline' }
  > {
    if (!StrKey.isValidEd25519PublicKey(address)) {
      return Promise.resolve({ ok: false, reason: 'invalid_address' })
    }
    const account = this.accounts.get(address)
    if (account === undefined) return Promise.resolve({ ok: false, reason: 'account_not_found' })
    if (!this.lineCanReceive(account.usdc)) {
      return Promise.resolve({ ok: false, reason: 'no_trustline' })
    }
    return Promise.resolve({ ok: true })
  }

  async prepareTransfer(input: {
    to: string
    amount: Money
    memo: string
  }): Promise<PreparedTransfer> {
    assertTransferDestination(input.to)
    assertMemoText(input.memo)
    const amount = usdcPaymentAmount(input.amount)
    return this.mutex.run(() => {
      const account = this.requireOperator()
      return Promise.resolve(
        this.sign(
          account,
          Operation.payment({ destination: input.to, asset: this.asset(), amount }),
          input.memo,
        ),
      )
    })
  }

  async submit(prepared: PreparedTransfer): Promise<SubmitOutcome> {
    return this.mutex.run(async () => {
      const before = await this.lookup(prepared.txHash)
      if (before.kind !== 'not_found') return settleSubmit(before, { kind: 'unknown' }, null)
      const fault = this.fault
      this.fault = null
      if (fault === 'timeout') return { kind: 'unknown' }
      if (fault === 'bad_seq') return { kind: 'rejected', code: 'tx_bad_seq' }
      if (this.loseResponse) {
        this.loseResponse = false
        const applied = this.apply(prepared, null)
        if (applied.kind === 'success') return { kind: 'unknown' }
        return applied
      }
      return this.apply(prepared, fault === 'underfunded' ? 'underfunded' : null)
    })
  }

  lookup(txHash: string): Promise<LookupResult> {
    if (this.hideLookup) {
      this.hideLookup = false
      return Promise.resolve({ kind: 'not_found' })
    }
    const found = this.txs.get(txHash)
    if (found === undefined) return Promise.resolve({ kind: 'not_found' })
    if (found.kind === 'success') return Promise.resolve({ kind: 'success', ledger: found.ledger })
    return Promise.resolve({ kind: 'failed', code: found.code })
  }

  refill(input: { targetUsdc: Money }): Promise<RefillResult> {
    return this.mutex.run(() => {
      const account = this.requireOperator()
      const line = account.usdc
      if (line === null)
        throw new StellarError('operator_not_ready', 'operator has no USDC trustline')
      const target = usdcTarget(input.targetUsdc)
      if (line.balance >= target.amount) {
        throw new StellarError('invalid', 'operator USDC is already at the target')
      }
      const gap = target.amount - line.balance
      const cost = gap * XLM_STROOPS_PER_USDC_STROOP
      const fee = BigInt(this.fee())
      if (account.xlm < cost + fee) {
        throw new StellarError('no_path', 'no XLM to USDC path can fund the target')
      }
      const prepared = this.sign(
        account,
        Operation.pathPaymentStrictReceive({
          sendAsset: Asset.native(),
          sendMax: stroopsDecimal(cost, 'XLM'),
          destination: this.operator.publicKey(),
          destAsset: this.asset(),
          destAmount: stroopsDecimal(gap, USDC_CODE),
          path: [],
        }),
        null,
      )
      account.xlm -= cost + fee
      line.balance += gap
      this.advance(account, this.envelopeSequence(prepared), prepared.txHash, 'success', '')
      return Promise.resolve({ txHash: prepared.txHash, usdc: money(gap, USDC_CODE, USDC_SCALE) })
    })
  }

  async isEnvelopeDead(prepared: PreparedTransfer): Promise<EnvelopeVerdict> {
    const env = readEnvelope(prepared.envelopeXdr)
    // Same order as Horizon: copy the sequence and the clock, then look up.
    // Applying the envelope between those reads must make the lookup succeed.
    const accountSequence = this.requireOperator().sequence
    const nowSeconds = BigInt(Math.floor(this.now().getTime() / 1000))
    if (this.applyBetweenReads) {
      this.applyBetweenReads = false
      this.apply(prepared, null)
    }
    const lookup = await this.lookup(prepared.txHash)
    return {
      dead: envelopeIsDead({
        lookup,
        maxTime: env.maxTime,
        nowSeconds,
        accountSequence,
        envelopeSequence: BigInt(env.sequence),
        marginSeconds: this.deadMarginSeconds,
      }),
      accountSequence: accountSequence.toString(),
    }
  }

  private envelopeSequence(prepared: PreparedTransfer): string {
    return readEnvelope(prepared.envelopeXdr).sequence
  }

  private apply(prepared: PreparedTransfer, fault: 'underfunded' | null): SubmitOutcome {
    const payment = this.paymentOf(prepared)
    const operator = this.requireOperator()
    if (BigInt(payment.sequence) !== operator.sequence + 1n) {
      const recorded = this.txs.get(prepared.txHash)
      const after: LookupResult =
        recorded === undefined
          ? { kind: 'not_found' }
          : recorded.kind === 'success'
            ? { kind: 'success', ledger: recorded.ledger }
            : { kind: 'failed', code: recorded.code }
      return settleSubmit({ kind: 'not_found' }, { kind: 'rejected', code: 'tx_bad_seq' }, after)
    }
    const line = operator.usdc
    if (line === null)
      throw new StellarError('operator_not_ready', 'operator has no USDC trustline')
    if (fault === 'underfunded' || line.balance < payment.amount) {
      this.advance(operator, payment.sequence, prepared.txHash, 'failed', 'op_underfunded')
      return { kind: 'rejected', code: 'op_underfunded' }
    }
    const destination = this.accounts.get(payment.destination)
    const code = receiveCode(destination?.usdc, payment.amount)
    if (code !== null) {
      this.advance(operator, payment.sequence, prepared.txHash, 'failed', code)
      return { kind: 'rejected', code }
    }
    line.balance -= payment.amount
    const destLine = destination?.usdc
    if (destLine === undefined || destLine === null) {
      throw new StellarError('unavailable', 'destination trustline disappeared')
    }
    destLine.balance += payment.amount
    operator.xlm -= payment.feeStroops
    this.advance(operator, payment.sequence, prepared.txHash, 'success', '')
    const recorded = this.txs.get(prepared.txHash)
    if (recorded?.kind !== 'success') {
      throw new StellarError('unavailable', 'applied transaction was not recorded')
    }
    return { kind: 'success', ledger: recorded.ledger }
  }

  private paymentOf(prepared: PreparedTransfer): {
    sequence: string
    destination: string
    amount: bigint
    feeStroops: bigint
  } {
    const env = readEnvelope(prepared.envelopeXdr)
    if (env.hash !== prepared.txHash) {
      throw new StellarError('invalid', 'envelope hash does not match')
    }
    if (env.source !== this.operator.publicKey()) {
      throw new StellarError('invalid', 'envelope source is not the operator')
    }
    const operation = env.operation
    if (operation.type !== 'payment') {
      throw new StellarError('invalid', 'envelope operation must be a payment')
    }
    if (operation.asset.code !== USDC_CODE || operation.asset.issuer !== this.usdcIssuer) {
      throw new StellarError('invalid', 'envelope asset is not operator USDC')
    }
    return {
      sequence: env.sequence,
      destination: operation.destination,
      amount: decimalStroops(operation.amount, USDC_CODE),
      feeStroops: env.feeStroops,
    }
  }

  private sign(
    account: AccountState,
    operation: xdr.Operation,
    memo: string | null,
  ): PreparedTransfer {
    return signOperation({
      sourcePublicKey: this.operator.publicKey(),
      sourceSequence: account.sequence.toString(),
      feePerOperation: this.fee(),
      signer: this.operator,
      operation,
      memo,
    })
  }

  private advance(
    account: AccountState,
    sequence: string,
    txHash: string,
    kind: 'success' | 'failed',
    code: string,
  ): void {
    this.ledger += 1
    account.sequence = BigInt(sequence)
    this.txs.set(txHash, { kind, ledger: this.ledger, code })
  }

  private fee(): string {
    return doubledBaseFee(BASE_FEE)
  }

  private asset(): Asset {
    return new Asset(USDC_CODE, this.usdcIssuer)
  }

  private requireOperator(): AccountState {
    const account = this.accounts.get(this.operator.publicKey())
    if (account === undefined) {
      throw new StellarError('operator_not_ready', 'operator account does not exist')
    }
    return account
  }

  private operatorLine(): Trustline {
    const line = this.requireOperator().usdc
    if (line === null)
      throw new StellarError('operator_not_ready', 'operator has no USDC trustline')
    return line
  }

  private accountBySecret(secret: string): AccountState {
    for (const account of this.accounts.values()) {
      if (account.secret === secret) return account
    }
    throw new StellarError('invalid', 'account secret is not on the ledger')
  }

  private lineCanReceive(line: Trustline | null): boolean {
    if (line === null) return false
    return trustlineCanReceive(line)
  }
}

function receiveCode(line: Trustline | null | undefined, amount: bigint): string | null {
  if (line === undefined || line === null) return 'op_no_trust'
  if (!line.authorized) return 'op_not_authorized'
  if (line.balance + line.buyingLiabilities + amount > line.limit) return 'op_line_full'
  return null
}
