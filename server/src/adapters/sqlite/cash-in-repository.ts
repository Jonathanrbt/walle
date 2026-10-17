import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite'
import type { CashIn, CashInOpenPayments, CashInStatus } from '../../cash-in/domain/cash-in.ts'
import type {
  CashInRepository,
  CashInUsage,
  IdempotencyHit,
  IdempotencyRecord,
} from '../../cash-in/repository.ts'
import { money, type Money } from '../../shared/money.ts'
import { changed, conflict, isUniqueConstraint, runPort, versionConflict } from './constraints.ts'

const COLUMNS = [
  'id',
  'status',
  'cop_amount',
  'cop_scale',
  'cop_asset',
  'usdc_amount',
  'usdc_scale',
  'usdc_asset',
  'rate_amount',
  'rate_scale',
  'rate_asset',
  'expires_at',
  'stellar_address',
  'memo',
  'customer_phone',
  'customer_full_name',
  'customer_document',
  'incoming_payment_url',
  'quote_id',
  'outgoing_payment_id',
  'incoming_completed',
  'stellar_tx_hash',
  'stellar_envelope_xdr',
  'failure_reason',
  'created_at',
  'updated_at',
  'version',
] as const

const UPDATE_COLUMNS = COLUMNS.filter((column) => column !== 'id')

const INSERT_SQL = `INSERT INTO cash_ins (${COLUMNS.join(', ')}, idempotency_key, idempotency_body) VALUES (${COLUMNS.map(() => '?').join(', ')}, ?, ?)`

const UPDATE_SQL = `UPDATE cash_ins SET ${UPDATE_COLUMNS.map((column) => `${column} = ?`).join(', ')} WHERE id = ? AND version = ?`

const USAGE_SQL = `SELECT
  COALESCE(SUM(CASE WHEN created_at >= ? AND created_at < ? THEN usdc_amount ELSE 0 END), 0) AS usdc_day,
  COALESCE(SUM(CASE WHEN created_at >= ? AND created_at < ? THEN usdc_amount ELSE 0 END), 0) AS usdc_month,
  COALESCE(SUM(CASE WHEN created_at >= ? AND created_at < ? THEN cop_amount ELSE 0 END), 0) AS cop_month
FROM cash_ins
WHERE customer_document = ?
  AND (
    (status = 'quoted' AND expires_at > ?)
    OR status IN ('settling', 'settled', 'sending_usdc', 'completed', 'failed_stellar')
  )`

const RESERVED_SQL = `SELECT COALESCE(SUM(usdc_amount), 0) AS amount
FROM cash_ins
WHERE (status = 'quoted' AND expires_at > ?)
   OR status IN ('settling', 'settled', 'sending_usdc', 'failed_stellar')`

interface CashInRow {
  readonly id: string
  readonly status: string
  readonly cop_amount: bigint
  readonly cop_scale: bigint
  readonly cop_asset: string
  readonly usdc_amount: bigint
  readonly usdc_scale: bigint
  readonly usdc_asset: string
  readonly rate_amount: bigint
  readonly rate_scale: bigint
  readonly rate_asset: string
  readonly expires_at: string
  readonly stellar_address: string
  readonly memo: string
  readonly customer_phone: string
  readonly customer_full_name: string
  readonly customer_document: string
  readonly incoming_payment_url: string
  readonly quote_id: string
  readonly outgoing_payment_id: string | null
  readonly incoming_completed: bigint
  readonly stellar_tx_hash: string | null
  readonly stellar_envelope_xdr: string | null
  readonly failure_reason: string | null
  readonly created_at: string
  readonly updated_at: string
  readonly version: bigint
}

interface UsageRow {
  readonly usdc_day: bigint
  readonly usdc_month: bigint
  readonly cop_month: bigint
}

interface AmountRow {
  readonly amount: bigint
}

interface IdempotencyRow {
  readonly idempotency_body: string | null
}

export class SqliteCashInRepository implements CashInRepository {
  readonly #db: DatabaseSync
  readonly #insert: StatementSync
  readonly #update: StatementSync
  readonly #get: StatementSync
  readonly #recent: StatementSync
  readonly #usage: StatementSync
  readonly #reserved: StatementSync
  readonly #idempotency: StatementSync

  constructor(db: DatabaseSync) {
    this.#db = db
    this.#insert = db.prepare(INSERT_SQL)
    this.#update = db.prepare(UPDATE_SQL)
    this.#get = db.prepare('SELECT * FROM cash_ins WHERE id = ?')
    this.#recent = db.prepare('SELECT * FROM cash_ins ORDER BY created_at DESC, id DESC LIMIT ?')
    this.#usage = db.prepare(USAGE_SQL)
    this.#reserved = db.prepare(RESERVED_SQL)
    this.#idempotency = db.prepare('SELECT * FROM cash_ins WHERE idempotency_key = ?')
  }

  insert(cashIn: CashIn, idempotency?: IdempotencyRecord): Promise<void> {
    return runPort(() => {
      try {
        this.#insert.run(...bindings(cashIn), idempotency?.key ?? null, idempotency?.body ?? null)
      } catch (error) {
        if (isUniqueConstraint(error)) conflict()
        versionConflict(error)
      }
    })
  }

  findIdempotency(key: string): Promise<IdempotencyHit | undefined> {
    return runPort(() => {
      const row = this.#idempotency.get(key) as (CashInRow & IdempotencyRow) | undefined
      if (row === undefined) return undefined
      return { cashIn: mapCashIn(row), body: row.idempotency_body ?? '' }
    })
  }

  get(id: string): Promise<CashIn | undefined> {
    return runPort(() => {
      const row = this.#get.get(id) as CashInRow | undefined
      if (row === undefined) return undefined
      return mapCashIn(row)
    })
  }

  save(next: CashIn, expectedVersion: number): Promise<void> {
    return runPort(() => {
      if (next.version !== expectedVersion + 1) conflict()
      const result = this.#update.run(...updateBindings(next, expectedVersion))
      if (!changed(result.changes)) conflict()
    })
  }

  listRecent(limit: number): Promise<CashIn[]> {
    return runPort(() => {
      const rows = this.#recent.all(limit) as unknown as CashInRow[]
      return rows.map((row) => mapCashIn(row))
    })
  }

  listByStatus(statuses: readonly CashInStatus[]): Promise<CashIn[]> {
    return runPort(() => {
      if (statuses.length === 0) return []
      const placeholders = statuses.map(() => '?').join(', ')
      const rows = this.#db
        .prepare(
          `SELECT * FROM cash_ins WHERE status IN (${placeholders}) ORDER BY created_at ASC, id ASC`,
        )
        .all(...statuses) as unknown as CashInRow[]
      return rows.map((row) => mapCashIn(row))
    })
  }

  usageFor(documentNumber: string, now: Date): Promise<CashInUsage> {
    return runPort(() => {
      const day = utcWindow(now, 'day')
      const month = utcWindow(now, 'month')
      const raw = this.#usage.get(
        day.start,
        day.end,
        month.start,
        month.end,
        month.start,
        month.end,
        documentNumber,
        now.toISOString(),
      )
      const row = (raw ?? { usdc_day: 0n, usdc_month: 0n, cop_month: 0n }) as unknown as UsageRow
      return {
        usdcDay: money(row.usdc_day, 'USDC', 2),
        usdcMonth: money(row.usdc_month, 'USDC', 2),
        copMonth: money(row.cop_month, 'COP', 2),
      }
    })
  }

  reservedUsdc(now: Date): Promise<Money> {
    return runPort(() => {
      const raw = this.#reserved.get(now.toISOString())
      const row = (raw ?? { amount: 0n }) as unknown as AmountRow
      return money(row.amount, 'USDC', 2)
    })
  }
}

function bindings(cashIn: CashIn): SQLInputValue[] {
  return [
    cashIn.id,
    cashIn.status,
    cashIn.cop.amount,
    cashIn.cop.assetScale,
    cashIn.cop.assetCode,
    cashIn.usdc.amount,
    cashIn.usdc.assetScale,
    cashIn.usdc.assetCode,
    cashIn.copPerUsdc.amount,
    cashIn.copPerUsdc.assetScale,
    cashIn.copPerUsdc.assetCode,
    cashIn.expiresAt.toISOString(),
    cashIn.stellarAddress,
    cashIn.memo,
    cashIn.customer.phone,
    cashIn.customer.fullName,
    cashIn.customer.documentNumber,
    cashIn.openPayments.incomingPaymentUrl,
    cashIn.openPayments.quoteId,
    cashIn.openPayments.outgoingPaymentId ?? null,
    cashIn.openPayments.incomingCompleted ? 1 : 0,
    cashIn.stellarTxHash ?? null,
    cashIn.stellarEnvelopeXdr ?? null,
    cashIn.failureReason ?? null,
    cashIn.createdAt.toISOString(),
    cashIn.updatedAt.toISOString(),
    cashIn.version,
  ]
}

function updateBindings(cashIn: CashIn, expectedVersion: number): SQLInputValue[] {
  const [, ...withoutId] = bindings(cashIn)
  return [...withoutId, cashIn.id, expectedVersion]
}

function mapCashIn(row: CashInRow): CashIn {
  const openPayments: CashInOpenPayments = {
    incomingPaymentUrl: row.incoming_payment_url,
    quoteId: row.quote_id,
    incomingCompleted: row.incoming_completed === 1n,
    ...(row.outgoing_payment_id !== null ? { outgoingPaymentId: row.outgoing_payment_id } : {}),
  }
  return {
    id: row.id,
    status: row.status as CashInStatus,
    cop: money(row.cop_amount, row.cop_asset, Number(row.cop_scale)),
    usdc: money(row.usdc_amount, row.usdc_asset, Number(row.usdc_scale)),
    copPerUsdc: money(row.rate_amount, row.rate_asset, Number(row.rate_scale)),
    expiresAt: new Date(row.expires_at),
    stellarAddress: row.stellar_address,
    memo: row.memo,
    customer: {
      phone: row.customer_phone,
      fullName: row.customer_full_name,
      documentNumber: row.customer_document,
    },
    openPayments,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    version: Number(row.version),
    ...(row.stellar_tx_hash !== null ? { stellarTxHash: row.stellar_tx_hash } : {}),
    ...(row.stellar_envelope_xdr !== null ? { stellarEnvelopeXdr: row.stellar_envelope_xdr } : {}),
    ...(row.failure_reason !== null ? { failureReason: row.failure_reason } : {}),
  }
}

function utcWindow(now: Date, unit: 'day' | 'month'): { start: string; end: string } {
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const start =
    unit === 'day'
      ? new Date(Date.UTC(year, month, now.getUTCDate()))
      : new Date(Date.UTC(year, month, 1))
  const end =
    unit === 'day'
      ? new Date(Date.UTC(year, month, now.getUTCDate() + 1))
      : new Date(Date.UTC(year, month + 1, 1))
  return { start: start.toISOString(), end: end.toISOString() }
}
