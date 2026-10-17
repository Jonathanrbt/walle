import Fastify from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { z } from 'zod'

import type { Clock } from '../../shared/ports.ts'
import type { RateProvider } from '../../pricing/rate-provider.ts'
import type { OperatorService } from '../../treasury/application/operator-service.ts'
import type { StoreGrantService } from '../../store-grant/application/store-grant-service.ts'
import { AppError, installErrorHandler } from './errors.ts'
import { loggerOptions, type LoggerOptions } from './logger.ts'
import { registerCashInRoutes, type CashInRoutes } from './routes/cash-ins.ts'
import { registerGrantRoutes } from './routes/grant.ts'
import { registerOperatorRoutes } from './routes/operator.ts'
import { registerRateRoutes } from './routes/rate.ts'

const healthResponse = z.object({
  status: z.literal('ok'),
})

const systemClock: Clock = { now: () => new Date() }

export interface BuildAppDeps {
  logger?: false | LoggerOptions
  rate: RateProvider
  storeGrant: Pick<StoreGrantService, 'start' | 'finish' | 'status'>
  cashIns: CashInRoutes
  operator: OperatorService
  webBaseUrl: string
  clock?: Clock
  operatorToken?: string
}

export function buildApp(deps: BuildAppDeps) {
  const logger = deps.logger === false ? false : (deps.logger ?? loggerOptions)
  const app = Fastify({ logger }).withTypeProvider<ZodTypeProvider>()
  const clock = deps.clock ?? systemClock

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  installErrorHandler(app, deps.webBaseUrl)
  // Fastify rejects an empty body that declares JSON; action endpoints (confirm, retry, refill) have none.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    if (body === '') {
      done(null, undefined)
      return
    }
    try {
      done(null, JSON.parse(body as string))
    } catch {
      done(new AppError('invalid_request', 'malformed JSON body'))
    }
  })

  app.get(
    '/healthz',
    {
      schema: {
        response: {
          200: healthResponse,
        },
      },
    },
    () => ({ status: 'ok' as const }),
  )

  registerRateRoutes(app, deps.rate)
  registerGrantRoutes(app, {
    storeGrant: deps.storeGrant,
    webBaseUrl: deps.webBaseUrl,
    clock,
    ...(deps.operatorToken === undefined ? {} : { operatorToken: deps.operatorToken }),
  })
  registerCashInRoutes(app, deps.cashIns)
  registerOperatorRoutes(app, {
    operator: deps.operator,
    ...(deps.operatorToken === undefined ? {} : { operatorToken: deps.operatorToken }),
  })

  return app
}
