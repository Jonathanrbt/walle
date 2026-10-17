import { describe, expect, it } from 'vitest'

import {
  derivePhases,
  formatInventory,
  formatQuote,
  formatStatusLine,
  missingGrantMessage,
  parseArgs,
  retryHint,
  syntheticCustomer,
  terminalExit,
  usdcDelta,
} from '../scripts/e2e-helpers.mjs'

const ADDRESS = `G${'A'.repeat(55)}`

const quoted = {
  status: 'quoted',
  openPayments: {
    incomingPaymentUrl: 'https://payments.example/incoming/1',
    quoteId: 'quote-1',
    incomingCompleted: false,
  },
}

describe('parseArgs', () => {
  it('defaults cop and base', () => {
    expect(parseArgs(['--address', ADDRESS])).toEqual({
      address: ADDRESS,
      copAmount: '100000',
      base: 'http://localhost:3000',
    })
  })

  it('accepts cop and strips a trailing slash from base', () => {
    expect(
      parseArgs(['--cop', '100000.50', '--base', 'http://127.0.0.1:4010/', '--address', ADDRESS]),
    ).toEqual({
      address: ADDRESS,
      copAmount: '100000.50',
      base: 'http://127.0.0.1:4010',
    })
  })

  it('rejects a missing address, a bad account and a non-positive amount', () => {
    expect(() => parseArgs([])).toThrow(/--address/)
    expect(() => parseArgs(['--address', 'not-a-key'])).toThrow(/Stellar/)
    expect(() => parseArgs(['--address', ADDRESS, '--cop', '0'])).toThrow(/--cop/)
    expect(() => parseArgs(['--address', ADDRESS, '--base', 'ftp://files'])).toThrow(/--base/)
  })
})

describe('syntheticCustomer', () => {
  it('builds a unique document and phone from the timestamp', () => {
    const customer = syntheticCustomer(1_760_700_000_123)
    expect(customer).toEqual({
      phone: '3700000123',
      fullName: 'Prueba Testnet',
      documentNumber: '0700000123',
    })
    expect(syntheticCustomer(1_760_700_000_124).documentNumber).not.toBe(customer.documentNumber)
  })
})

describe('derivePhases', () => {
  it('keeps authorization pending until an outgoing payment exists', () => {
    expect(derivePhases(quoted)).toEqual({
      solicitud: 'hecha',
      autorizacion: 'pendiente',
      ejecucion: 'pendiente',
      finalizacion: 'pendiente',
      stellar: 'pendiente',
    })
    expect(
      derivePhases({
        status: 'settling',
        openPayments: { ...quoted.openPayments, outgoingPaymentId: 'out-1' },
      }),
    ).toMatchObject({ autorizacion: 'hecha', ejecucion: 'en curso', finalizacion: 'pendiente' })
  })

  it('marks Open Payments finished once settled and tracks the Stellar step', () => {
    const openPayments = {
      ...quoted.openPayments,
      outgoingPaymentId: 'out-1',
      incomingCompleted: true,
    }
    expect(derivePhases({ status: 'settled', openPayments }).finalizacion).toBe('hecha')
    expect(derivePhases({ status: 'sending_usdc', openPayments }).stellar).toBe('enviando')
    expect(derivePhases({ status: 'completed', openPayments }).stellar).toBe('hecha')
    expect(derivePhases({ status: 'failed_stellar', openPayments }).stellar).toBe('fallida')
    expect(derivePhases({ status: 'failed_payment', openPayments }).ejecucion).toBe('fallida')
    expect(derivePhases({ status: 'expired', openPayments: quoted.openPayments }).ejecucion).toBe(
      'pendiente',
    )
  })
})

describe('formatting', () => {
  it('prints the quote, a status line, inventory and the USDC delta', () => {
    const cashIn = {
      ...quoted,
      copAmount: '100000',
      usdcAmount: '30.55',
      copPerUsdc: '3272.31',
      expiresAt: '2026-10-17T12:01:00.000Z',
    }
    expect(formatQuote(cashIn)).toBe(
      'Cotización: 100000 COP → 30.55 USDC a 3272.31 COP/USDC, vence 2026-10-17T12:01:00.000Z',
    )
    expect(formatStatusLine(cashIn, 1200)).toContain('+1200ms quoted')
    expect(formatStatusLine(cashIn, 1200)).toContain('solicitud=hecha')
    expect(
      formatInventory('Inventario antes', {
        usdc: '100.00',
        floatUsdc: '1000.00',
        lowThresholdPct: 30,
      }),
    ).toBe('Inventario antes: 100.00 USDC (flotante 1000.00, umbral 30%)')
    expect(usdcDelta('100.00', '69.45')).toBe('-30.55')
    expect(usdcDelta('10.00', '10.00')).toBe('0.00')
  })

  it('names the grant URL and the stellar retry', () => {
    expect(missingGrantMessage('http://localhost:3000')).toBe(
      'Falta el grant diario. Apruébalo en http://localhost:3000/api/grant/start',
    )
    expect(retryHint('http://localhost:3000', 'cash-1')).toBe(
      'El envío Stellar falló. Reintenta con: POST http://localhost:3000/api/cash-ins/cash-1/retry',
    )
  })

  it('maps terminal statuses to process codes', () => {
    expect(terminalExit('completed')).toBe(0)
    expect(terminalExit('failed_stellar')).toBe(3)
    expect(terminalExit('failed_payment')).toBe(4)
    expect(terminalExit('expired')).toBe(4)
    expect(terminalExit('settling')).toBeUndefined()
  })
})
