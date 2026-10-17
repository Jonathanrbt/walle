import { DomainError } from '../../shared/errors.ts'

const SQLITE_CONSTRAINT_PRIMARYKEY = 1555
const SQLITE_CONSTRAINT_UNIQUE = 2067

export async function runPort<T>(body: () => T): Promise<T> {
  await Promise.resolve()
  return body()
}

export function versionConflict(error: unknown): never {
  if (isPrimaryKeyConstraint(error)) {
    throw new DomainError('version_conflict', 'version conflict')
  }
  throw error
}

export function conflict(): never {
  throw new DomainError('version_conflict', 'version conflict')
}

export function changed(changes: number | bigint): boolean {
  return BigInt(changes) !== 0n
}

export function isUniqueConstraint(error: unknown): boolean {
  return constraintCode(error) === SQLITE_CONSTRAINT_UNIQUE
}

function isPrimaryKeyConstraint(error: unknown): boolean {
  return constraintCode(error) === SQLITE_CONSTRAINT_PRIMARYKEY
}

function constraintCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('errcode' in error)) return undefined
  return typeof error.errcode === 'number' ? error.errcode : undefined
}
