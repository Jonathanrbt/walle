import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createQuoted } from '../../cash-in/domain/cash-in.ts'
import { money } from '../../shared/money.ts'
import { SqliteCashInRepository } from './cash-in-repository.ts'
import { openDatabase } from './database.ts'
import { migrate } from './migrate.ts'

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

describe('migration 003', () => {
  it('adds idempotency columns to a populated cash-in table', async () => {
    const db = openDatabase(':memory:')
    try {
      db.exec(readFileSync(join(migrationsDir, '001_initial.sql'), 'utf8'))
      db.exec(readFileSync(join(migrationsDir, '002_store_grant_interact.sql'), 'utf8'))
      db.exec(`CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      )`)
      const record = db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
      record.run(1, '2026-10-17T00:00:00.000Z')
      record.run(2, '2026-10-17T00:00:00.000Z')
      db.prepare(
        `INSERT INTO cash_ins (
          id, status, cop_amount, cop_scale, cop_asset, usdc_amount, usdc_scale, usdc_asset,
          rate_amount, rate_scale, rate_asset, expires_at, stellar_address, memo,
          customer_phone, customer_full_name, customer_document, incoming_payment_url, quote_id,
          incoming_completed, created_at, updated_at, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        'cash-old',
        'quoted',
        10_000,
        2,
        'COP',
        100,
        2,
        'USDC',
        10_000,
        2,
        'COP',
        '2026-10-17T00:01:00.000Z',
        'GSTORE',
        'WALLE-OLD',
        '3001112233',
        'Ada Lovelace',
        '12345678',
        'https://wallet.example.test/incoming/old',
        'quote-old',
        0,
        '2026-10-17T00:00:00.000Z',
        '2026-10-17T00:00:00.000Z',
        1,
      )

      migrate(db)
      const repo = new SqliteCashInRepository(db)
      expect((await repo.get('cash-old'))?.memo).toBe('WALLE-OLD')
      expect(await repo.findIdempotency('key-1')).toBeUndefined()

      const quoted = createQuoted(
        {
          id: 'cash-new',
          cop: money(10_000n, 'COP', 2),
          usdc: money(100n, 'USDC', 2),
          copPerUsdc: money(10_000n, 'COP', 2),
          expiresAt: new Date('2026-10-17T00:01:00.000Z'),
          stellarAddress: 'GSTORE',
          customer: { phone: '3001112233', fullName: 'Ada Lovelace', documentNumber: '12345678' },
          incomingPaymentUrl: 'https://wallet.example.test/incoming/new',
          quoteId: 'quote-new',
        },
        { now: () => new Date('2026-10-17T00:00:00.000Z') },
      )
      await repo.insert(quoted, { key: 'key-1', body: '{"copAmount":"100.00"}' })
      expect(await repo.findIdempotency('key-1')).toMatchObject({
        body: '{"copAmount":"100.00"}',
        cashIn: { id: 'cash-new' },
      })
      await expect(
        repo.insert(
          { ...quoted, id: 'cash-other' },
          { key: 'key-1', body: '{"copAmount":"1.00"}' },
        ),
      ).rejects.toMatchObject({ code: 'version_conflict' })
      const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()
      expect(versions.map((row) => Number(row.version))).toEqual([1, 2, 3])
    } finally {
      db.close()
    }
  })
})
