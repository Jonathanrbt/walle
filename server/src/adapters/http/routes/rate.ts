import { Rate } from '@walle/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { formatDecimal } from '../../../shared/money.ts'
import type { RateProvider } from '../../../pricing/rate-provider.ts'

export function registerRateRoutes(app: FastifyInstance, rate: RateProvider): void {
  app.get(
    '/api/rate',
    {
      schema: {
        querystring: z.strictObject({}),
        response: { 200: Rate },
      },
    },
    async () => {
      const current = await rate.current()
      return {
        copPerUsdc: formatDecimal(current.copPerUsdc),
        spreadPct: Number(current.spreadPct),
        quotedAt: current.quotedAt.toISOString(),
      }
    },
  )
}
