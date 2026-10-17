import { CashIn, Inventory, RefillResult } from '@walle/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { formatDecimal } from '../../../shared/money.ts'
import { OperatorError } from '../../../treasury/application/errors.ts'
import type { OperatorService } from '../../../treasury/application/operator-service.ts'
import { toCashInDto } from '../cash-in-dto.ts'
import { AppError } from '../errors.ts'
import { OPERATOR_DENIED, operatorGuard } from '../operator-auth.ts'

const deniedBody = z.object({
  error: z.literal(OPERATOR_DENIED.error),
  detail: z.literal(OPERATOR_DENIED.detail),
})

export function registerOperatorRoutes(
  app: FastifyInstance,
  deps: { readonly operator: OperatorService; readonly operatorToken?: string },
): void {
  const guard =
    deps.operatorToken === undefined ? {} : { preHandler: operatorGuard(deps.operatorToken) }
  app.get(
    '/api/operator/cash-ins',
    {
      ...guard,
      schema: {
        response: { 200: z.array(CashIn), 401: deniedBody },
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
      ...guard,
      schema: {
        response: { 200: Inventory, 401: deniedBody },
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
      ...guard,
      schema: {
        response: { 200: RefillResult, 401: deniedBody },
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
