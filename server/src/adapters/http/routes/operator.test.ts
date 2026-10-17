import { ApiError, CashIn as CashInSchema, Inventory, RefillResult } from '@walle/contracts'
import Fastify from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { describe, expect, it } from 'vitest'

import { createQuoted, type CashIn } from '../../../cash-in/domain/cash-in.ts'
import { money, type Money } from '../../../shared/money.ts'
import { Mutex } from '../../../shared/mutex.ts'
import { createOperatorService } from '../../../treasury/application/operator-service.ts'
import { FakeUsdcNetwork } from '../../../../test/fakes/fake-usdc-network.ts'
import { ManualClock } from '../../../../test/fakes/fake-grant-gateway.ts'
import { createMemoryCashInRepository } from '../../../../test/fakes/memory-cash-in-repository.ts'
import { installErrorHandler } from '../errors.ts'
import { registerOperatorRoutes } from './operator.ts'

const START = new Date('2026-10-17T12:00:00.000Z')
const ADDRESS = `G${'B'.repeat(55)}`

function quoted(id: string, createdAt: Date, usdc: Money, status?: CashIn['status']): CashIn {
  const cashIn = createQuoted(
    {
      id,
      cop: money(20_000n, 'COP', 2),
      usdc,
      copPerUsdc: money(327_231n, 'COP', 2),
      expiresAt: new Date('2026-10-17T12:01:00.000Z'),
      stellarAddress: ADDRESS,
      customer: {
        phone: '3001234567',
        fullName: 'Ana Maria Lopez',
        documentNumber: '1032456789',
      },
      incomingPaymentUrl: 'https://ilp.example.test/incoming/1',
      quoteId: 'quote-1',
    },
    { now: () => createdAt },
  )
  return status === undefined ? cashIn : { ...cashIn, status }
}

async function appWith(balance: Money) {
  const network = new FakeUsdcNetwork()
  await network.ensureOperatorReady()
  network.setOperatorUsdc(balance)
  const clock = new ManualClock(START)
  const cashIns = createMemoryCashInRepository()
  const operator = createOperatorService({
    cashIns,
    usdcNetwork: network,
    clock,
    mutex: new Mutex(),
    usdcFloat: '10.00',
    lowThresholdPct: 30,
  })
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  installErrorHandler(app, 'http://localhost:5173')
  registerOperatorRoutes(app, { operator })
  return { app, cashIns, network }
}

describe('operator routes', () => {
  it('lists cash-ins on the contract and hides customer data', async () => {
    const { app, cashIns } = await appWith(money(2_000_000n, 'USDC', 7))
    try {
      await cashIns.insert(
        quoted('older', new Date(START.getTime() - 1000), money(100n, 'USDC', 2)),
      )
      await cashIns.insert(quoted('newer', START, money(250n, 'USDC', 2), 'completed'))

      const response = await app.inject({ method: 'GET', url: '/api/operator/cash-ins' })
      expect(response.statusCode).toBe(200)
      const body: unknown = response.json()
      expect(CashInSchema.array().parse(body)).toEqual(body)
      expect(Array.isArray(body) && body[0]).toMatchObject({ id: 'newer', status: 'completed' })
      const text = response.body
      expect(text).not.toContain('1032456789')
      expect(text).not.toContain('Ana Maria')
      expect(text).not.toContain('3001234567')
      expect(text).not.toContain('stellarEnvelopeXdr')
    } finally {
      await app.close()
    }
  })

  it('returns inventory with reserved USDC removed and a completed cash-in not reserved twice', async () => {
    const { app, cashIns } = await appWith(money(12_345_678n, 'USDC', 7))
    try {
      await cashIns.insert(
        quoted('done', new Date(START.getTime() - 1000), money(500n, 'USDC', 2), 'completed'),
      )
      await cashIns.insert(quoted('held', START, money(1n, 'USDC', 2), 'settling'))

      const response = await app.inject({ method: 'GET', url: '/api/operator/inventory' })
      expect(response.statusCode).toBe(200)
      expect(Inventory.parse(response.json())).toEqual({
        usdc: '1.22',
        floatUsdc: '10.00',
        lowThresholdPct: 30,
      })
      expect(response.body).not.toContain('rawAvailable')
      expect(response.body).not.toContain('1032456789')
    } finally {
      await app.close()
    }
  })

  it('refills to the float and reports the contract result', async () => {
    const { app, network } = await appWith(money(100_000n, 'USDC', 7))
    try {
      const response = await app.inject({ method: 'POST', url: '/api/operator/inventory/refill' })
      expect(response.statusCode).toBe(200)
      expect(RefillResult.parse(response.json())).toEqual({ usdc: '10.00' })
      expect(await network.balance()).toEqual(money(100_000_000n, 'USDC', 7))
    } finally {
      await app.close()
    }
  })

  it('maps a down network to backend_down without a stack', async () => {
    const { app, network } = await appWith(money(100_000n, 'USDC', 7))
    try {
      network.removeOperator()
      const response = await app.inject({ method: 'GET', url: '/api/operator/inventory' })
      expect(response.statusCode).toBe(503)
      const body: unknown = response.json()
      expect(ApiError.parse(body)).toMatchObject({ error: 'backend_down' })
      expect(response.body).not.toContain('secret')
      expect(response.body).not.toContain('at ')
    } finally {
      await app.close()
    }
  })
})
