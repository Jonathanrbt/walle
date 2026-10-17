import { readdirSync, readFileSync } from 'node:fs'
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

interface Migration {
  readonly version: number
  readonly sql: string
}

export function migrate(db: DatabaseSync, migrationsDir = DEFAULT_DIR): void {
  const known = loadMigrations(migrationsDir)
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`)
  const applied = readApplied(db)
  const knownVersions = new Set(known.map((migration) => migration.version))
  for (const version of applied) {
    if (!knownVersions.has(version)) {
      throw new Error(`database schema version ${version.toString()} is newer than this code`)
    }
  }
  const pending = known.filter((migration) => !applied.includes(migration.version))
  if (pending.length === 0) return

  db.exec('BEGIN IMMEDIATE')
  try {
    const record = db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
    for (const migration of pending) {
      db.exec(migration.sql)
      record.run(migration.version, new Date().toISOString())
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function loadMigrations(dir: string): Migration[] {
  const names = readdirSync(dir).filter((name) => name.endsWith('.sql'))
  const migrations = names.map((name) => {
    const digits = /^(\d+)/.exec(name)?.[1]
    if (digits === undefined) {
      throw new Error(`migration file name must start with a version: ${name}`)
    }
    return {
      version: Number(digits),
      sql: readFileSync(join(dir, name), 'utf8'),
    }
  })
  migrations.sort((left, right) => left.version - right.version)
  return migrations
}

function readApplied(db: DatabaseSync): number[] {
  const rows = db.prepare('SELECT version FROM schema_migrations').all()
  return rows.map((row) => integerColumn(row.version))
}

function integerColumn(value: SQLOutputValue | undefined): number {
  if (typeof value === 'bigint' || typeof value === 'number') return Number(value)
  throw new Error('schema_migrations.version is not an integer')
}
