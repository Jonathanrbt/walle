import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createQuoted } from '../../cash-in/domain/cash-in.ts'
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
      const cashIns = new SqliteCashInRepository(db)
      const quoted = createQuoted(
        {
          id: 'cash-1',
          cop: money(100n, 'COP', 2),
          usdc: money(1n, 'USDC', 2),
          copPerUsdc: money(100n, 'COP', 2),
          expiresAt: new Date('2026-10-17T00:01:00.000Z'),
          stellarAddress: 'GSTORE',
          customer: { phone: '300', fullName: 'Ada Lovelace', documentNumber: '123456' },
          incomingPaymentUrl: 'https://wallet.example.test/incoming/1',
          quoteId: 'quote-1',
        },
        { now: () => new Date('2026-10-17T00:00:00.000Z') },
      )

      await cashIns.insert(quoted)
      migrate(db)
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
      expect(versions.map((row) => Number(row.version))).toEqual([1, 2])
    } finally {
      db.close()
    }
  })
})
