import { expect, test } from 'vitest'
import { fits, formatCop, formatUsdc, grouped, remaining, total, usdcCents, type Bill } from './cash'

const RATE = 4120

test('sums bills and converts to USDC cents rounding down', () => {
  const bills: Bill[] = [50000, 50000, 2000]
  expect(total(bills)).toBe(102000)
  expect(usdcCents(102000, RATE)).toBe(2475)
  expect(formatUsdc(2475)).toBe('24.75')
  expect(formatCop(102000)).toBe('$102.000')
})

test('blocks a bill that would exceed 100 USDC per transaction', () => {
  const fourHundred: Bill[] = [100000, 100000, 100000, 100000]
  expect(fits(fourHundred, 10000, RATE)).toBe(true) // 410.000 COP = 99.51 USDC
  expect(fits(fourHundred, 20000, RATE)).toBe(false) // 420.000 COP = 101.94 USDC
  expect(fits([...fourHundred, 10000], 2000, RATE)).toBe(true) // 412.000 COP = 100.00 USDC
})

test('tracks wallet stock and groups inserted bills', () => {
  const bills: Bill[] = [100000, 2000, 100000]
  expect(remaining(bills, 100000)).toBe(0)
  expect(grouped(bills)).toEqual([
    { bill: 2000, count: 1 },
    { bill: 100000, count: 2 },
  ])
})
