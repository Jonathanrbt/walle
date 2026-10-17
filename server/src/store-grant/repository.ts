import type { Money } from '../shared/money.ts'

export type StoreGrantStatus = 'pending' | 'active' | 'revoked'

export interface StoredGrant {
  readonly status: StoreGrantStatus
  readonly nonce: string
  /** `interact.finish` from the grant response. */
  readonly interactNonce: string
  /** Auth server URL the grant was POSTed to. */
  readonly grantEndpoint: string
  readonly continueUri: string
  readonly continueAccessToken: string
  readonly accessToken?: string
  readonly manageUrl?: string
  readonly tokenExpiresAt?: Date
  readonly limit?: Money
  readonly interval: string
  readonly grantExpiresAt?: Date
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly version: number
}

export interface StoreGrantRepository {
  get(): Promise<StoredGrant | undefined>
  put(next: StoredGrant, expectedVersion: number | null): Promise<void>
  spentSince(since: Date): Promise<Money>
}
