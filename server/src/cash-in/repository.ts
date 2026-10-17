import type { CashIn, CashInStatus } from './domain/cash-in.ts'
import type { Money } from '../shared/money.ts'

export interface CashInUsage {
  readonly usdcDay: Money
  readonly usdcMonth: Money
  readonly copMonth: Money
}

export interface IdempotencyRecord {
  readonly key: string
  readonly body: string
}

export interface IdempotencyHit {
  readonly cashIn: CashIn
  readonly body: string
}

export interface CashInRepository {
  insert(cashIn: CashIn, idempotency?: IdempotencyRecord): Promise<void>
  findIdempotency(key: string): Promise<IdempotencyHit | undefined>
  get(id: string): Promise<CashIn | undefined>
  save(next: CashIn, expectedVersion: number): Promise<void>
  listRecent(limit: number): Promise<CashIn[]>
  listByStatus(statuses: readonly CashInStatus[]): Promise<CashIn[]>
  usageFor(documentNumber: string, now: Date): Promise<CashInUsage>
  reservedUsdc(now: Date): Promise<Money>
}
