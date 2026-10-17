import { describe, expect, it } from 'vitest'

import { formatDecimal, parseDecimal } from '../shared/money.ts'
import type { Clock } from '../shared/ports.ts'
import { ConfiguredRateProvider } from './rate-provider.ts'

describe('ConfiguredRateProvider', () => {
  it('quotes COP per USDC with the configured spread and the injected clock', async () => {
    const clock: Clock = { now: () => new Date('2026-10-17T03:04:05.000Z') }
    const provider = new ConfiguredRateProvider(
      { referenceCopPerUsd: '3177', spreadPct: '3' },
      clock,
    )
    const rate = await provider.current()

    expect(formatDecimal(rate.copPerUsdc)).toBe('3272.31')
    expect(rate.copPerUsdc.amount).toBeGreaterThan(parseDecimal('3177', 'COP', 2).amount)
    expect(rate.spreadPct).toBe('3')
    expect(rate.quotedAt.toISOString()).toBe('2026-10-17T03:04:05.000Z')
  })
})
