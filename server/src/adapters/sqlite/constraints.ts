import { DomainError } from '../../shared/errors.ts'

const SQLITE_CONSTRAINT_PRIMARYKEY = 1555

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

function isPrimaryKeyConstraint(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'errcode' in error &&
    error.errcode === SQLITE_CONSTRAINT_PRIMARYKEY
  )
}
