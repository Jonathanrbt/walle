import { CashIn, CashInRequest } from '@walle/contracts'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import type { CreateCashInInput } from '../../../cash-in/application/create-cash-in.ts'
import type { CashIn as CashInDomain } from '../../../cash-in/domain/cash-in.ts'
import { toCashInDto } from '../cash-in-dto.ts'

const params = z.object({
  id: z.string().min(1),
})

const headers = z.looseObject({
  'idempotency-key': z.string().min(1).optional(),
})

export interface CashInRoutes {
  create(input: CreateCashInInput): Promise<CashInDomain>
  get(id: string): Promise<CashInDomain>
  confirm(id: string): Promise<CashInDomain>
  retry(id: string): Promise<CashInDomain>
}

export function registerCashInRoutes(app: FastifyInstance, cashIns: CashInRoutes): void {
  const routes = app.withTypeProvider<ZodTypeProvider>()

  routes.post(
    '/api/cash-ins',
    {
      schema: {
        body: CashInRequest,
        headers,
        response: { 201: CashIn },
      },
    },
    async (request, reply) => {
      const idempotencyKey = request.headers['idempotency-key']
      const created = await cashIns.create({
        copAmount: request.body.copAmount,
        stellarAddress: request.body.stellarAddress,
        customer: request.body.customer,
        ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      })
      return reply.status(201).send(toCashInDto(created))
    },
  )

  routes.get(
    '/api/cash-ins/:id',
    {
      schema: {
        params,
        response: { 200: CashIn },
      },
    },
    async (request) => toCashInDto(await cashIns.get(request.params.id)),
  )

  routes.post(
    '/api/cash-ins/:id/confirm',
    {
      schema: {
        params,
        response: { 202: CashIn },
      },
    },
    async (request, reply) =>
      reply.status(202).send(toCashInDto(await cashIns.confirm(request.params.id))),
  )

  routes.post(
    '/api/cash-ins/:id/retry',
    {
      schema: {
        params,
        response: { 202: CashIn },
      },
    },
    async (request, reply) =>
      reply.status(202).send(toCashInDto(await cashIns.retry(request.params.id))),
  )
}
