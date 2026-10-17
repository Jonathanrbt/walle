import type { LookupResult } from '../../treasury/usdc-network.ts'

/**
 * True only when the hash is absent and the envelope can never be included.
 * `accountSequence` is the last sequence the account consumed. The envelope's sequence is
 * consumed when the account sequence has caught up to it.
 */
export function envelopeIsDead(input: {
  lookup: LookupResult
  maxTime: bigint
  nowSeconds: bigint
  accountSequence: bigint
  envelopeSequence: bigint
}): boolean {
  if (input.lookup.kind !== 'not_found') return false
  if (input.maxTime !== 0n && input.maxTime <= input.nowSeconds) return true
  return input.accountSequence >= input.envelopeSequence
}
