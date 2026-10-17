import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'

import { buildApp } from './adapters/http/app.ts'
import { loggerOptions, type LoggerOptions } from './adapters/http/logger.ts'
import { createGrantGateway } from './adapters/open-payments/grant-gateway.ts'
import { openWalletSession } from './adapters/open-payments/clients.ts'
import { openDatabase } from './adapters/sqlite/database.ts'
import { migrate } from './adapters/sqlite/migrate.ts'
import { SqliteStoreGrantRepository } from './adapters/sqlite/store-grant-repository.ts'
import type { Config } from './config.ts'
import { ConfiguredRateProvider, type RateProvider } from './pricing/rate-provider.ts'
import { Mutex } from './shared/mutex.ts'
import type { Clock, IdGenerator } from './shared/ports.ts'
import type { GrantGateway } from './store-grant/gateway.ts'
import type { StoreGrantRepository } from './store-grant/repository.ts'
import { StoreGrantService } from './store-grant/application/store-grant-service.ts'

export interface ComposeOverrides {
  readonly rate?: RateProvider
  readonly grants?: StoreGrantRepository
  readonly gateway?: GrantGateway
  readonly clock?: Clock
  readonly ids?: IdGenerator
  readonly mutex?: Mutex
  readonly logger?: false | LoggerOptions
}

export interface AppRuntime {
  readonly app: ReturnType<typeof buildApp>
  close(): Promise<void>
}

export function composeApp(config: Config, overrides: ComposeOverrides = {}): AppRuntime {
  const db = overrides.grants === undefined ? openDatabase(config.database.path) : undefined
  if (db !== undefined) migrate(db)
  const grants = overrides.grants ?? new SqliteStoreGrantRepository(requireDb(db))
  const clock = overrides.clock ?? { now: () => new Date() }
  const gateway = overrides.gateway ?? lazyGrantGateway(config)
  const rate =
    overrides.rate ??
    new ConfiguredRateProvider(
      {
        referenceCopPerUsd: config.business.referenceCopPerUsd,
        spreadPct: config.business.spreadPct,
      },
      clock,
    )
  const storeGrant = new StoreGrantService({
    grants,
    gateway,
    clock,
    ids: overrides.ids ?? { next: () => randomUUID() },
    mutex: overrides.mutex ?? new Mutex(),
    dailyGrantLimitCop: config.business.dailyGrantLimitCop,
    publicBaseUrl: config.http.publicBaseUrl,
  })
  const logger = loggerFor(config, overrides.logger)
  const app = buildApp({ logger, rate, storeGrant, webBaseUrl: config.http.webBaseUrl, clock })
  return {
    app,
    close: async () => {
      await app.close()
      db?.close()
    },
  }
}

function loggerFor(config: Config, override: ComposeOverrides['logger']): false | LoggerOptions {
  if (override !== undefined) return override
  return { ...loggerOptions, level: config.http.logLevel }
}

function requireDb(db: DatabaseSync | undefined): DatabaseSync {
  if (db === undefined) throw new Error('database was not opened')
  return db
}

function lazyGrantGateway(config: Config): GrantGateway {
  let session: Promise<GrantGateway> | undefined
  const load = (): Promise<GrantGateway> => {
    session ??= openWalletSession(config.store)
      .then((wallet) => createGrantGateway(wallet))
      .catch((error: unknown) => {
        session = undefined
        throw error
      })
    return session
  }
  return {
    start: (input) => load().then((gateway) => gateway.start(input)),
    finish: (input) => load().then((gateway) => gateway.finish(input)),
    rotate: (input) => load().then((gateway) => gateway.rotate(input)),
  }
}
