import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteCashInRepository } from '../../src/adapters/sqlite/cash-in-repository.ts'
import { openDatabase } from '../../src/adapters/sqlite/database.ts'
import { migrate } from '../../src/adapters/sqlite/migrate.ts'
import { SqliteStoreGrantRepository } from '../../src/adapters/sqlite/store-grant-repository.ts'
import { createMemoryCashInRepository } from '../fakes/memory-cash-in-repository.ts'
import { createMemoryStoreGrantRepository } from '../fakes/memory-store-grant-repository.ts'
import {
  runStoreGrantRepositoryContract,
  type StoreGrantRepositorySubject,
} from './store-grant-repository.contract.ts'

function memorySubject(): Promise<StoreGrantRepositorySubject> {
  const cashIns = createMemoryCashInRepository()
  return Promise.resolve({
    cashIns,
    grants: createMemoryStoreGrantRepository(cashIns),
    close() {
      return undefined
    },
  })
}

function sqliteMemorySubject(): Promise<StoreGrantRepositorySubject> {
  const db = openDatabase(':memory:')
  migrate(db)
  return Promise.resolve({
    cashIns: new SqliteCashInRepository(db),
    grants: new SqliteStoreGrantRepository(db),
    close() {
      db.close()
    },
  })
}

function sqliteFileSubject(): Promise<StoreGrantRepositorySubject> {
  const dir = mkdtempSync(join(tmpdir(), 'walle-b3-grant-'))
  const path = join(dir, 'nested', 'grant.sqlite')
  const db = openDatabase(path)
  migrate(db)
  return Promise.resolve({
    cashIns: new SqliteCashInRepository(db),
    grants: new SqliteStoreGrantRepository(db),
    close() {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    },
  })
}

runStoreGrantRepositoryContract('memory store-grant repository', memorySubject)
runStoreGrantRepositoryContract('sqlite :memory: store-grant repository', sqliteMemorySubject)
runStoreGrantRepositoryContract('sqlite file store-grant repository', sqliteFileSubject)
