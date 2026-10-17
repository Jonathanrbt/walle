import { CashIn, Inventory, RefillResult } from '@walle/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { formatDecimal } from '../../../shared/money.ts'
import { OperatorError } from '../../../treasury/application/errors.ts'
import type { OperatorService } from '../../../treasury/application/operator-service.ts'
import { toCashInDto } from '../cash-in-dto.ts'
import { AppError } from '../errors.ts'

export function registerOperatorRoutes(
  app: FastifyInstance,
  deps: { readonly operator: OperatorService },
): void {
  app.get(
    '/api/operator/cash-ins',
    {
      schema: {
        response: { 200: z.array(CashIn) },
      },
    },
    async () => {
      const rows = await call(() => deps.operator.listCashIns())
      return rows.map((row) => toCashInDto(row))
    },
  )

  app.get(
    '/api/operator/inventory',
    {
      schema: {
        response: { 200: Inventory },
      },
    },
    async () => {
      const inventory = await call(() => deps.operator.inventory())
      return {
        usdc: formatDecimal(inventory.usdc),
        floatUsdc: formatDecimal(inventory.floatUsdc),
        lowThresholdPct: inventory.lowThresholdPct,
      }
    },
  )

  app.post(
    '/api/operator/inventory/refill',
    {
      schema: {
        response: { 200: RefillResult },
      },
    },
    async () => {
      const result = await call(() => deps.operator.refill())
      return { usdc: formatDecimal(result.usdc) }
    },
  )
}

async function call<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body()
  } catch (error) {
    if (error instanceof OperatorError) throw new AppError(error.code, error.detail)
    throw error
  }
}
