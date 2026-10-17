import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SqliteCashInRepository } from '../../src/adapters/sqlite/cash-in-repository.ts'
import { openDatabase } from '../../src/adapters/sqlite/database.ts'
import { migrate } from '../../src/adapters/sqlite/migrate.ts'
import { SqliteStoreGrantRepository } from '../../src/adapters/sqlite/store-grant-repository.ts'
import { createMemoryCashInRepository } from '../fakes/memory-cash-in-repository.ts'
import {
  runCashInRepositoryContract,
  type CashInRepositorySubject,
} from './cash-in-repository.contract.ts'
import type { StoredGrant } from '../../src/store-grant/repository.ts'
import { money } from '../../src/shared/money.ts'
import type { CashIn } from '../../src/cash-in/domain/cash-in.ts'

function memorySubject(): Promise<CashInRepositorySubject> {
  return Promise.resolve({
    repo: createMemoryCashInRepository(),
    close() {
      return undefined
    },
  })
}

function sqliteMemorySubject(): Promise<CashInRepositorySubject> {
  const db = openDatabase(':memory:')
  migrate(db)
  return Promise.resolve({
    repo: new SqliteCashInRepository(db),
    close() {
      db.close()
    },
  })
}

function sqliteFileSubject(): Promise<CashInRepositorySubject> {
  const dir = mkdtempSync(join(tmpdir(), 'walle-b3-'))
  const path = join(dir, 'nested', 'cash.sqlite')
  const db = openDatabase(path)
  migrate(db)
  return Promise.resolve({
    repo: new SqliteCashInRepository(db),
    close() {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    },
  })
}

runCashInRepositoryContract('memory cash-in repository', memorySubject)
runCashInRepositoryContract('sqlite :memory: cash-in repository', sqliteMemorySubject)
runCashInRepositoryContract('sqlite file cash-in repository', sqliteFileSubject)

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'walle-b3-migrate-'))
}

describe('sqlite database file', () => {
  it('creates the parent directory and enables WAL, foreign keys, and a busy timeout', () => {
    const dir = tempDir()
    const path = join(dir, 'nested', 'walle.sqlite')
    const db = openDatabase(path)
    try {
      expect(existsSync(path)).toBe(true)
      expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
      expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1n })
      expect(db.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 5000n })
    } finally {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps cash-ins and the store grant after the file is reopened', async () => {
    const dir = tempDir()
    const path = join(dir, 'nested', 'walle.sqlite')
    const cashIn: CashIn = {
      id: 'reopen-1',
      status: 'quoted',
      cop: money(2n ** 53n + 1n, 'COP', 2),
      usdc: money(100n, 'USDC', 2),
      copPerUsdc: money(4_000n, 'COP', 2),
      expiresAt: new Date('2026-10-17T12:01:00.000Z'),
      stellarAddress: 'GREOPEN',
      memo: 'WALLE-REOPEN',
      customer: { phone: '300', fullName: 'Ada', documentNumber: 'DOC-A' },
      openPayments: {
        incomingPaymentUrl: 'https://wallet.example.test/incoming/reopen-1',
        quoteId: 'quote-reopen',
        incomingCompleted: false,
      },
      createdAt: new Date('2026-10-17T12:00:00.000Z'),
      updatedAt: new Date('2026-10-17T12:00:00.000Z'),
      version: 1,
    }
    const stored: StoredGrant = {
      status: 'pending',
      nonce: 'nonce-reopen',
      interactNonce: 'interact-nonce-reopen',
      grantEndpoint: 'https://auth.example.test/gnap',
      continueUri: 'https://wallet.example.test/continue',
      continueAccessToken: 'continue-secret',
      interval: 'P1M',
      createdAt: new Date('2026-10-17T00:00:00.000Z'),
      updatedAt: new Date('2026-10-17T00:00:00.000Z'),
      version: 1,
    }
    const db = openDatabase(path)
    migrate(db)
    await new SqliteCashInRepository(db).insert(cashIn)
    await new SqliteStoreGrantRepository(db).put(stored, null)
    db.close()

    const reopened = openDatabase(path)
    try {
      migrate(reopened)
      expect(await new SqliteCashInRepository(reopened).get('reopen-1')).toEqual(cashIn)
      expect(await new SqliteStoreGrantRepository(reopened).get()).toEqual(stored)
    } finally {
      reopened.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('applies migrations once and refuses a schema newer than this code', () => {
    const dir = tempDir()
    const path = join(dir, 'walle.sqlite')
    const db = openDatabase(path)
    try {
      migrate(db)
      migrate(db)
      expect(db.prepare('SELECT version FROM schema_migrations').all()).toEqual([
        { version: 1n },
        { version: 2n },
        { version: 3n },
      ])

      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        99,
        '2026-10-17T00:00:00.000Z',
      )
      expect(() => {
        migrate(db)
      }).toThrow(/newer/)
    } finally {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not apply known migrations when the database is already newer', () => {
    const db = openDatabase(':memory:')
    try {
      db.exec(
        'CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)',
      )
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        99,
        '2026-10-17T00:00:00.000Z',
      )
      expect(() => {
        migrate(db)
      }).toThrow(/newer/)
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE name = 'cash_ins'").get(),
      ).toBeUndefined()
    } finally {
      db.close()
    }
  })

  it('rejects a migration filename without a version and rolls back a failed migration', () => {
    const unnamed = tempDir()
    writeFileSync(join(unnamed, 'notes.sql'), 'SELECT 1')
    const unnamedDb = openDatabase(':memory:')
    expect(() => {
      migrate(unnamedDb, unnamed)
    }).toThrow(/version/)
    unnamedDb.close()
    rmSync(unnamed, { recursive: true, force: true })

    const broken = tempDir()
    writeFileSync(join(broken, '001_ok.sql'), 'CREATE TABLE example (id INTEGER PRIMARY KEY)')
    writeFileSync(join(broken, '002_bad.sql'), 'NOT SQL')
    const db = openDatabase(':memory:')
    try {
      expect(() => {
        migrate(db, broken)
      }).toThrow(/syntax/i)
      expect(
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'example'")
          .get(),
      ).toBeUndefined()
      expect(db.prepare('SELECT version FROM schema_migrations').all()).toEqual([])
    } finally {
      db.close()
      rmSync(broken, { recursive: true, force: true })
    }
  })

  it('does not disguise a check constraint as a version conflict', async () => {
    const db = openDatabase(':memory:')
    try {
      migrate(db)
      const repo = new SqliteCashInRepository(db)
      const cashIn: CashIn = {
        id: 'bad-status',
        status: 'not-a-status' as CashIn['status'],
        cop: money(1n, 'COP', 2),
        usdc: money(1n, 'USDC', 2),
        copPerUsdc: money(1n, 'COP', 2),
        expiresAt: new Date('2026-10-17T12:01:00.000Z'),
        stellarAddress: 'G',
        memo: 'WALLE-BAD',
        customer: { phone: '1', fullName: 'Ada', documentNumber: '1' },
        openPayments: {
          incomingPaymentUrl: 'https://wallet.example.test/in',
          quoteId: 'q',
          incomingCompleted: false,
        },
        createdAt: new Date('2026-10-17T12:00:00.000Z'),
        updatedAt: new Date('2026-10-17T12:00:00.000Z'),
        version: 1,
      }
      await expect(repo.insert(cashIn)).rejects.toThrow(/CHECK constraint/)
    } finally {
      db.close()
    }
  })

  it('serializes two connections so only one compare-and-swap wins', async () => {
    const dir = tempDir()
    const path = join(dir, 'race.sqlite')
    const leftDb = openDatabase(path)
    migrate(leftDb)
    const rightDb = openDatabase(path)
    migrate(rightDb)
    try {
      const original: CashIn = {
        id: 'race',
        status: 'quoted',
        cop: money(1n, 'COP', 2),
        usdc: money(1n, 'USDC', 2),
        copPerUsdc: money(1n, 'COP', 2),
        expiresAt: new Date('2026-10-17T12:01:00.000Z'),
        stellarAddress: 'G',
        memo: 'WALLE-RACE',
        customer: { phone: '1', fullName: 'Ada', documentNumber: '1' },
        openPayments: {
          incomingPaymentUrl: 'https://wallet.example.test/in',
          quoteId: 'q',
          incomingCompleted: false,
        },
        createdAt: new Date('2026-10-17T12:00:00.000Z'),
        updatedAt: new Date('2026-10-17T12:00:00.000Z'),
        version: 1,
      }
      const leftRepo = new SqliteCashInRepository(leftDb)
      const rightRepo = new SqliteCashInRepository(rightDb)
      await leftRepo.insert(original)
      const left = { ...original, version: 2, memo: 'left' }
      const right = { ...original, version: 2, memo: 'right' }
      const results = await Promise.allSettled([leftRepo.save(left, 1), rightRepo.save(right, 1)])
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
      expect([left, right]).toContainEqual(await leftRepo.get('race'))
    } finally {
      leftDb.close()
      rightDb.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
