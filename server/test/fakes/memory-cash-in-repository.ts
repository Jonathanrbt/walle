import type { CashIn, CashInStatus } from '../../src/cash-in/domain/cash-in.ts'
import type { CashInRepository, CashInUsage } from '../../src/cash-in/repository.ts'
import { DomainError } from '../../src/shared/errors.ts'
import { money, type Money } from '../../src/shared/money.ts'

export interface MemoryCashInRepository extends CashInRepository {
  all(): readonly CashIn[]
}

export function createMemoryCashInRepository(): MemoryCashInRepository {
  const rows = new Map<string, CashIn>()

  return {
    insert(cashIn) {
      return runPort(() => {
        if (rows.has(cashIn.id)) {
          throw new DomainError('version_conflict', 'version conflict')
        }
        rows.set(cashIn.id, structuredClone(cashIn))
      })
    },

    get(id) {
      return runPort(() => cloneRow(rows.get(id)))
    },

    save(next, expectedVersion) {
      return runPort(() => {
        const current = rows.get(next.id)
        if (current?.version !== expectedVersion || next.version !== expectedVersion + 1) {
          throw new DomainError('version_conflict', 'version conflict')
        }
        rows.set(next.id, structuredClone(next))
      })
    },

    listRecent(limit) {
      return runPort(() =>
        [...rows.values()]
          .sort(byCreatedAtThenId('desc'))
          .slice(0, limit)
          .map((row) => structuredClone(row)),
      )
    },

    listByStatus(statuses) {
      return runPort(() => {
        if (statuses.length === 0) return []
        const allowed = new Set<CashInStatus>(statuses)
        return [...rows.values()]
          .filter((row) => allowed.has(row.status))
          .sort(byCreatedAtThenId('asc'))
          .map((row) => structuredClone(row))
      })
    },

    usageFor(documentNumber, now) {
      return runPort(() => usageFor(rows, documentNumber, now))
    },

    reservedUsdc(now) {
      return runPort(() => reservedUsdc(rows, now))
    },

    all() {
      return [...rows.values()].map((row) => structuredClone(row))
    },
  }
}

function cloneRow(row: CashIn | undefined): CashIn | undefined {
  return row === undefined ? undefined : structuredClone(row)
}

function usageFor(
  rows: ReadonlyMap<string, CashIn>,
  documentNumber: string,
  now: Date,
): CashInUsage {
  const day = utcBounds(now, 'day')
  const month = utcBounds(now, 'month')
  let usdcDay = 0n
  let usdcMonth = 0n
  let copMonth = 0n
  for (const row of rows.values()) {
    if (row.customer.documentNumber !== documentNumber || !countsForUsage(row, now)) continue
    const created = row.createdAt.getTime()
    if (created >= month.start && created < month.end) {
      usdcMonth += row.usdc.amount
      copMonth += row.cop.amount
    }
    if (created >= day.start && created < day.end) usdcDay += row.usdc.amount
  }
  return {
    usdcDay: money(usdcDay, 'USDC', 2),
    usdcMonth: money(usdcMonth, 'USDC', 2),
    copMonth: money(copMonth, 'COP', 2),
  }
}

function reservedUsdc(rows: ReadonlyMap<string, CashIn>, now: Date): Money {
  let total = 0n
  for (const row of rows.values()) {
    if (countsAsReserved(row, now)) total += row.usdc.amount
  }
  return money(total, 'USDC', 2)
}

async function runPort<T>(body: () => T): Promise<T> {
  await Promise.resolve()
  return body()
}

function countsForUsage(cashIn: CashIn, now: Date): boolean {
  if (cashIn.status === 'quoted') return cashIn.expiresAt.getTime() > now.getTime()
  return (
    cashIn.status === 'settling' ||
    cashIn.status === 'settled' ||
    cashIn.status === 'sending_usdc' ||
    cashIn.status === 'completed' ||
    cashIn.status === 'failed_stellar'
  )
}

function countsAsReserved(cashIn: CashIn, now: Date): boolean {
  if (cashIn.status === 'quoted') return cashIn.expiresAt.getTime() > now.getTime()
  return (
    cashIn.status === 'settling' ||
    cashIn.status === 'settled' ||
    cashIn.status === 'sending_usdc' ||
    cashIn.status === 'failed_stellar'
  )
}

function utcBounds(now: Date, unit: 'day' | 'month'): { start: number; end: number } {
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  if (unit === 'day') {
    const start = Date.UTC(year, month, now.getUTCDate())
    return { start, end: Date.UTC(year, month, now.getUTCDate() + 1) }
  }
  return { start: Date.UTC(year, month, 1), end: Date.UTC(year, month + 1, 1) }
}

function byCreatedAtThenId(direction: 'asc' | 'desc'): (left: CashIn, right: CashIn) => number {
  const sign = direction === 'asc' ? 1 : -1
  return (left, right) => {
    const created = left.createdAt.getTime() - right.createdAt.getTime()
    if (created !== 0) return created * sign
    if (left.id < right.id) return -1 * sign
    if (left.id > right.id) return sign
    return 0
  }
}
