import { beforeEach, expect, test } from 'vitest'
import { createMockApi, TIMELINE, type Failure } from './mock'
import { ApiError, type CashInRequest } from './types'

const ADDRESS = 'G' + 'A'.repeat(55)
const req = (copAmount: string, documentNumber = '1001'): CashInRequest => ({
  copAmount,
  stellarAddress: ADDRESS,
  customer: { phone: '3000000000', fullName: 'Ana Pérez', documentNumber },
})

let t = 0
let failure: Failure | null = null
let api: ReturnType<typeof createMockApi>

beforeEach(async () => {
  t = Date.UTC(2026, 9, 17, 15)
  failure = null
  api = createMockApi({ now: () => t, storage: null, failure: () => failure, latencyMs: [0, 0] })
  await api.approveGrant()
})

const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: ApiError) => e.code)

test('cash-in walks quoted → settling → settled → sending_usdc → completed', async () => {
  const quoted = await api.createCashIn(req('100000'))
  expect(quoted).toMatchObject({ status: 'quoted', copAmount: '100000', usdcAmount: '24.27', copPerUsdc: '4120' })

  expect((await api.confirmCashIn(quoted.id)).status).toBe('settling')
  const confirmedAt = t
  const seen = []
  for (const at of [TIMELINE.settled, TIMELINE.sendingUsdc, TIMELINE.completed]) {
    t = confirmedAt + at
    seen.push(await api.getCashIn(quoted.id))
  }
  expect(seen.map((c) => c.status)).toEqual(['settled', 'sending_usdc', 'completed'])
  expect(seen[0].openPayments.incomingCompleted).toBe(true)
  expect(seen[2].stellarTxHash).toMatch(/^[0-9a-f]{64}$/)

  expect((await api.inventory()).usdc).toBe('975.73')
  expect((await api.grant()).spentCop).toBe('100000')
  expect(await api.operatorCashIns()).toHaveLength(1)
})

test('stellar failure ends in failed_stellar and retry completes it', async () => {
  failure = 'stellar'
  const c = await api.createCashIn(req('50000'))
  await api.confirmCashIn(c.id)
  t += TIMELINE.completed
  const failed = await api.getCashIn(c.id)
  expect(failed.status).toBe('failed_stellar')
  expect(failed.openPayments.incomingCompleted).toBe(true)

  expect((await api.retryCashIn(c.id)).status).toBe('sending_usdc')
  t += TIMELINE.retry
  expect((await api.getCashIn(c.id)).status).toBe('completed')
})

test('quote expires after its TTL and cannot be confirmed', async () => {
  const c = await api.createCashIn(req('20000'))
  t += 61_000
  expect((await api.getCashIn(c.id)).status).toBe('expired')
  expect(await code(api.confirmCashIn(c.id))).toBe('quote_expired')
})

test('tier 1 limits: 100 USDC per tx and 150 USDC per day per document', async () => {
  expect(await code(api.createCashIn(req('420000')))).toBe('limit_exceeded')
  const first = await api.createCashIn(req('400000'))
  await api.confirmCashIn(first.id)
  expect(await code(api.createCashIn(req('300000')))).toBe('limit_exceeded')
  expect(await code(api.createCashIn(req('300000', '2002')))).toBe('ok')
})

test('grant gates cash-ins: missing, forced off, and daily limit', async () => {
  const fresh = createMockApi({ now: () => t, storage: null, failure: () => null, latencyMs: [0, 0] })
  expect((await fresh.grant()).status).toBe('missing')
  expect(await code(fresh.createCashIn(req('10000')))).toBe('no_grant')

  failure = 'grant'
  expect(await code(api.createCashIn(req('10000')))).toBe('no_grant')
  failure = null

  for (let i = 0; i < 5; i++) await api.confirmCashIn((await api.createCashIn(req('400000', `d${i}`))).id)
  expect(await code(api.createCashIn(req('10000', 'd9')))).toBe('grant_exhausted')

  t += 24 * 60 * 60_000
  expect((await api.grant()).status).toBe('expired')
})

test('rejects malformed Stellar addresses', async () => {
  expect(await code(api.createCashIn({ ...req('10000'), stellarAddress: 'GABC' }))).toBe('invalid_address')
})

test('refill tops inventory back up to the float', async () => {
  const c = await api.createCashIn(req('400000'))
  await api.confirmCashIn(c.id)
  t += TIMELINE.completed
  expect((await api.inventory()).usdc).toBe('902.92')
  await api.refill()
  expect((await api.inventory()).usdc).toBe('1000.00')
})
