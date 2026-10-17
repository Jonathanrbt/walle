import { describe, expect, it } from 'vitest'

import { verifyFinishHash } from './gateway.ts'

const VECTOR = {
  nonce: 'client-nonce',
  interactNonce: 'as-finish-nonce',
  interactRef: 'interact-ref',
  continueUri: 'https://auth.example.test/g',
  hash: 'Hc7CNEao4lsunNpVa/aXTF8owmT9HG26a3FF3NJLkvw=',
} as const

describe('verifyFinishHash', () => {
  it('accepts the padded SHA-256 of nonce, finish nonce, interact ref, and grant endpoint', () => {
    expect(verifyFinishHash(VECTOR)).toBe(true)
  })

  it('rejects a wrong client nonce', () => {
    expect(verifyFinishHash({ ...VECTOR, nonce: 'other-nonce' })).toBe(false)
  })

  it('rejects a wrong interact ref', () => {
    expect(verifyFinishHash({ ...VECTOR, interactRef: 'other-ref' })).toBe(false)
  })

  it('rejects a wrong grant endpoint', () => {
    expect(verifyFinishHash({ ...VECTOR, continueUri: 'https://auth.example.test/other' })).toBe(
      false,
    )
  })

  it('rejects the same digest without base64 padding', () => {
    expect(verifyFinishHash({ ...VECTOR, hash: VECTOR.hash.replace(/=+$/, '') })).toBe(false)
  })
})
