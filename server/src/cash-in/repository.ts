import type { CashIn, CashInStatus } from './domain/cash-in.ts'
import type { Money } from '../shared/money.ts'

export interface CashInUsage {
  readonly usdcDay: Money
  readonly usdcMonth: Money
  readonly copMonth: Money
}

export interface CashInRepository {
  insert(cashIn: CashIn): Promise<void>
  get(id: string): Promise<CashIn | undefined>
  save(next: CashIn, expectedVersion: number): Promise<void>
  listRecent(limit: number): Promise<CashIn[]>
  listByStatus(statuses: readonly CashInStatus[]): Promise<CashIn[]>
  usageFor(documentNumber: string, now: Date): Promise<CashInUsage>
  reservedUsdc(now: Date): Promise<Money>
}
