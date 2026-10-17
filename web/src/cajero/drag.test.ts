import { expect, test } from 'vitest'
import { dropOutcome, inside, tilt } from './drag'

const rect = { left: 0, top: 0, right: 100, bottom: 50 }

test('tilt follows horizontal speed and is clamped', () => {
  expect(tilt(0)).toBe(0)
  expect(tilt(0.5)).toBe(9)
  expect(tilt(5)).toBe(14)
  expect(tilt(-5)).toBe(-14)
})

test('inside includes edges', () => {
  expect(inside({ x: 0, y: 0 }, rect)).toBe(true)
  expect(inside({ x: 100, y: 50 }, rect)).toBe(true)
  expect(inside({ x: 101, y: 10 }, rect)).toBe(false)
})

test('dropOutcome inserts, rejects or returns the bill', () => {
  expect(dropOutcome({ x: 10, y: 10 }, rect, true)).toBe('insert')
  expect(dropOutcome({ x: 10, y: 10 }, rect, false)).toBe('reject')
  expect(dropOutcome({ x: 200, y: 10 }, rect, true)).toBe('return')
  expect(dropOutcome({ x: 10, y: 10 }, null, true)).toBe('return')
})
