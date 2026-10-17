import { beforeAll, describe, expect, it } from 'vitest'

import { money } from '../../src/shared/money.ts'
import { PaymentsNetworkError } from '../../src/cash-in/payments-network.ts'
import type { GrantGateway } from '../../src/store-grant/gateway.ts'

export interface GrantContractClock {
  now(): Date
  advance(ms: number): void
}

export function runGrantGatewayContract(
  name: string,
  makeSubject: () => Promise<{
    gateway: GrantGateway
    clock: GrantContractClock
    ttlMs: number
  }>,
): void {
  describe(name, () => {
    let gateway: GrantGateway | undefined
    let clock: GrantContractClock | undefined
    let ttlMs = 0

    beforeAll(async () => {
      const subject = await makeSubject()
      gateway = subject.gateway
      clock = subject.clock
      ttlMs = subject.ttlMs
    })

    function subject(): { gateway: GrantGateway; clock: GrantContractClock; ttlMs: number } {
      if (gateway === undefined || clock === undefined)
        throw new Error('grant gateway was not created')
      return { gateway, clock, ttlMs }
    }

    it('finishes an interactive grant and rotates the token', async () => {
      const { gateway: grants, clock: time, ttlMs: ttl } = subject()
      const started = await grants.start({
        limit: money(200_000_000n, 'COP', 2),
        finishUri: 'https://app.example.test/grants/finish',
        nonce: 'nonce-1',
        interval: 'R/2026-10-17T00:00:00Z/P1D',
      })
      expect(started.redirectUrl.length).toBeGreaterThan(0)
      expect(started.continueUri.length).toBeGreaterThan(0)
      expect(started.continueAccessToken.length).toBeGreaterThan(0)
      expect(started.interactNonce.length).toBeGreaterThan(0)

      const finished = await grants.finish({
        continueUri: started.continueUri,
        continueAccessToken: started.continueAccessToken,
        interactRef: 'interact-ref-1',
      })
      expect(finished.accessToken.length).toBeGreaterThan(0)
      expect(finished.manageUrl.length).toBeGreaterThan(0)
      expect(finished.tokenExpiresAt.getTime()).toBe(time.now().getTime() + ttl)

      const rotated = await grants.rotate({
        manageUrl: finished.manageUrl,
        accessToken: finished.accessToken,
      })
      expect(rotated.accessToken).not.toBe(finished.accessToken)
      expect(rotated.manageUrl).not.toBe(finished.manageUrl)
      expect(rotated.tokenExpiresAt.getTime()).toBe(time.now().getTime() + ttl)

      const reused = grants.rotate({
        manageUrl: finished.manageUrl,
        accessToken: finished.accessToken,
      })
      await expect(reused).rejects.toBeInstanceOf(PaymentsNetworkError)
      await expect(reused).rejects.toMatchObject({ kind: 'unauthorized' })
    })

    it('rejects rotation after the token expires', async () => {
      const { gateway: grants, clock: time, ttlMs: ttl } = subject()
      const started = await grants.start({
        limit: money(200_000_000n, 'COP', 2),
        finishUri: 'https://app.example.test/grants/finish',
        nonce: 'nonce-2',
        interval: 'R/2026-10-17T00:00:00Z/P1D',
      })
      const finished = await grants.finish({
        continueUri: started.continueUri,
        continueAccessToken: started.continueAccessToken,
        interactRef: 'interact-ref-2',
      })
      time.advance(ttl)
      const rotated = grants.rotate({
        manageUrl: finished.manageUrl,
        accessToken: finished.accessToken,
      })
      await expect(rotated).rejects.toMatchObject({ kind: 'unauthorized' })
    })
  })
}
