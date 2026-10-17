import { describe, expect, it } from 'vitest'
import { DOMAIN_ERROR_CODES, DomainError } from './errors.ts'

describe('DomainError', () => {
  it('exposes the stable code catalog and an Error subclass', () => {
    expect(DOMAIN_ERROR_CODES).toEqual([
      'invalid_amount',
      'asset_mismatch',
      'invalid_transition',
      'quote_expired',
      'limit_exceeded',
      'version_conflict',
    ])
    const error = new DomainError('quote_expired', 'quote is no longer valid')
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('DomainError')
    expect(error.code).toBe('quote_expired')
    expect(error.message).toBe('quote is no longer valid')
  })
})
