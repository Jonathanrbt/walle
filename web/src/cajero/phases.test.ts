import { expect, test } from 'vitest'
import type { CashIn, CashInStatus } from '../api/types'
import { phases } from './phases'

const cashIn = (status: CashInStatus, incomingCompleted = false): CashIn => ({
  id: 'x',
  status,
  copAmount: '100000',
  usdcAmount: '24.27',
  copPerUsdc: '4120',
  expiresAt: '',
  stellarAddress: 'G',
  memo: 'm',
  openPayments: { incomingPaymentUrl: 'i', quoteId: 'q', incomingCompleted },
  createdAt: '',
})

const states = (c: CashIn) => phases(c).map((p) => p.state)

test('phase states follow the cash-in status', () => {
  expect(states(cashIn('quoted'))).toEqual(['done', 'active', 'pending', 'pending', 'pending'])
  expect(states(cashIn('settling'))).toEqual(['done', 'done', 'active', 'pending', 'pending'])
  expect(states(cashIn('settled', true))).toEqual(['done', 'done', 'done', 'done', 'active'])
  expect(states(cashIn('sending_usdc', true))).toEqual(['done', 'done', 'done', 'done', 'active'])
  expect(states(cashIn('completed', true))).toEqual(['done', 'done', 'done', 'done', 'done'])
})

test('failures mark the phase that broke', () => {
  expect(states(cashIn('failed_payment'))).toEqual(['done', 'done', 'error', 'pending', 'pending'])
  expect(states(cashIn('failed_stellar', true))).toEqual(['done', 'done', 'done', 'done', 'error'])
  expect(states(cashIn('expired'))).toEqual(['done', 'error', 'pending', 'pending', 'pending'])
})
