import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'

import { buildApp } from './adapters/http/app.ts'
import { loggerOptions, type LoggerOptions } from './adapters/http/logger.ts'
import { createGrantGateway } from './adapters/open-payments/grant-gateway.ts'
import { openWalletSession } from './adapters/open-payments/clients.ts'
import { createPaymentsNetwork } from './adapters/open-payments/payments-network.ts'
import { SqliteCashInRepository } from './adapters/sqlite/cash-in-repository.ts'
import { openDatabase } from './adapters/sqlite/database.ts'
import { migrate } from './adapters/sqlite/migrate.ts'
import { SqliteStoreGrantRepository } from './adapters/sqlite/store-grant-repository.ts'
import { HorizonUsdcNetwork } from './adapters/stellar/usdc-network.ts'
import type { Config } from './config.ts'
import { CreateCashIn } from './cash-in/application/create-cash-in.ts'
import { GetCashIn } from './cash-in/application/get-cash-in.ts'
import type { PaymentsNetwork } from './cash-in/payments-network.ts'
import type { CashInRepository } from './cash-in/repository.ts'
import { ConfiguredRateProvider, type RateProvider } from './pricing/rate-provider.ts'
import { Mutex } from './shared/mutex.ts'
import type { Clock, IdGenerator } from './shared/ports.ts'
import type { GrantGateway } from './store-grant/gateway.ts'
import type { StoreGrantRepository } from './store-grant/repository.ts'
import { StoreGrantService } from './store-grant/application/store-grant-service.ts'
import { createOperatorService } from './treasury/application/operator-service.ts'
import type { UsdcNetwork } from './treasury/usdc-network.ts'

/** Below this share of the float the operator view warns that a refill is due. */
const LOW_THRESHOLD_PCT = 30

export interface ComposeOverrides {
  readonly rate?: RateProvider
  readonly grants?: StoreGrantRepository
  readonly cashIns?: CashInRepository
  readonly payments?: PaymentsNetwork
  readonly usdc?: UsdcNetwork
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
  const db =
    overrides.grants !== undefined && overrides.cashIns !== undefined
      ? undefined
      : openDatabase(config.database.path)
  if (db !== undefined) migrate(db)
  const grants = overrides.grants ?? new SqliteStoreGrantRepository(requireDb(db))
  const cashIns = overrides.cashIns ?? new SqliteCashInRepository(requireDb(db))
  const clock = overrides.clock ?? { now: () => new Date() }
  const ids = overrides.ids ?? { next: () => randomUUID() }
  const mutex = overrides.mutex ?? new Mutex()
  const gateway = overrides.gateway ?? lazyGrantGateway(config)
  const payments = overrides.payments ?? lazyPayments(config, clock)
  const usdc = overrides.usdc ?? lazyUsdc(config)
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
    ids,
    mutex,
    dailyGrantLimitCop: config.business.dailyGrantLimitCop,
    publicBaseUrl: config.http.publicBaseUrl,
  })
  const createCashIn = new CreateCashIn({
    cashIns,
    payments,
    usdc,
    rate,
    storeGrant,
    clock,
    ids,
    mutex,
  })
  const getCashIn = new GetCashIn({ cashIns, clock })
  const operator = createOperatorService({
    cashIns,
    usdcNetwork: usdc,
    clock,
    mutex: new Mutex(),
    usdcFloat: config.business.usdcFloat,
    lowThresholdPct: LOW_THRESHOLD_PCT,
  })
  const logger = loggerFor(config, overrides.logger)
  const app = buildApp({
    logger,
    rate,
    storeGrant,
    operator,
    cashIns: {
      create: (input) => createCashIn.create(input),
      get: (id) => getCashIn.get(id),
    },
    webBaseUrl: config.http.webBaseUrl,
    clock,
  })
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

function lazyPayments(config: Config, clock: Clock): PaymentsNetwork {
  let session: Promise<PaymentsNetwork> | undefined
  const load = (): Promise<PaymentsNetwork> => {
    session ??= Promise.all([openWalletSession(config.store), openWalletSession(config.operator)])
      .then(([store, operator]) => createPaymentsNetwork({ store, operator }, clock))
      .catch((error: unknown) => {
        session = undefined
        throw error
      })
    return session
  }
  return {
    createIncomingPayment: (input) =>
      load().then((network) => network.createIncomingPayment(input)),
    createQuote: (input) => load().then((network) => network.createQuote(input)),
    createOutgoingPayment: (input) =>
      load().then((network) => network.createOutgoingPayment(input)),
    getOutgoingPayment: (id, accessToken) =>
      load().then((network) => network.getOutgoingPayment(id, accessToken)),
    getIncomingPayment: (url) => load().then((network) => network.getIncomingPayment(url)),
    completeIncomingPayment: (url) =>
      load().then((network) => network.completeIncomingPayment(url)),
  }
}

function lazyUsdc(config: Config): UsdcNetwork {
  let network: UsdcNetwork | undefined
  const load = (): UsdcNetwork => {
    network ??= new HorizonUsdcNetwork({
      horizonUrl: config.stellar.horizonUrl,
      usdcIssuer: config.stellar.usdcIssuer,
      operatorSecret: config.stellar.operatorSecret,
    })
    return network
  }
  return {
    ensureOperatorReady: () => load().ensureOperatorReady(),
    balance: () => load().balance(),
    validateDestination: (address) => load().validateDestination(address),
    prepareTransfer: (input) => load().prepareTransfer(input),
    submit: (prepared) => load().submit(prepared),
    lookup: (txHash) => load().lookup(txHash),
    refill: (input) => load().refill(input),
    isEnvelopeDead: (prepared) => load().isEnvelopeDead(prepared),
  }
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
