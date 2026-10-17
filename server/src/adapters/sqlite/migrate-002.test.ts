import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { money } from '../../shared/money.ts'
import { SqliteCashInRepository } from './cash-in-repository.ts'
import { openDatabase } from './database.ts'
import { migrate } from './migrate.ts'
import { SqliteStoreGrantRepository } from './store-grant-repository.ts'

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

describe('migration 002', () => {
  it('adds finish-hash columns to an existing grant without dropping data', async () => {
    const db = openDatabase(':memory:')
    try {
      db.exec(readFileSync(join(migrationsDir, '001_initial.sql'), 'utf8'))
      db.exec(`CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      )`)
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        1,
        '2026-10-17T00:00:00.000Z',
      )
      db.prepare(
        `INSERT INTO store_grant (
          id, status, nonce, continue_uri, continue_access_token, access_token,
          limit_amount, limit_scale, limit_asset, interval, created_at, updated_at, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        1,
        'active',
        'nonce-old',
        'https://wallet.example.test/continue',
        'continue-secret',
        'access-secret',
        200_000_000,
        2,
        'COP',
        'R/2026-10-17T00:00:00.000Z/P1D',
        '2026-10-17T00:00:00.000Z',
        '2026-10-17T00:00:00.000Z',
        4,
      )
      db.prepare(
        `INSERT INTO cash_ins (
          id, status, cop_amount, cop_scale, cop_asset, usdc_amount, usdc_scale, usdc_asset,
          rate_amount, rate_scale, rate_asset, expires_at, stellar_address, memo,
          customer_phone, customer_full_name, customer_document, incoming_payment_url, quote_id,
          incoming_completed, created_at, updated_at, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        'cash-1',
        'quoted',
        100,
        2,
        'COP',
        1,
        2,
        'USDC',
        100,
        2,
        'COP',
        '2026-10-17T00:01:00.000Z',
        'GSTORE',
        'WALLE-CASH1',
        '300',
        'Ada Lovelace',
        '123456',
        'https://wallet.example.test/incoming/1',
        'quote-1',
        0,
        '2026-10-17T00:00:00.000Z',
        '2026-10-17T00:00:00.000Z',
        1,
      )
      migrate(db)
      const cashIns = new SqliteCashInRepository(db)
      const grant = await new SqliteStoreGrantRepository(db).get()
      expect(grant).toMatchObject({
        status: 'active',
        nonce: 'nonce-old',
        interactNonce: '',
        grantEndpoint: '',
        accessToken: 'access-secret',
        continueAccessToken: 'continue-secret',
        version: 4,
        limit: money(200_000_000n, 'COP', 2),
      })
      expect((await cashIns.get('cash-1'))?.id).toBe('cash-1')
      const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()
      expect(versions.map((row) => Number(row.version))).toEqual([1, 2, 3])
    } finally {
      db.close()
    }
  })
})
