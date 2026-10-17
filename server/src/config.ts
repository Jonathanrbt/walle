import { existsSync, readFileSync } from 'node:fs'
import { z } from 'zod'

const STELLAR_SECRET = /^S[A-Z2-7]{55}$/
const STELLAR_ACCOUNT = /^G[A-Z2-7]{55}$/
const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const
const PEM_MARK = 'BEGIN PRIVATE KEY'

const DEFAULTS = {
  HORIZON_URL: 'https://horizon-testnet.stellar.org',
  STELLAR_USDC_ISSUER: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  PORT: '3000',
  PUBLIC_BASE_URL: 'http://localhost:3000',
  WEB_BASE_URL: 'http://localhost:5173',
  REFERENCE_COP_PER_USD: '3177',
  SPREAD_PCT: '3',
  DAILY_GRANT_LIMIT_COP: '2000000',
  USDC_FLOAT: '1000',
  DATABASE_PATH: 'data/walle.sqlite',
  LOG_LEVEL: 'info',
} as const

/** Names plus a fixed rule. Digits and letters only, so a secret cannot pass through. */
const SAFE_PROBLEM = /^[A-Z][A-Z0-9_]*: [A-Za-z0-9 (),./:-]+$/

export class ConfigError extends Error {
  constructor(problems: readonly string[]) {
    const lines = [...new Set(problems)].map((problem) => `- ${problem}`)
    super(`Invalid configuration:\n${lines.join('\n')}`)
    this.name = 'ConfigError'
  }
}

export type LogLevel = (typeof LOG_LEVELS)[number]

export interface WalletCredentials {
  readonly walletAddressUrl: string
  readonly keyId: string
  readonly privateKey: string
}

export interface Config {
  readonly store: WalletCredentials
  readonly operator: WalletCredentials
  readonly stellar: {
    readonly operatorSecret: string
    readonly horizonUrl: string
    readonly usdcIssuer: string
  }
  readonly http: {
    readonly port: number
    readonly publicBaseUrl: string
    readonly webBaseUrl: string
    readonly logLevel: LogLevel
  }
  readonly business: {
    readonly referenceCopPerUsd: string
    readonly spreadPct: string
    readonly dailyGrantLimitCop: string
    readonly usdcFloat: string
  }
  readonly database: {
    readonly path: string
  }
}

type Env = Record<string, string | undefined>

function rule(name: string, text: string): string {
  return `${name}: ${text}`
}

function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

function isPositiveDecimal(value: string): boolean {
  if (!/^\d+(\.\d+)?$/.test(value)) return false
  const [whole = '', fraction = ''] = value.split('.')
  return whole.replace(/^0+/, '') !== '' || fraction.replace(/0+$/, '') !== ''
}

function isPort(value: string): boolean {
  if (!/^\d+$/.test(value)) return false
  const port = Number(value)
  return port >= 1 && port <= 65535
}

function isPemOrExistingFile(value: string): boolean {
  if (value.includes(PEM_MARK)) return true
  try {
    return existsSync(value)
  } catch {
    return false
  }
}

function httpsUrl(name: string) {
  const message = rule(name, 'must be an https URL')
  return z.string({ error: message }).refine(isHttps, { error: message })
}

/** Accepts what the test wallet UI shows: `$host/path`, `host/path` or the full URL. */
function normalizeWalletAddress(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim().replace(/^["']|["']$/g, '')
  if (trimmed.startsWith('$')) return `https://${trimmed.slice(1)}`
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

function walletAddressUrl(name: string) {
  return z.preprocess(normalizeWalletAddress, httpsUrl(name))
}

function httpUrl(name: string) {
  const message = rule(name, 'must be an http(s) URL')
  return z.string({ error: message }).refine(isHttpUrl, { error: message })
}

function requiredText(name: string) {
  return z.string({ error: rule(name, 'is required') }).min(1, { error: rule(name, 'is required') })
}

function privateKey(name: string) {
  const message = rule(name, 'must be a PEM private key or a path to an existing file')
  return z.string({ error: message }).refine(isPemOrExistingFile, { error: message })
}

function positiveDecimal(name: string, fallback: string) {
  const message = rule(name, 'must be a positive decimal')
  return z
    .string({ error: message })
    .default(fallback)
    .refine(isPositiveDecimal, { error: message })
}

const envSchema = z.object({
  WALLET_ADDRESS_URL: walletAddressUrl('WALLET_ADDRESS_URL'),
  KEY_ID: requiredText('KEY_ID'),
  TEST_KEY: privateKey('TEST_KEY'),
  WALLET_ADDRESS_URL_VENDEDOR: walletAddressUrl('WALLET_ADDRESS_URL_VENDEDOR'),
  KEY_ID_VENDEDOR: requiredText('KEY_ID_VENDEDOR'),
  TEST_KEY_VENDEDOR: privateKey('TEST_KEY_VENDEDOR'),
  STELLAR_OPERATOR_SECRET: z
    .string({ error: rule('STELLAR_OPERATOR_SECRET', 'must be a Stellar secret seed') })
    .regex(STELLAR_SECRET, {
      error: rule('STELLAR_OPERATOR_SECRET', 'must be a Stellar secret seed'),
    }),
  HORIZON_URL: httpsUrl('HORIZON_URL').default(DEFAULTS.HORIZON_URL),
  STELLAR_USDC_ISSUER: z
    .string({ error: rule('STELLAR_USDC_ISSUER', 'must be a Stellar account id') })
    .regex(STELLAR_ACCOUNT, { error: rule('STELLAR_USDC_ISSUER', 'must be a Stellar account id') })
    .default(DEFAULTS.STELLAR_USDC_ISSUER),
  PORT: z
    .string({ error: rule('PORT', 'must be an integer from 1 to 65535') })
    .default(DEFAULTS.PORT)
    .refine(isPort, { error: rule('PORT', 'must be an integer from 1 to 65535') })
    .transform((value) => Number(value)),
  PUBLIC_BASE_URL: httpUrl('PUBLIC_BASE_URL').default(DEFAULTS.PUBLIC_BASE_URL),
  WEB_BASE_URL: httpUrl('WEB_BASE_URL').default(DEFAULTS.WEB_BASE_URL),
  REFERENCE_COP_PER_USD: positiveDecimal('REFERENCE_COP_PER_USD', DEFAULTS.REFERENCE_COP_PER_USD),
  SPREAD_PCT: positiveDecimal('SPREAD_PCT', DEFAULTS.SPREAD_PCT),
  DAILY_GRANT_LIMIT_COP: positiveDecimal('DAILY_GRANT_LIMIT_COP', DEFAULTS.DAILY_GRANT_LIMIT_COP),
  USDC_FLOAT: positiveDecimal('USDC_FLOAT', DEFAULTS.USDC_FLOAT),
  DATABASE_PATH: z
    .string({ error: rule('DATABASE_PATH', 'is required') })
    .default(DEFAULTS.DATABASE_PATH),
  LOG_LEVEL: z
    .enum(LOG_LEVELS, { error: rule('LOG_LEVEL', 'must be a known level') })
    .default(DEFAULTS.LOG_LEVEL),
})

function present(env: Env, key: string): string | undefined {
  const value = env[key]
  if (value === undefined) return undefined
  if (key === 'TEST_KEY' || key === 'TEST_KEY_VENDEDOR') {
    return value.length > 0 ? value : undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function safeProblem(path: PropertyKey, message: string): string {
  if (SAFE_PROBLEM.test(message)) return message
  const name = typeof path === 'string' ? path : 'configuration'
  return rule(name, 'is invalid')
}

function resolvePrivateKey(name: string, value: string): string {
  if (value.includes(PEM_MARK)) return value
  let text: string
  try {
    text = readFileSync(value, 'utf8')
  } catch {
    throw new ConfigError([rule(name, 'must be a PEM private key or a path to an existing file')])
  }
  if (!text.includes(PEM_MARK)) {
    throw new ConfigError([rule(name, 'must be a PEM private key or a path to an existing file')])
  }
  return text
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

export function loadConfig(env: Env): Config {
  const input: Record<string, string> = {}
  for (const key of Object.keys(envSchema.shape)) {
    const value = present(env, key)
    if (value !== undefined) input[key] = value
  }

  const parsed = envSchema.safeParse(input)
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) =>
        safeProblem(issue.path[0] ?? 'configuration', issue.message),
      ),
    )
  }

  const data = parsed.data
  return deepFreeze({
    store: {
      walletAddressUrl: data.WALLET_ADDRESS_URL,
      keyId: data.KEY_ID,
      privateKey: resolvePrivateKey('TEST_KEY', data.TEST_KEY),
    },
    operator: {
      walletAddressUrl: data.WALLET_ADDRESS_URL_VENDEDOR,
      keyId: data.KEY_ID_VENDEDOR,
      privateKey: resolvePrivateKey('TEST_KEY_VENDEDOR', data.TEST_KEY_VENDEDOR),
    },
    stellar: {
      operatorSecret: data.STELLAR_OPERATOR_SECRET,
      horizonUrl: data.HORIZON_URL,
      usdcIssuer: data.STELLAR_USDC_ISSUER,
    },
    http: {
      port: data.PORT,
      publicBaseUrl: data.PUBLIC_BASE_URL,
      webBaseUrl: data.WEB_BASE_URL,
      logLevel: data.LOG_LEVEL,
    },
    business: {
      referenceCopPerUsd: data.REFERENCE_COP_PER_USD,
      spreadPct: data.SPREAD_PCT,
      dailyGrantLimitCop: data.DAILY_GRANT_LIMIT_COP,
      usdcFloat: data.USDC_FLOAT,
    },
    database: {
      path: data.DATABASE_PATH,
    },
  })
}
