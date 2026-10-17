import { Keypair, StrKey } from '@stellar/stellar-sdk'
import { StellarError } from '../../treasury/usdc-network.ts'

/** Builds the operator signer. The thrown error never includes the secret. */
export function operatorKeypair(secret: string): Keypair {
  if (!StrKey.isValidEd25519SecretSeed(secret)) {
    throw new StellarError('invalid', 'operator secret is not a Stellar seed')
  }
  try {
    return Keypair.fromSecret(secret)
  } catch {
    throw new StellarError('invalid', 'operator secret is not a Stellar seed')
  }
}
