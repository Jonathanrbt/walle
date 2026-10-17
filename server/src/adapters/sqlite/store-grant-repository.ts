import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite'
import type {
  StoredGrant,
  StoreGrantRepository,
  StoreGrantStatus,
} from '../../store-grant/repository.ts'
import { money, type Money } from '../../shared/money.ts'
import { changed, conflict, runPort, versionConflict } from './constraints.ts'

const COLUMNS = [
  'id',
  'status',
  'nonce',
  'continue_uri',
  'continue_access_token',
  'access_token',
  'manage_url',
  'token_expires_at',
  'limit_amount',
  'limit_scale',
  'limit_asset',
  'interval',
  'grant_expires_at',
  'created_at',
  'updated_at',
  'version',
] as const

const UPDATE_COLUMNS = COLUMNS.filter((column) => column !== 'id')

const INSERT_SQL = `INSERT INTO store_grant (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})`

const UPDATE_SQL = `UPDATE store_grant SET ${UPDATE_COLUMNS.map((column) => `${column} = ?`).join(', ')} WHERE id = ? AND version = ?`

const SPENT_SQL = `SELECT COALESCE(SUM(cop_amount), 0) AS amount
FROM cash_ins
WHERE created_at >= ?
  AND status IN ('settling', 'settled', 'sending_usdc', 'completed', 'failed_stellar')`

interface GrantRow {
  readonly status: string
  readonly nonce: string
  readonly continue_uri: string
  readonly continue_access_token: string
  readonly access_token: string | null
  readonly manage_url: string | null
  readonly token_expires_at: string | null
  readonly limit_amount: bigint | null
  readonly limit_scale: bigint | null
  readonly limit_asset: string | null
  readonly interval: string
  readonly grant_expires_at: string | null
  readonly created_at: string
  readonly updated_at: string
  readonly version: bigint
}

interface AmountRow {
  readonly amount: bigint
}

export class SqliteStoreGrantRepository implements StoreGrantRepository {
  readonly #insert: StatementSync
  readonly #update: StatementSync
  readonly #get: StatementSync
  readonly #spent: StatementSync

  constructor(db: DatabaseSync) {
    this.#insert = db.prepare(INSERT_SQL)
    this.#update = db.prepare(UPDATE_SQL)
    this.#get = db.prepare('SELECT * FROM store_grant WHERE id = 1')
    this.#spent = db.prepare(SPENT_SQL)
  }

  get(): Promise<StoredGrant | undefined> {
    return runPort(() => {
      const row = this.#get.get() as GrantRow | undefined
      if (row === undefined) return undefined
      return mapGrant(row)
    })
  }

  put(next: StoredGrant, expectedVersion: number | null): Promise<void> {
    return runPort(() => {
      if (expectedVersion === null) {
        try {
          this.#insert.run(...bindings(next))
        } catch (error) {
          versionConflict(error)
        }
        return
      }
      if (next.version !== expectedVersion + 1) conflict()
      const result = this.#update.run(...updateBindings(next, expectedVersion))
      if (!changed(result.changes)) conflict()
    })
  }

  spentSince(since: Date): Promise<Money> {
    return runPort(() => {
      const raw = this.#spent.get(since.toISOString())
      const row = (raw ?? { amount: 0n }) as unknown as AmountRow
      return money(row.amount, 'COP', 2)
    })
  }
}

function bindings(grant: StoredGrant): SQLInputValue[] {
  const limit = grant.limit
  return [
    1,
    grant.status,
    grant.nonce,
    grant.continueUri,
    grant.continueAccessToken,
    grant.accessToken ?? null,
    grant.manageUrl ?? null,
    grant.tokenExpiresAt?.toISOString() ?? null,
    limit?.amount ?? null,
    limit?.assetScale ?? null,
    limit?.assetCode ?? null,
    grant.interval,
    grant.grantExpiresAt?.toISOString() ?? null,
    grant.createdAt.toISOString(),
    grant.updatedAt.toISOString(),
    grant.version,
  ]
}

function updateBindings(grant: StoredGrant, expectedVersion: number): SQLInputValue[] {
  const [, ...withoutId] = bindings(grant)
  return [...withoutId, 1, expectedVersion]
}

function mapGrant(row: GrantRow): StoredGrant {
  const limit =
    row.limit_amount !== null && row.limit_scale !== null && row.limit_asset !== null
      ? money(row.limit_amount, row.limit_asset, Number(row.limit_scale))
      : undefined
  const tokenExpiresAt = row.token_expires_at === null ? undefined : new Date(row.token_expires_at)
  const grantExpiresAt = row.grant_expires_at === null ? undefined : new Date(row.grant_expires_at)
  return {
    status: row.status as StoreGrantStatus,
    nonce: row.nonce,
    continueUri: row.continue_uri,
    continueAccessToken: row.continue_access_token,
    interval: row.interval,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    version: Number(row.version),
    ...(row.access_token !== null ? { accessToken: row.access_token } : {}),
    ...(row.manage_url !== null ? { manageUrl: row.manage_url } : {}),
    ...(tokenExpiresAt !== undefined ? { tokenExpiresAt } : {}),
    ...(grantExpiresAt !== undefined ? { grantExpiresAt } : {}),
    ...(limit !== undefined ? { limit } : {}),
  }
}
