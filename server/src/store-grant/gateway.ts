import { createHash, timingSafeEqual } from 'node:crypto'

import type { Money } from '../shared/money.ts'

export interface GrantGateway {
  /** Interactive outgoing-payment grant for the store wallet. */
  start(input: {
    readonly limit: Money
    readonly finishUri: string
    readonly nonce: string
    readonly interval: string
  }): Promise<{
    redirectUrl: string
    continueUri: string
    continueAccessToken: string
    /** `interact.finish` from the grant response. Required to verify the redirect hash. */
    interactNonce: string
    /** Seconds the client must wait before calling the continuation URI. */
    waitSeconds: number
  }>

  finish(input: {
    readonly continueUri: string
    readonly continueAccessToken: string
    readonly interactRef: string
  }): Promise<{ accessToken: string; manageUrl: string; tokenExpiresAt: Date }>

  rotate(input: {
    readonly manageUrl: string
    readonly accessToken: string
  }): Promise<{ accessToken: string; manageUrl: string; tokenExpiresAt: Date }>
}

/**
 * GNAP finish hash. Base string is four lines (client nonce, AS finish nonce,
 * interact_ref, grant endpoint) joined by a newline, SHA-256, standard base64
 * with padding. The grant endpoint is the auth server URL the grant was POSTed
 * to. It is not the continuation URI.
 */
export function verifyFinishHash(input: {
  readonly nonce: string
  readonly interactRef: string
  readonly interactNonce: string
  readonly hash: string
  readonly grantEndpoint: string
}): boolean {
  if (input.grantEndpoint.length === 0) return false
  const base = [input.nonce, input.interactNonce, input.interactRef, input.grantEndpoint].join('\n')
  const actual = createHash('sha256').update(base).digest()
  const expected = Buffer.from(input.hash, 'base64')
  const encoded = actual.toString('base64')
  if (encoded !== input.hash || expected.length !== actual.length) return false
  return timingSafeEqual(actual, expected)
}
