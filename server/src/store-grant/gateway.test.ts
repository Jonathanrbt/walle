import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { verifyFinishHash } from './gateway.ts'

const VECTOR = {
  nonce: 'client-nonce',
  interactNonce: 'as-finish-nonce',
  interactRef: 'interact-ref',
  grantEndpoint: 'https://auth.example.test/g',
  hash: 'Hc7CNEao4lsunNpVa/aXTF8owmT9HG26a3FF3NJLkvw=',
} as const

function documentedHash(endpoint: string): string {
  return createHash('sha256')
    .update([VECTOR.nonce, VECTOR.interactNonce, VECTOR.interactRef, endpoint].join('\n'))
    .digest('base64')
}

describe('verifyFinishHash', () => {
  it('accepts the padded SHA-256 of nonce, finish nonce, interact ref, and grant endpoint', () => {
    expect(documentedHash(VECTOR.grantEndpoint)).toBe(VECTOR.hash)
    expect(verifyFinishHash(VECTOR)).toBe(true)
  })

  it('rejects a wrong client nonce', () => {
    expect(verifyFinishHash({ ...VECTOR, nonce: 'other-nonce' })).toBe(false)
  })

  it('rejects a wrong interact ref', () => {
    expect(verifyFinishHash({ ...VECTOR, interactRef: 'other-ref' })).toBe(false)
  })

  it('rejects a wrong grant endpoint', () => {
    expect(verifyFinishHash({ ...VECTOR, grantEndpoint: 'https://auth.example.test/other' })).toBe(
      false,
    )
  })

  it('rejects a missing grant endpoint even when the digest matches an empty line', () => {
    expect(
      verifyFinishHash({
        ...VECTOR,
        grantEndpoint: '',
        hash: documentedHash(''),
      }),
    ).toBe(false)
  })

  it('rejects the same digest without base64 padding', () => {
    expect(verifyFinishHash({ ...VECTOR, hash: VECTOR.hash.replace(/=+$/, '') })).toBe(false)
  })

  it('requires the grant endpoint at compile time', () => {
    const withoutEndpoint = {
      nonce: VECTOR.nonce,
      interactNonce: VECTOR.interactNonce,
      interactRef: VECTOR.interactRef,
      hash: VECTOR.hash,
    }
    // @ts-expect-error the grant endpoint is required
    const checked: Parameters<typeof verifyFinishHash>[0] = withoutEndpoint
    expect(checked.nonce).toBe(VECTOR.nonce)
  })
})
