import type { Money } from '../shared/money.ts'

export type StellarErrorKind = 'unavailable' | 'invalid' | 'operator_not_ready' | 'no_path'

/** Failure of the Stellar testnet adapter. `detail` is safe to log: it never includes a secret. */
export class StellarError extends Error {
  readonly kind: StellarErrorKind
  readonly detail: string

  constructor(kind: StellarErrorKind, detail: string) {
    super(detail)
    this.name = 'StellarError'
    this.kind = kind
    this.detail = detail
  }
}

export type DestinationCheck =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly reason: 'invalid_address' | 'account_not_found' | 'no_trustline'
    }

export interface PreparedTransfer {
  readonly envelopeXdr: string
  readonly txHash: string
  readonly sequence: string
}

export type SubmitOutcome =
  | { readonly kind: 'success'; readonly ledger: number }
  | { readonly kind: 'rejected'; readonly code: string }
  | { readonly kind: 'unknown' }

export type LookupResult =
  | { readonly kind: 'success'; readonly ledger: number }
  | { readonly kind: 'failed'; readonly code: string }
  | { readonly kind: 'not_found' }

export interface RefillResult {
  readonly txHash: string
  readonly usdc: Money
}

/**
 * USDC on Stellar testnet, from the operator account.
 *
 * Idempotency: `submit` looks the hash up first and returns `success` when that hash is already
 * on the ledger. A Horizon `tx_bad_seq` is `success` only when a follow-up `lookup` shows that
 * same hash applied. A network timeout returns `{ kind: 'unknown' }`; a later `lookup` decides.
 * The caller may re-submit the same envelope any number of times and the funds move at most once.
 *
 * `prepareTransfer` and `submit` each take the in-process mutex separately, so they are not one
 * atomic transfer. `refill` and `ensureOperatorReady` take that same mutex and, when they submit,
 * advance the operator sequence. An envelope prepared before that advance can never apply.
 * `isEnvelopeDead` is true only when `lookup` is `not_found` and the envelope can never apply
 * (its maxTime has passed, or the account sequence is already at or past the envelope sequence).
 * Only then may the caller rebuild with `prepareTransfer`. A `failed` lookup means this envelope
 * was included and rejected; the caller rebuilds because the lookup failed, not because the
 * envelope is dead.
 */
export interface UsdcNetwork {
  ensureOperatorReady(): Promise<void>
  balance(): Promise<Money>
  validateDestination(address: string): Promise<DestinationCheck>
  prepareTransfer(input: { to: string; amount: Money; memo: string }): Promise<PreparedTransfer>
  submit(prepared: PreparedTransfer): Promise<SubmitOutcome>
  lookup(txHash: string): Promise<LookupResult>
  refill(input: { targetUsdc: Money }): Promise<RefillResult>
  isEnvelopeDead(prepared: PreparedTransfer): Promise<boolean>
}
