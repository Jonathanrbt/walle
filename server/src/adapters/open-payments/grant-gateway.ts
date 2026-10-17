import { isFinalizedGrantWithAccessToken, isPendingGrant } from '@interledger/open-payments'

import { PaymentsNetworkError } from '../../cash-in/payments-network.ts'
import type { Money } from '../../shared/money.ts'
import type { Clock } from '../../shared/ports.ts'
import type { GrantGateway } from '../../store-grant/gateway.ts'
import { toSdkAmount } from './amount.ts'
import type { WalletSession } from './clients.ts'
import { attempt } from './map-error.ts'

const DEFAULT_EXPIRES_IN_SECONDS = 600
const systemClock: Clock = { now: () => new Date() }

export function createGrantGateway(store: WalletSession, clock: Clock = systemClock): GrantGateway {
  return {
    start(input) {
      return start(store, input)
    },
    finish(input) {
      return finish(store, input, clock)
    },
    rotate(input) {
      return rotate(store, input, clock)
    },
  }
}

async function start(
  store: WalletSession,
  input: { limit: Money; finishUri: string; nonce: string; interval: string },
): Promise<{
  redirectUrl: string
  continueUri: string
  continueAccessToken: string
  interactNonce: string
  grantEndpoint: string
  waitSeconds: number
}> {
  return attempt(async () => {
    if (input.limit.assetCode !== store.assetCode || input.limit.assetScale !== store.assetScale) {
      throw new PaymentsNetworkError('rejected', 'grant limit does not match the store wallet')
    }
    const grant = await store.client.grant.request(
      { url: store.authServer },
      {
        access_token: {
          access: [
            {
              type: 'outgoing-payment',
              actions: ['create', 'read', 'list'],
              identifier: store.id,
              limits: {
                debitAmount: toSdkAmount(input.limit),
                interval: input.interval,
              },
            },
          ],
        },
        interact: {
          start: ['redirect'],
          finish: {
            method: 'redirect',
            uri: input.finishUri,
            nonce: input.nonce,
          },
        },
      },
    )
    if (!isPendingGrant(grant)) {
      throw new PaymentsNetworkError('unavailable', 'outgoing grant was not interactive')
    }
    return {
      redirectUrl: grant.interact.redirect,
      continueUri: grant.continue.uri,
      continueAccessToken: grant.continue.access_token.value,
      interactNonce: grant.interact.finish,
      grantEndpoint: store.authServer,
      waitSeconds: grant.continue.wait ?? 0,
    }
  })
}

async function finish(
  store: WalletSession,
  input: { continueUri: string; continueAccessToken: string; interactRef: string },
  clock: Clock,
): Promise<{ accessToken: string; manageUrl: string; tokenExpiresAt: Date }> {
  return attempt(async () => {
    const continued = await store.client.grant.continue(
      { url: input.continueUri, accessToken: input.continueAccessToken },
      { interact_ref: input.interactRef },
    )
    if (!isFinalizedGrantWithAccessToken(continued)) {
      throw new PaymentsNetworkError('unavailable', 'outgoing grant is not finalized')
    }
    return tokenResult(continued.access_token, clock)
  })
}

async function rotate(
  store: WalletSession,
  input: { manageUrl: string; accessToken: string },
  clock: Clock,
): Promise<{ accessToken: string; manageUrl: string; tokenExpiresAt: Date }> {
  return attempt(async () => {
    const rotated = await store.client.token.rotate({
      url: input.manageUrl,
      accessToken: input.accessToken,
    })
    return tokenResult(rotated.access_token, clock)
  })
}

function tokenResult(
  token: { value: string; manage: string; expires_in?: number },
  clock: Clock,
): {
  accessToken: string
  manageUrl: string
  tokenExpiresAt: Date
} {
  return {
    accessToken: token.value,
    manageUrl: token.manage,
    tokenExpiresAt: expiry(token.expires_in, clock.now()),
  }
}

function expiry(expiresIn: number | undefined, now: Date): Date {
  const seconds = expiresIn ?? DEFAULT_EXPIRES_IN_SECONDS
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new PaymentsNetworkError('unavailable', 'token expiry was not a duration')
  }
  return new Date(now.getTime() + Math.round(seconds * 1000))
}
