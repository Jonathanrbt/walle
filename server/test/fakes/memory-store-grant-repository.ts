import type { CashIn, CashInStatus } from '../../src/cash-in/domain/cash-in.ts'
import type { StoredGrant, StoreGrantRepository } from '../../src/store-grant/repository.ts'
import { DomainError } from '../../src/shared/errors.ts'
import { money } from '../../src/shared/money.ts'

export function createMemoryStoreGrantRepository(cashIns: {
  all(): readonly CashIn[]
}): StoreGrantRepository {
  let grant: StoredGrant | undefined

  return {
    get() {
      return runPort(() => (grant === undefined ? undefined : structuredClone(grant)))
    },

    put(next, expectedVersion) {
      return runPort(() => {
        if (expectedVersion === null) {
          if (grant !== undefined) {
            throw new DomainError('version_conflict', 'version conflict')
          }
          grant = structuredClone(next)
          return
        }
        if (grant?.version !== expectedVersion || next.version !== expectedVersion + 1) {
          throw new DomainError('version_conflict', 'version conflict')
        }
        grant = structuredClone(next)
      })
    },

    spentSince(since) {
      return runPort(() => {
        const start = since.getTime()
        let total = 0n
        for (const row of cashIns.all()) {
          if (row.createdAt.getTime() < start || !countsAsSpent(row.status)) continue
          total += row.cop.amount
        }
        return money(total, 'COP', 2)
      })
    },
  }
}

async function runPort<T>(body: () => T): Promise<T> {
  await Promise.resolve()
  return body()
}

function countsAsSpent(status: CashInStatus): boolean {
  return (
    status === 'settling' ||
    status === 'settled' ||
    status === 'sending_usdc' ||
    status === 'completed' ||
    status === 'failed_stellar'
  )
}
