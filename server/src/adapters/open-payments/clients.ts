import { createAuthenticatedClient, type AuthenticatedClient } from '@interledger/open-payments'

import type { WalletCredentials } from '../../config.ts'
import { attempt } from './map-error.ts'
import { loadPrivateKey } from './private-key.ts'

const REQUEST_TIMEOUT_MS = 20_000

export interface WalletSession {
  readonly client: AuthenticatedClient
  readonly walletAddressUrl: string
  readonly id: string
  readonly authServer: string
  readonly resourceServer: string
  readonly assetCode: string
  readonly assetScale: number
}

export async function openWalletSession(credentials: WalletCredentials): Promise<WalletSession> {
  return attempt(async () => {
    const client = await createAuthenticatedClient({
      walletAddressUrl: credentials.walletAddressUrl,
      keyId: credentials.keyId,
      privateKey: loadPrivateKey(credentials.privateKey),
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      logLevel: 'silent',
    })
    const wallet = await client.walletAddress.get({ url: credentials.walletAddressUrl })
    return {
      client,
      walletAddressUrl: credentials.walletAddressUrl,
      id: wallet.id,
      authServer: wallet.authServer,
      resourceServer: wallet.resourceServer,
      assetCode: wallet.assetCode,
      assetScale: wallet.assetScale,
    }
  })
}
