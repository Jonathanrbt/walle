import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from './config.ts'

const REQUIRED = [
  'WALLET_ADDRESS_URL',
  'KEY_ID',
  'TEST_KEY',
  'WALLET_ADDRESS_URL_VENDEDOR',
  'KEY_ID_VENDEDOR',
  'TEST_KEY_VENDEDOR',
  'STELLAR_OPERATOR_SECRET',
] as const

function pem(): string {
  const { privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  if (!privateKey.includes('BEGIN PRIVATE KEY')) {
    throw new Error('expected an Ed25519 PEM private key')
  }
  return privateKey
}

function stellarSeed(): string {
  return `S${'A'.repeat(55)}`
}

function validEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  const key = pem()
  return {
    WALLET_ADDRESS_URL: 'https://wallet.example.test/store',
    KEY_ID: 'store-key',
    TEST_KEY: key,
    WALLET_ADDRESS_URL_VENDEDOR: 'https://wallet.example.test/operator',
    KEY_ID_VENDEDOR: 'operator-key',
    TEST_KEY_VENDEDOR: key,
    STELLAR_OPERATOR_SECRET: stellarSeed(),
    ...overrides,
  }
}

function configErrorMessage(env: Record<string, string | undefined>): string {
  try {
    loadConfig(env)
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError)
    return error instanceof Error ? error.message : ''
  }
  expect.fail('expected ConfigError')
}

describe('loadConfig', () => {
  it('parses a valid env and applies defaults', () => {
    const env = validEnv()
    const config = loadConfig(env)

    expect(config.store.walletAddressUrl).toBe('https://wallet.example.test/store')
    expect(config.store.keyId).toBe('store-key')
    expect(config.store.privateKey).toContain('BEGIN PRIVATE KEY')
    expect(config.operator.walletAddressUrl).toBe('https://wallet.example.test/operator')
    expect(config.operator.keyId).toBe('operator-key')
    expect(config.operator.privateKey).toContain('BEGIN PRIVATE KEY')
    expect(config.stellar.operatorSecret).toBe(env.STELLAR_OPERATOR_SECRET)
    expect(config.stellar.horizonUrl).toBe('https://horizon-testnet.stellar.org')
    expect(config.stellar.usdcIssuer).toBe(
      'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    )
    expect(config.http.port).toBe(3000)
    expect(config.http.publicBaseUrl).toBe('http://localhost:3000')
    expect(config.http.webBaseUrl).toBe('http://localhost:5173')
    expect(config.http.logLevel).toBe('info')
    expect(config.business.referenceCopPerUsd).toBe('3177')
    expect(config.business.spreadPct).toBe('3')
    expect(config.business.dailyGrantLimitCop).toBe('2000000')
    expect(config.business.usdcFloat).toBe('1000')
    expect(config.database.path).toBe('data/walle.sqlite')
    expect(config.http.operatorToken).toBeUndefined()
    expect(Object.isFrozen(config)).toBe(true)
    expect(Object.isFrozen(config.store)).toBe(true)
  })

  it('honors overrides for values that have defaults', () => {
    const config = loadConfig(
      validEnv({
        PORT: '4010',
        SPREAD_PCT: '2.5',
        DATABASE_PATH: 'data/custom.sqlite',
        LOG_LEVEL: 'debug',
      }),
    )

    expect(config.http.port).toBe(4010)
    expect(config.http.logLevel).toBe('debug')
    expect(config.business.spreadPct).toBe('2.5')
    expect(config.database.path).toBe('data/custom.sqlite')
    expect(config.stellar.horizonUrl).toBe('https://horizon-testnet.stellar.org')
  })

  it('reads a private key from an existing file', () => {
    const key = pem()
    const path = join(mkdtempSync(join(tmpdir(), 'walle-key-')), 'key.pem')
    writeFileSync(path, key)

    const config = loadConfig(validEnv({ TEST_KEY: path, TEST_KEY_VENDEDOR: path }))

    expect(config.store.privateKey).toBe(key)
    expect(config.operator.privateKey).toBe(key)
  })

  it.each(REQUIRED)('names %s when it is missing', (name) => {
    const env: Record<string, string | undefined> = {}
    for (const [key, value] of Object.entries(validEnv())) {
      if (key !== name) env[key] = value
    }

    expect(configErrorMessage(env)).toContain(name)
  })

  it.each([
    ['$ilp.example.test/store', 'https://ilp.example.test/store'],
    ['ilp.example.test/store', 'https://ilp.example.test/store'],
    ['  "https://ilp.example.test/store"  ', 'https://ilp.example.test/store'],
  ])('normalizes wallet address %j to an https URL', (raw, expected) => {
    const config = loadConfig(validEnv({ WALLET_ADDRESS_URL: raw }))
    expect(config.store.walletAddressUrl).toBe(expected)
  })

  it('names the variable when the wallet URL is not https', () => {
    const message = configErrorMessage(
      validEnv({ WALLET_ADDRESS_URL: 'http://wallet.example.test' }),
    )

    expect(message).toContain('WALLET_ADDRESS_URL')
  })

  it('does not include provided secret values in the error', () => {
    const secrets = {
      url: 'http://leak-wallet-url-9f3a.test/x',
      keyId: 'leak-key-id-9f3a',
      pem: 'leak-pem-9f3a',
      seed: 'leak-seed-9f3a',
    }
    const message = configErrorMessage({
      WALLET_ADDRESS_URL: secrets.url,
      KEY_ID: secrets.keyId,
      TEST_KEY: secrets.pem,
      WALLET_ADDRESS_URL_VENDEDOR: secrets.url,
      KEY_ID_VENDEDOR: secrets.keyId,
      TEST_KEY_VENDEDOR: secrets.pem,
      STELLAR_OPERATOR_SECRET: secrets.seed,
    })

    expect(message).toContain('WALLET_ADDRESS_URL')
    expect(message).toContain('TEST_KEY')
    expect(message).toContain('STELLAR_OPERATOR_SECRET')
    expect(message).not.toContain(secrets.url)
    expect(message).not.toContain(secrets.keyId)
    expect(message).not.toContain(secrets.pem)
    expect(message).not.toContain(secrets.seed)
  })

  it('accepts an operator token of at least 16 characters and treats blank as unset', () => {
    const token = 'operator-token-16'
    const config = loadConfig(validEnv({ OPERATOR_TOKEN: `  ${token}  ` }))
    expect(config.http.operatorToken).toBe(token)
    expect(loadConfig(validEnv({ OPERATOR_TOKEN: '   ' })).http.operatorToken).toBeUndefined()
  })

  it('rejects a short operator token without echoing it', () => {
    const token = 'too-short'
    const message = configErrorMessage(validEnv({ OPERATOR_TOKEN: token }))
    expect(message).toContain('OPERATOR_TOKEN')
    expect(message).not.toContain(token)
  })
})
