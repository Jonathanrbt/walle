import {
  Account,
  Keypair,
  Memo,
  Networks,
  Transaction,
  TransactionBuilder,
  xdr,
  type Operation,
} from '@stellar/stellar-sdk'
import type { PreparedTransfer } from '../../treasury/usdc-network.ts'
import { StellarError } from '../../treasury/usdc-network.ts'

/** Public testnet passphrase. Payments are signed only for this network. */
export const TESTNET_PASSPHRASE: string = Networks.TESTNET

export const TRANSFER_WINDOW_SECONDS = 24 * 60 * 60

export interface ReadEnvelope {
  readonly source: string
  readonly sequence: string
  readonly feeStroops: bigint
  readonly maxTime: bigint
  readonly hash: string
  readonly memo: string
  readonly operation: Operation
}

export function signOperation(input: {
  sourcePublicKey: string
  sourceSequence: string
  feePerOperation: string
  signer: Keypair
  operation: xdr.Operation
  memo: string | null
}): PreparedTransfer {
  const account = new Account(input.sourcePublicKey, input.sourceSequence)
  const builder = new TransactionBuilder(account, {
    fee: input.feePerOperation,
    networkPassphrase: TESTNET_PASSPHRASE,
  }).addOperation(input.operation)
  const withMemo =
    input.memo === null ? builder.addMemo(Memo.none()) : builder.addMemo(Memo.text(input.memo))
  const tx = withMemo.setTimeout(TRANSFER_WINDOW_SECONDS).build()
  tx.sign(input.signer)
  return {
    envelopeXdr: tx.toXDR(),
    txHash: tx.hash().toString('hex'),
    sequence: tx.sequence,
  }
}

export function readEnvelope(envelopeXdr: string): ReadEnvelope {
  let parsed: Transaction | ReturnType<typeof TransactionBuilder.fromXDR>
  try {
    parsed = TransactionBuilder.fromXDR(envelopeXdr, TESTNET_PASSPHRASE)
  } catch {
    throw new StellarError('invalid', 'envelope XDR could not be parsed')
  }
  if (!(parsed instanceof Transaction)) {
    throw new StellarError('invalid', 'envelope must be a transaction')
  }
  const operation = parsed.operations[0]
  if (operation === undefined) throw new StellarError('invalid', 'envelope has no operation')
  const rawMax = parsed.timeBounds?.maxTime
  return {
    source: parsed.source,
    sequence: parsed.sequence,
    feeStroops: BigInt(parsed.fee),
    maxTime: rawMax === undefined ? 0n : BigInt(rawMax),
    hash: parsed.hash().toString('hex'),
    memo: memoText(parsed.memo.value),
    operation,
  }
}

function memoText(value: string | Buffer | null): string {
  if (typeof value === 'string') return value
  if (value instanceof Uint8Array) return Buffer.from(value).toString('utf8')
  return ''
}
