import {
  Asset,
  Horizon,
  NetworkError,
  Operation,
  StrKey,
  Transaction,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk'
import { money, type Money } from '../../shared/money.ts'
import {
  StellarError,
  type DestinationCheck,
  type EnvelopeVerdict,
  type LookupResult,
  type PreparedTransfer,
  type RefillResult,
  type SubmitOutcome,
  type UsdcNetwork,
} from '../../treasury/usdc-network.ts'
import {
  assertMemoText,
  assertTransferDestination,
  decimalStroops,
  doubledBaseFee,
  stroopsDecimal,
  trustlineCanReceive,
  usdcPaymentAmount,
  usdcTarget,
  USDC_CODE,
  USDC_SCALE,
} from './amounts.ts'
import { envelopeIsDead, ENVELOPE_DEAD_MARGIN_SECONDS } from './dead-envelope.ts'
import { readEnvelope, signOperation, TESTNET_PASSPHRASE } from './envelope.ts'
import { operatorKeypair } from './keys.ts'
import { Mutex } from './mutex.ts'
import {
  attemptFromHorizonError,
  horizonFailureCode,
  isHorizonNotFound,
  settleSubmit,
  type SubmitAttempt,
} from './submit-outcome.ts'

const SEND_MAX_NUMERATOR = 105n
const SEND_MAX_DENOMINATOR = 100n
const BASE_RESERVE_STROOPS = 5_000_000n

export interface HorizonUsdcNetworkOptions {
  readonly horizonUrl: string
  readonly usdcIssuer: string
  readonly operatorSecret: string
  readonly now?: () => Date
  /** Ingest margin after maxTime. Defaults to 30 seconds. */
  readonly deadMarginSeconds?: number
}

/**
 * Horizon testnet adapter. Sequence-advancing calls (`ensureOperatorReady`, `prepareTransfer`,
 * `submit`, `refill`) share one mutex. `prepareTransfer` and `submit` are still separate
 * acquisitions, so a refill between them kills the prepared envelope.
 */
export class HorizonUsdcNetwork implements UsdcNetwork {
  private readonly server: Horizon.Server
  private readonly issuer: string
  private readonly signer: ReturnType<typeof operatorKeypair>
  private readonly mutex = new Mutex()
  private readonly now: () => Date
  private readonly deadMarginSeconds: bigint

  constructor(options: HorizonUsdcNetworkOptions) {
    if (!StrKey.isValidEd25519PublicKey(options.usdcIssuer)) {
      throw new StellarError('invalid', 'USDC issuer is not a Stellar account')
    }
    this.server = new Horizon.Server(options.horizonUrl)
    this.issuer = options.usdcIssuer
    this.signer = operatorKeypair(options.operatorSecret)
    this.now = options.now ?? (() => new Date())
    this.deadMarginSeconds =
      options.deadMarginSeconds === undefined
        ? ENVELOPE_DEAD_MARGIN_SECONDS
        : BigInt(options.deadMarginSeconds)
  }

  async ensureOperatorReady(): Promise<void> {
    await this.mutex.run(async () => {
      const fee = await this.fee()
      const account = await this.loadOperator()
      if (usdcLine(account.balances, this.issuer) !== null) return
      const prepared = this.sign(
        account.sequenceNumber(),
        fee,
        Operation.changeTrust({ asset: this.asset() }),
        null,
      )
      const outcome = await this.attempt(prepared.envelopeXdr)
      if (outcome.kind === 'success') return
      if (outcome.kind === 'unknown') {
        throw new StellarError('unavailable', 'horizon did not confirm the USDC trustline')
      }
      throw new StellarError('operator_not_ready', `USDC trustline was rejected (${outcome.code})`)
    })
  }

  async balance(): Promise<Money> {
    const account = await this.loadOperator()
    const line = usdcLine(account.balances, this.issuer)
    if (line === null)
      throw new StellarError('operator_not_ready', 'operator has no USDC trustline')
    return money(decimalStroops(line.balance, USDC_CODE), USDC_CODE, USDC_SCALE)
  }

  async validateDestination(address: string): Promise<DestinationCheck> {
    if (!StrKey.isValidEd25519PublicKey(address)) return { ok: false, reason: 'invalid_address' }
    let account: Horizon.AccountResponse
    try {
      account = await this.server.loadAccount(address)
    } catch (error) {
      if (isHorizonNotFound(error)) return { ok: false, reason: 'account_not_found' }
      throw unavailable(error)
    }
    const line = usdcLine(account.balances, this.issuer)
    if (line === null || !trustlineCanReceive(trustlineInput(line))) {
      return { ok: false, reason: 'no_trustline' }
    }
    return { ok: true }
  }

  async prepareTransfer(input: {
    to: string
    amount: Money
    memo: string
  }): Promise<PreparedTransfer> {
    assertTransferDestination(input.to)
    assertMemoText(input.memo)
    const amount = usdcPaymentAmount(input.amount)
    return this.mutex.run(async () => {
      const fee = await this.fee()
      const account = await this.loadOperator()
      return this.sign(
        account.sequenceNumber(),
        fee,
        Operation.payment({ destination: input.to, asset: this.asset(), amount }),
        input.memo,
      )
    })
  }

  async submit(prepared: PreparedTransfer): Promise<SubmitOutcome> {
    return this.mutex.run(async () => {
      const before = await this.lookupOrUnknown(prepared.txHash)
      if (before === 'unknown') return { kind: 'unknown' }
      if (before.kind !== 'not_found') return settleSubmit(before, { kind: 'unknown' }, null)
      const attempt = await this.attempt(prepared.envelopeXdr)
      if (attempt.kind === 'rejected' && attempt.code === 'tx_bad_seq') {
        const after = await this.lookupOrUnknown(prepared.txHash)
        if (after === 'unknown') return { kind: 'unknown' }
        return settleSubmit(before, attempt, after)
      }
      return settleSubmit(before, attempt, null)
    })
  }

  async lookup(txHash: string): Promise<LookupResult> {
    try {
      const found = await this.server.transactions().transaction(txHash).call()
      if (found.successful) return { kind: 'success', ledger: found.ledger_attr }
      return { kind: 'failed', code: horizonFailureCode(found.result_xdr) }
    } catch (error) {
      if (isHorizonNotFound(error)) return { kind: 'not_found' }
      throw unavailable(error)
    }
  }

  async refill(input: { targetUsdc: Money }): Promise<RefillResult> {
    return this.mutex.run(async () => {
      const account = await this.loadOperator()
      const line = usdcLine(account.balances, this.issuer)
      if (line === null)
        throw new StellarError('operator_not_ready', 'operator has no USDC trustline')
      const current = decimalStroops(line.balance, USDC_CODE)
      const target = usdcTarget(input.targetUsdc)
      if (current >= target.amount) {
        throw new StellarError('invalid', 'operator USDC is already at the target')
      }
      const gap = target.amount - current
      const destAmount = stroopsDecimal(gap, USDC_CODE)
      const path = await this.cheapestNativePath(destAmount)
      const cost = decimalStroops(path.source_amount, 'XLM')
      const sendMax = (cost * SEND_MAX_NUMERATOR + SEND_MAX_DENOMINATOR - 1n) / SEND_MAX_DENOMINATOR
      const feeText = await this.fee()
      const native = nativeBalance(account.balances)
      if (native < sendMax + BigInt(feeText) + minimumBalance(account.subentry_count)) {
        throw new StellarError('no_path', 'operator XLM cannot cover the USDC path')
      }
      const fresh = await this.loadOperator()
      const prepared = this.sign(
        fresh.sequenceNumber(),
        feeText,
        Operation.pathPaymentStrictReceive({
          sendAsset: Asset.native(),
          sendMax: stroopsDecimal(sendMax, 'XLM'),
          destination: this.signer.publicKey(),
          destAsset: this.asset(),
          destAmount,
          path: path.path.map(assetFromHorizon),
        }),
        null,
      )
      const outcome = await this.attempt(prepared.envelopeXdr)
      if (outcome.kind === 'success') {
        return { txHash: prepared.txHash, usdc: money(gap, USDC_CODE, USDC_SCALE) }
      }
      if (outcome.kind === 'unknown') {
        throw new StellarError('unavailable', 'horizon did not confirm the USDC refill')
      }
      if (isPathRejection(outcome.code)) {
        throw new StellarError(
          'no_path',
          `no XLM to USDC path can fund the target (${outcome.code})`,
        )
      }
      throw new StellarError('unavailable', `horizon rejected the USDC refill (${outcome.code})`)
    })
  }

  async isEnvelopeDead(prepared: PreparedTransfer): Promise<EnvelopeVerdict> {
    const env = readEnvelope(prepared.envelopeXdr)
    // Sequence and time are fixed before the lookup. A transaction that consumes
    // the sequence is included by the time that lookup runs, so `not_found` cannot
    // be this envelope. Expiry uses the same lookup: it is dead only after maxTime
    // plus the ingest margin, and only while the hash is still absent.
    const accountSequence = BigInt((await this.loadOperator()).sequenceNumber())
    const nowSeconds = BigInt(Math.floor(this.now().getTime() / 1000))
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

  private async loadOperator(): Promise<Horizon.AccountResponse> {
    try {
      return await this.server.loadAccount(this.signer.publicKey())
    } catch (error) {
      if (isHorizonNotFound(error)) {
        throw new StellarError('operator_not_ready', 'operator account does not exist')
      }
      throw unavailable(error)
    }
  }

  private async fee(): Promise<string> {
    try {
      return doubledBaseFee(await this.server.fetchBaseFee())
    } catch (error) {
      throw unavailable(error)
    }
  }

  private sign(
    sequence: string,
    fee: string,
    operation: xdr.Operation,
    memo: string | null,
  ): PreparedTransfer {
    return signOperation({
      sourcePublicKey: this.signer.publicKey(),
      sourceSequence: sequence,
      feePerOperation: fee,
      signer: this.signer,
      operation,
      memo,
    })
  }

  private async attempt(envelopeXdr: string): Promise<SubmitAttempt> {
    const parsed = TransactionBuilder.fromXDR(envelopeXdr, TESTNET_PASSPHRASE)
    if (!(parsed instanceof Transaction)) {
      throw new StellarError('invalid', 'envelope must be a transaction')
    }
    return this.submitBuilt(parsed)
  }

  private async submitBuilt(tx: Transaction): Promise<SubmitAttempt> {
    try {
      const response = await this.server.submitTransaction(tx, { skipMemoRequiredCheck: true })
      if (!response.successful)
        return { kind: 'rejected', code: horizonFailureCode(response.result_xdr) }
      return { kind: 'success', ledger: response.ledger }
    } catch (error) {
      return attemptFromHorizonError(error)
    }
  }

  private async cheapestNativePath(
    destAmount: string,
  ): Promise<Horizon.ServerApi.PaymentPathRecord> {
    let page: Horizon.ServerApi.CollectionPage<Horizon.ServerApi.PaymentPathRecord>
    try {
      page = await this.server
        .strictReceivePaths(this.signer.publicKey(), this.asset(), destAmount)
        .call()
    } catch (error) {
      throw unavailable(error)
    }
    let best: Horizon.ServerApi.PaymentPathRecord | null = null
    let bestCost = 0n
    for (const record of page.records) {
      if (record.source_asset_type !== 'native') continue
      const cost = decimalStroops(record.source_amount, 'XLM')
      if (best === null || cost < bestCost) {
        best = record
        bestCost = cost
      }
    }
    if (best === null) throw new StellarError('no_path', 'no XLM to USDC path can fund the target')
    return best
  }

  private async lookupOrUnknown(txHash: string): Promise<LookupResult | 'unknown'> {
    try {
      return await this.lookup(txHash)
    } catch (error) {
      if (error instanceof StellarError && error.kind === 'unavailable') return 'unknown'
      throw error
    }
  }

  private asset(): Asset {
    return new Asset(USDC_CODE, this.issuer)
  }
}

function usdcLine(
  balances: readonly Horizon.HorizonApi.BalanceLine[],
  issuer: string,
): Horizon.HorizonApi.BalanceLineAsset | null {
  for (const line of balances) {
    if (
      (line.asset_type === 'credit_alphanum4' || line.asset_type === 'credit_alphanum12') &&
      line.asset_code === USDC_CODE &&
      line.asset_issuer === issuer
    ) {
      return line
    }
  }
  return null
}

function trustlineInput(line: Horizon.HorizonApi.BalanceLineAsset): {
  balance: bigint
  buyingLiabilities: bigint
  limit: bigint
  authorized: boolean
} {
  return {
    balance: decimalStroops(line.balance, USDC_CODE),
    buyingLiabilities: decimalStroops(line.buying_liabilities, USDC_CODE),
    limit: decimalStroops(line.limit, USDC_CODE),
    authorized: line.is_authorized,
  }
}

function nativeBalance(balances: readonly Horizon.HorizonApi.BalanceLine[]): bigint {
  for (const line of balances) {
    if (line.asset_type === 'native') return decimalStroops(line.balance, 'XLM')
  }
  return 0n
}

function minimumBalance(subentryCount: number): bigint {
  return (2n + BigInt(subentryCount)) * BASE_RESERVE_STROOPS
}

function assetFromHorizon(entry: {
  asset_type: string
  asset_code: string
  asset_issuer: string
}): Asset {
  if (entry.asset_type === 'native') return Asset.native()
  if (entry.asset_code.length === 0 || entry.asset_issuer.length === 0) {
    throw new StellarError('unavailable', 'horizon returned a path asset without an issuer')
  }
  return new Asset(entry.asset_code, entry.asset_issuer)
}

function isPathRejection(code: string): boolean {
  return (
    code === 'op_too_few_offers' ||
    code === 'op_over_source_max' ||
    code === 'op_src_no_trust' ||
    code === 'op_underfunded' ||
    code === 'tx_insufficient_balance'
  )
}

function unavailable(error: unknown): StellarError {
  if (error instanceof StellarError) return error
  if (error instanceof NetworkError) {
    const status = error.response.status
    const label = status === undefined ? 'network' : String(status)
    return new StellarError('unavailable', `horizon request failed (${label})`)
  }
  return new StellarError('unavailable', 'horizon request failed')
}
