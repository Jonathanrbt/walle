import { describe, expect, it } from 'vitest'

import { createQuoted, type CashIn } from '../../cash-in/domain/cash-in.ts'
import type { CashInRepository } from '../../cash-in/repository.ts'
import { money, type Money } from '../../shared/money.ts'
import { Mutex } from '../../shared/mutex.ts'
import { FakeUsdcNetwork } from '../../../test/fakes/fake-usdc-network.ts'
import { ManualClock } from '../../../test/fakes/fake-grant-gateway.ts'
import { createMemoryCashInRepository } from '../../../test/fakes/memory-cash-in-repository.ts'
import { StellarError, type RefillResult, type UsdcNetwork } from '../usdc-network.ts'
import { OperatorError } from './errors.ts'
import { createOperatorService } from './operator-service.ts'

const START = new Date('2026-10-17T12:00:00.000Z')
const ADDRESS = `G${'A'.repeat(55)}`

function quoted(id: string, createdAt: Date, usdc: Money, status?: CashIn['status']): CashIn {
  const cashIn = createQuoted(
    {
      id,
      cop: money(10_000n, 'COP', 2),
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

class ScriptedUsdcNetwork extends FakeUsdcNetwork {
  refills = 0
  hold: Promise<void> = Promise.resolve()
  refillFault: StellarError | undefined

  override refill(input: { targetUsdc: Money }): Promise<RefillResult> {
    this.refills += 1
    const fault = this.refillFault
    if (fault !== undefined) return Promise.reject(fault)
    return this.hold.then(() => super.refill(input))
  }
}

async function readyNetwork(balance: Money): Promise<FakeUsdcNetwork> {
  return fund(new FakeUsdcNetwork(), balance)
}

async function fund<T extends FakeUsdcNetwork>(network: T, balance: Money): Promise<T> {
  await network.ensureOperatorReady()
  network.setOperatorUsdc(balance)
  return network
}

function serviceFor(
  network: UsdcNetwork,
  options?: { readonly usdcFloat?: string; readonly lowThresholdPct?: number },
) {
  const clock = new ManualClock(START)
  const repo = createMemoryCashInRepository()
  const service = createOperatorService({
    cashIns: repo,
    usdcNetwork: network,
    clock,
    mutex: new Mutex(),
    usdcFloat: options?.usdcFloat ?? '10.00',
    lowThresholdPct: options?.lowThresholdPct ?? 30,
  })
  return { clock, repo, service }
}

describe('createOperatorService', () => {
  it('lists newest cash-ins first and defaults the limit to 50', async () => {
    const network = await readyNetwork(money(10_000_000n, 'USDC', 7))
    const { repo, service } = serviceFor(network)
    for (let index = 0; index < 51; index += 1) {
      const createdAt = new Date(START.getTime() + index * 1000)
      await repo.insert(
        quoted(`id-${String(index).padStart(2, '0')}`, createdAt, money(1n, 'USDC', 2)),
      )
    }

    const listed = await service.listCashIns()
    expect(listed).toHaveLength(50)
    expect(listed[0]?.id).toBe('id-50')
    expect(listed[49]?.id).toBe('id-01')
    expect(listed.map((row) => row.createdAt.getTime())).toEqual(
      [...listed]
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
        .map((row) => row.createdAt.getTime()),
    )

    const two = await service.listCashIns(2)
    expect(two.map((row) => row.id)).toEqual(['id-50', 'id-49'])
  })

  it('floors scale-7 balance minus scale-2 reservations and clamps at zero', async () => {
    const network = await readyNetwork(money(12_345_678n, 'USDC', 7))
    const { repo, service } = serviceFor(network, { usdcFloat: '1000', lowThresholdPct: 30 })
    await repo.insert(quoted('reserved', START, money(1n, 'USDC', 2), 'settling'))

    const inventory = await service.inventory()
    expect(inventory.usdc).toEqual(money(122n, 'USDC', 2))
    expect(inventory.floatUsdc).toEqual(money(100_000n, 'USDC', 2))
    expect(inventory.lowThresholdPct).toBe(30)
    expect(inventory.log.rawAvailable).toBe(122n)

    network.setOperatorUsdc(money(1n, 'USDC', 7))
    const clamped = await service.inventory()
    expect(clamped.usdc).toEqual(money(0n, 'USDC', 2))
    expect(clamped.log.rawAvailable).toBe(-1n)
  })

  it('does not reserve a completed cash-in', async () => {
    const network = await readyNetwork(money(50_000_000n, 'USDC', 7))
    const { repo, service } = serviceFor(network)
    await repo.insert(quoted('done', START, money(200n, 'USDC', 2), 'completed'))

    const inventory = await service.inventory()
    expect(inventory.usdc).toEqual(money(500n, 'USDC', 2))
    expect(inventory.log.rawAvailable).toBe(500n)
  })

  it('returns the current available figure without sending when it already covers the float', async () => {
    const network = await fund(new ScriptedUsdcNetwork(), money(150_000_000n, 'USDC', 7))
    const { service } = serviceFor(network, { usdcFloat: '10.00' })

    const result = await service.refill()
    expect(result.usdc).toEqual(money(1_500n, 'USDC', 2))
    expect(network.refills).toBe(0)
    expect(await network.balance()).toEqual(money(150_000_000n, 'USDC', 7))
  })

  it('refills up to the float and reports available USDC at scale 2', async () => {
    const network = await fund(new ScriptedUsdcNetwork(), money(10_000_000n, 'USDC', 7))
    const { service } = serviceFor(network, { usdcFloat: '10.00' })

    const result = await service.refill()
    expect(network.refills).toBe(1)
    expect(result.usdc).toEqual(money(1_000n, 'USDC', 2))
    expect(await network.balance()).toEqual(money(100_000_000n, 'USDC', 7))
  })

  it('sends one refill when two calls overlap', async () => {
    const network = await fund(new ScriptedUsdcNetwork(), money(10_000_000n, 'USDC', 7))
    let release: (() => void) | undefined
    network.hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const { service } = serviceFor(network, { usdcFloat: '10.00' })

    const pending = Promise.all([service.refill(), service.refill()])
    await expect.poll(() => network.refills).toBe(1)
    if (release === undefined) throw new Error('gate missing')
    release()
    const [left, right] = await pending
    expect(network.refills).toBe(1)
    expect(left.usdc).toEqual(money(1_000n, 'USDC', 2))
    expect(right.usdc).toEqual(money(1_000n, 'USDC', 2))
  })

  it('returns the reserved figure when the chain is already at the float', async () => {
    const network = await fund(new ScriptedUsdcNetwork(), money(100_000_000n, 'USDC', 7))
    const { repo, service } = serviceFor(network, { usdcFloat: '10.00' })
    await repo.insert(quoted('held', START, money(400n, 'USDC', 2), 'sending_usdc'))

    const result = await service.refill()
    expect(network.refills).toBe(1)
    expect(result.usdc).toEqual(money(600n, 'USDC', 2))
    expect(await network.balance()).toEqual(money(100_000_000n, 'USDC', 7))
  })

  it('maps stellar failures to backend_down', async () => {
    const down = new FakeUsdcNetwork()
    down.removeOperator()
    const missing = serviceFor(down).service
    await expect(missing.inventory()).rejects.toEqual(
      expect.objectContaining({ name: 'OperatorError', code: 'backend_down' }),
    )

    const starved = await readyNetwork(money(100_000n, 'USDC', 7))
    starved.setOperatorXlm(money(1n, 'XLM', 7))
    const noPath = serviceFor(starved, { usdcFloat: '10.00' }).service
    await expect(noPath.refill()).rejects.toMatchObject({
      code: 'backend_down',
      detail: 'no XLM to USDC path can fund the target',
    })

    const network = await fund(new ScriptedUsdcNetwork(), money(100_000n, 'USDC', 7))
    network.refillFault = new StellarError('unavailable', 'horizon did not confirm the USDC refill')
    const offline = serviceFor(network, { usdcFloat: '10.00' }).service
    await expect(offline.refill()).rejects.toMatchObject({
      code: 'backend_down',
      detail: 'horizon did not confirm the USDC refill',
    })

    const bare = await fund(new ScriptedUsdcNetwork(), money(0n, 'USDC', 7))
    bare.refillFault = new StellarError('operator_not_ready', 'operator has no USDC trustline')
    const notReady = serviceFor(bare, { usdcFloat: '10.00' }).service
    await expect(notReady.refill()).rejects.toBeInstanceOf(OperatorError)
    await expect(notReady.refill()).rejects.toMatchObject({
      code: 'backend_down',
      detail: 'operator has no USDC trustline',
    })

    const invalid = await fund(new ScriptedUsdcNetwork(), money(0n, 'USDC', 7))
    invalid.refillFault = new StellarError('invalid', 'amount asset must be USDC')
    await expect(
      serviceFor(invalid, { usdcFloat: '10.00' }).service.refill(),
    ).rejects.toMatchObject({
      code: 'backend_down',
      detail: 'amount asset must be USDC',
    })
  })

  it('hides non-stellar network failures and rejects a balance that is not scale 7', async () => {
    class SecretBalance extends FakeUsdcNetwork {
      override balance(): Promise<Money> {
        return Promise.reject(new Error('secret SABC'))
      }
    }
    const hidden = serviceFor(new SecretBalance()).service
    await expect(hidden.inventory()).rejects.toMatchObject({
      code: 'backend_down',
      detail: undefined,
    })
    await expect(hidden.inventory()).rejects.not.toThrow(/secret/)

    class Cents extends FakeUsdcNetwork {
      override balance(): Promise<Money> {
        return Promise.resolve(money(100n, 'USDC', 2))
      }
    }
    await expect(serviceFor(new Cents()).service.inventory()).rejects.toMatchObject({
      code: 'backend_down',
      detail: 'USDC balance is not scale 7',
    })

    const network = await readyNetwork(money(10_000_000n, 'USDC', 7))
    const base = createMemoryCashInRepository()
    const cashIns: CashInRepository = {
      ...base,
      reservedUsdc: () => Promise.resolve(money(1n, 'USDC', 7)),
    }
    const service = createOperatorService({
      cashIns,
      usdcNetwork: network,
      clock: new ManualClock(START),
      mutex: new Mutex(),
      usdcFloat: '10.00',
      lowThresholdPct: 30,
    })
    await expect(service.inventory()).rejects.toMatchObject({
      code: 'backend_down',
      detail: 'reserved USDC is not scale 2',
    })
  })
})
