import { OpenPaymentsClientError } from '@interledger/open-payments'
import { describe, expect, it } from 'vitest'

import { PaymentsNetworkError } from '../../cash-in/payments-network.ts'
import { mapOpenPaymentsError } from './map-error.ts'

const TOKEN = 'super-secret-access-token-value'

describe('mapOpenPaymentsError', () => {
  it.each([
    [400, 'rejected', false],
    [401, 'unauthorized', false],
    [403, 'unauthorized', false],
    [500, 'unavailable', true],
    [503, 'unavailable', true],
  ] as const)('maps HTTP %s to %s', (status, kind, retryable) => {
    const error = new OpenPaymentsClientError('request failed', {
      description: 'non-positive receive amount',
      status,
    })
    const mapped = mapOpenPaymentsError(error)
    expect(mapped).toBeInstanceOf(PaymentsNetworkError)
    expect(mapped.kind).toBe(kind)
    expect(mapped.retryable).toBe(retryable)
    expect(mapped.detail).toBe('non-positive receive amount')
  })

  it('maps a network failure with no status to unavailable', () => {
    const mapped = mapOpenPaymentsError(new TypeError('fetch failed'))
    expect(mapped.kind).toBe('unavailable')
    expect(mapped.retryable).toBe(true)
    expect(mapped.detail).not.toContain('fetch failed')
  })

  it('drops token-like text from the detail', () => {
    const error = new OpenPaymentsClientError('request failed', {
      description: `rejected ${TOKEN}`,
      status: 400,
    })
    const mapped = mapOpenPaymentsError(error)
    expect(mapped.kind).toBe('rejected')
    expect(mapped.detail).not.toContain(TOKEN)
    expect(mapped.message).not.toContain(TOKEN)
  })
})
