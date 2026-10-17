import { CashIn as CashInSchema } from '@walle/contracts'
import { describe, expect, it } from 'vitest'

import { createQuoted } from '../../cash-in/domain/cash-in.ts'
import { money } from '../../shared/money.ts'
import { toCashInDto } from './cash-in-dto.ts'

const NOW = new Date('2026-10-17T15:00:00.000Z')

function quoted() {
  return createQuoted(
    {
      id: '0b8f6f0e-4d6a-4c1e-9a3c-2f6f7b0a1c11',
      cop: money(10_000_000n, 'COP', 2),
      usdc: money(3056n, 'USDC', 2),
      copPerUsdc: money(327_231n, 'COP', 2),
      expiresAt: new Date('2026-10-17T15:01:00.000Z'),
      stellarAddress: `G${'A'.repeat(55)}`,
      customer: { phone: '3001234567', fullName: 'Ana Maria Lopez', documentNumber: '1032456789' },
      incomingPaymentUrl: 'https://ilp.example.test/incoming/1',
      quoteId: 'quote-1',
    },
    { now: () => NOW },
  )
}

describe('toCashInDto', () => {
  it('produces a contract-valid payload with decimal strings and ISO dates', () => {
    const dto = toCashInDto(quoted())
    expect(CashInSchema.parse(dto)).toEqual(dto)
    expect(dto.copAmount).toBe('100000.00')
    expect(dto.usdcAmount).toBe('30.56')
    expect(dto.copPerUsdc).toBe('3272.31')
    expect(dto.expiresAt).toBe('2026-10-17T15:01:00.000Z')
    expect(dto.status).toBe('quoted')
  })

  it('omits optional fields until they exist and never exposes internal fields', () => {
    const dto = toCashInDto(quoted())
    expect(dto).not.toHaveProperty('stellarTxHash')
    expect(dto.openPayments).not.toHaveProperty('outgoingPaymentId')
    expect(JSON.stringify(dto)).not.toContain('1032456789')
    expect(JSON.stringify(dto)).not.toContain('Ana Maria')
  })

  it('includes the transaction hash and outgoing payment id when present', () => {
    const base = quoted()
    const dto = toCashInDto({
      ...base,
      status: 'completed',
      stellarTxHash: 'a'.repeat(64),
      openPayments: { ...base.openPayments, outgoingPaymentId: 'out-1', incomingCompleted: true },
    })
    expect(CashInSchema.parse(dto)).toEqual(dto)
    expect(dto.stellarTxHash).toBe('a'.repeat(64))
    expect(dto.openPayments.outgoingPaymentId).toBe('out-1')
  })
})
