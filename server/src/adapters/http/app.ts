import Fastify from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { z } from 'zod'
import { loggerOptions, type LoggerOptions } from './logger.ts'

const healthResponse = z.object({
  status: z.literal('ok'),
})

export interface BuildAppDeps {
  logger?: false | LoggerOptions
}

export function buildApp(deps: BuildAppDeps = {}) {
  const logger = deps.logger === false ? false : (deps.logger ?? loggerOptions)
  const app = Fastify({ logger }).withTypeProvider<ZodTypeProvider>()

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

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

  return app
}
