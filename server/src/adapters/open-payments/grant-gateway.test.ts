import type { AuthenticatedClient } from '@interledger/open-payments'
import { describe, expect, it, vi } from 'vitest'

import { money } from '../../shared/money.ts'
import type { Clock } from '../../shared/ports.ts'
import type { WalletSession } from './clients.ts'
import { createGrantGateway } from './grant-gateway.ts'

class ManualClock implements Clock {
  #now: number

  constructor(iso: string) {
    this.#now = Date.parse(iso)
  }

  now(): Date {
    return new Date(this.#now)
  }
}

const PENDING = {
  interact: { redirect: 'https://auth.example.test/interact/1', finish: 'as-nonce' },
  continue: {
    uri: 'https://auth.example.test/continue/1',
    access_token: { value: 'continue-token' },
    wait: 5,
  },
}

function accessToken(value: string, expiresIn?: number) {
  return {
    value,
    manage: `https://auth.example.test/token/${value}`,
    access: [],
    ...(expiresIn === undefined ? {} : { expires_in: expiresIn }),
  }
}

function store(client: object): WalletSession {
  return {
    walletAddressUrl: 'https://wallet.example.test/store',
    id: 'https://wallet.example.test/store',
    authServer: 'https://auth.example.test/store',
    resourceServer: 'https://rs.example.test/store',
    assetCode: 'COP',
    assetScale: 2,
    client: client as unknown as AuthenticatedClient,
  }
}

const startInput = {
  limit: money(200_000_000n, 'COP', 2),
  finishUri: 'https://app.example.test/grants/finish',
  nonce: 'nonce-1',
  interval: 'R/2026-10-17T00:00:00Z/P1D',
}

describe('createGrantGateway', () => {
  it('expires tokens from the injected clock', async () => {
    const clock = new ManualClock('2026-10-17T00:00:00.000Z')
    const request = vi.fn(() => Promise.resolve(PENDING))
    const cont = vi.fn(() =>
      Promise.resolve({ access_token: accessToken('access-1', 60), continue: PENDING.continue }),
    )
    const rotate = vi.fn(() => Promise.resolve({ access_token: accessToken('access-2', 90) }))
    const gateway = createGrantGateway(
      store({ grant: { request, continue: cont }, token: { rotate } }),
      clock,
    )

    const started = await gateway.start(startInput)
    const finished = await gateway.finish({
      continueUri: started.continueUri,
      continueAccessToken: started.continueAccessToken,
      interactRef: 'interact-ref',
    })
    const rotated = await gateway.rotate({
      manageUrl: finished.manageUrl,
      accessToken: finished.accessToken,
    })

    expect(request).toHaveBeenCalledWith(
      { url: 'https://auth.example.test/store' },
      expect.objectContaining({
        access_token: {
          access: [
            expect.objectContaining({
              type: 'outgoing-payment',
              actions: ['create', 'read', 'list'],
              identifier: 'https://wallet.example.test/store',
            }),
          ],
        },
      }),
    )
    expect(started).toEqual({
      redirectUrl: PENDING.interact.redirect,
      continueUri: PENDING.continue.uri,
      continueAccessToken: 'continue-token',
      interactNonce: 'as-nonce',
      grantEndpoint: 'https://auth.example.test/store',
      waitSeconds: 5,
    })
    expect(finished.tokenExpiresAt.toISOString()).toBe('2026-10-17T00:01:00.000Z')
    expect(rotated.tokenExpiresAt.toISOString()).toBe('2026-10-17T00:01:30.000Z')
    expect(rotated.accessToken).toBe('access-2')
    expect(cont).toHaveBeenCalledWith(
      { url: started.continueUri, accessToken: 'continue-token' },
      { interact_ref: 'interact-ref' },
    )
  })

  it('uses ten minutes when the auth server omits expires_in', async () => {
    const clock = new ManualClock('2026-10-17T00:00:00.000Z')
    const gateway = createGrantGateway(
      store({
        grant: {
          request: vi.fn(() => Promise.resolve(PENDING)),
          continue: vi.fn(() =>
            Promise.resolve({
              access_token: accessToken('access-1'),
              continue: PENDING.continue,
            }),
          ),
        },
        token: { rotate: vi.fn() },
      }),
      clock,
    )
    const started = await gateway.start(startInput)
    const finished = await gateway.finish({
      continueUri: started.continueUri,
      continueAccessToken: started.continueAccessToken,
      interactRef: 'interact-ref',
    })
    expect(finished.tokenExpiresAt.toISOString()).toBe('2026-10-17T00:10:00.000Z')
  })

  it('rejects a limit the store wallet cannot grant', async () => {
    const request = vi.fn()
    const gateway = createGrantGateway(store({ grant: { request } }))
    await expect(
      gateway.start({ ...startInput, limit: money(1n, 'USD', 2) }),
    ).rejects.toMatchObject({ kind: 'rejected', retryable: false })
    expect(request).not.toHaveBeenCalled()
  })
})
