import { describe, expect, it } from 'vitest'
import { CashIn, CashInStatus, Grant, Inventory, Rate } from '@walle/contracts'

/** G + 55 StrKey alphabet characters. Checksum is not required by the mock. */
const STELLAR_ADDRESS = `G${'A'.repeat(55)}`

const REQUEST = {
  copAmount: '100000',
  stellarAddress: STELLAR_ADDRESS,
  customer: { phone: '3001234567', fullName: 'Ana Ruiz', documentNumber: '1234567890' },
}

/**
 * Static import of `web/src/api/mock.ts` fails `tsc` under server/tsconfig.json
 * (extensionless relative imports, and `erasableSyntaxOnly` on `ApiError`).
 * A non-literal dynamic import still loads the module in Vitest.
 */
const MOCK_SPECIFIER = '../../../web/src/api/mock.ts'

type Failure = 'stellar' | 'pago' | 'grant' | 'limite' | 'inventario'

interface MockOptions {
  now?: () => number
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
  failure?: () => Failure | null
  latencyMs?: [number, number]
}

interface MockApi {
  rate: () => Promise<unknown>
  createCashIn: (req: unknown) => Promise<unknown>
  confirmCashIn: (id: string) => Promise<unknown>
  getCashIn: (id: string) => Promise<unknown>
  grant: () => Promise<unknown>
  approveGrant: () => Promise<unknown>
  operatorCashIns: () => Promise<unknown[]>
  inventory: () => Promise<unknown>
}

interface MockModule {
  createMockApi: (opts?: MockOptions) => MockApi
}

function installStorageShim(): void {
  if ('localStorage' in globalThis) return
  const data = new Map<string, string>()
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
    removeItem: (key: string) => {
      data.delete(key)
    },
    clear: () => {
      data.clear()
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size
    },
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage })
}

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const data = new Map<string, string>()
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
  }
}

/** The mock keeps missing optionals as `undefined`; JSON drops those keys, matching exactOptional. */
function asJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown
}

function isMockModule(value: unknown): value is MockModule {
  if (typeof value !== 'object' || value === null || !('createMockApi' in value)) return false
  return typeof value.createMockApi === 'function'
}

async function loadMockModule(): Promise<MockModule> {
  const moduleUrl = new URL(MOCK_SPECIFIER, import.meta.url).href
  const loaded: unknown = await (import(moduleUrl) as Promise<unknown>)
  if (!isMockModule(loaded)) throw new Error('web mock did not export createMockApi')
  return loaded
}

async function apiWith(failure: Failure | null): Promise<{
  api: MockApi
  at: (ms: number) => void
}> {
  const mod = await loadMockModule()
  let now = 1_700_000_000_000
  const api = mod.createMockApi({
    now: () => now,
    storage: memoryStorage(),
    failure: () => failure,
    latencyMs: [0, 0],
  })
  return {
    api,
    at: (ms) => {
      now = ms
    },
  }
}

describe('cashier mock responses match the contract schemas', () => {
  it('parses the happy flow, including every cash-in status', async () => {
    installStorageShim()
    const started = 1_700_000_000_000
    const happy = await apiWith(null)

    expect(Grant.parse(asJson(await happy.api.grant()))).toEqual({ status: 'missing' })
    await happy.api.approveGrant()

    expect(Rate.parse(asJson(await happy.api.rate())).spreadPct).toBe(3)

    const created = CashIn.parse(asJson(await happy.api.createCashIn(REQUEST)))
    expect(created.status).toBe('quoted')
    expect(CashIn.parse(asJson(await happy.api.getCashIn(created.id))).status).toBe('quoted')

    const confirmed = CashIn.parse(asJson(await happy.api.confirmCashIn(created.id)))
    expect(confirmed.status).toBe('settling')

    happy.at(started + 1_500)
    expect(CashIn.parse(asJson(await happy.api.getCashIn(created.id))).status).toBe('settled')

    happy.at(started + 2_500)
    expect(CashIn.parse(asJson(await happy.api.getCashIn(created.id))).status).toBe('sending_usdc')

    happy.at(started + 4_000)
    const completed = CashIn.parse(asJson(await happy.api.getCashIn(created.id)))
    expect(completed.status).toBe('completed')
    expect(completed.stellarTxHash).toEqual(expect.any(String))

    const grant = Grant.parse(asJson(await happy.api.grant()))
    expect(grant.status).toBe('active')

    const listed = await happy.api.operatorCashIns()
    expect(listed.map((item) => CashIn.parse(asJson(item)).id)).toContain(created.id)

    expect(Inventory.parse(asJson(await happy.api.inventory())).lowThresholdPct).toBe(30)

    const expiredApi = await apiWith(null)
    await expiredApi.api.approveGrant()
    const expiring = CashIn.parse(asJson(await expiredApi.api.createCashIn(REQUEST)))
    expiredApi.at(started + 60_001)
    expect(CashIn.parse(asJson(await expiredApi.api.getCashIn(expiring.id))).status).toBe('expired')

    const payment = await apiWith('pago')
    await payment.api.approveGrant()
    const paying = CashIn.parse(asJson(await payment.api.createCashIn(REQUEST)))
    await payment.api.confirmCashIn(paying.id)
    payment.at(started + 1_500)
    expect(CashIn.parse(asJson(await payment.api.getCashIn(paying.id))).status).toBe(
      'failed_payment',
    )

    const stellar = await apiWith('stellar')
    await stellar.api.approveGrant()
    const sending = CashIn.parse(asJson(await stellar.api.createCashIn(REQUEST)))
    await stellar.api.confirmCashIn(sending.id)
    stellar.at(started + 4_000)
    expect(CashIn.parse(asJson(await stellar.api.getCashIn(sending.id))).status).toBe(
      'failed_stellar',
    )

    expect(CashInStatus.options).toHaveLength(8)
  })
})
