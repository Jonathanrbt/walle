import type { LookupResult } from '../../treasury/usdc-network.ts'

/**
 * Wait after `maxTime` before calling an envelope dead. A transaction accepted
 * just before the deadline can still be ingesting.
 */
export const ENVELOPE_DEAD_MARGIN_SECONDS = 30n

/**
 * True only when `lookup` is `not_found` and the envelope can never be included.
 * The caller must sample `accountSequence` and `nowSeconds` before `lookup`: a
 * transaction that consumed the sequence is then visible to that lookup, so a
 * missing hash is not this envelope. `accountSequence` is the last sequence the
 * account consumed. Time expiry needs `nowSeconds >= maxTime + marginSeconds`.
 */
export function envelopeIsDead(input: {
  lookup: LookupResult
  maxTime: bigint
  nowSeconds: bigint
  accountSequence: bigint
  envelopeSequence: bigint
  marginSeconds?: bigint
}): boolean {
  if (input.lookup.kind !== 'not_found') return false
  const margin = input.marginSeconds ?? ENVELOPE_DEAD_MARGIN_SECONDS
  if (input.maxTime !== 0n && input.nowSeconds >= input.maxTime + margin) return true
  return input.accountSequence >= input.envelopeSequence
}
