import { expect, test } from 'vitest'
import { shortAddress, validDocument, validName, validPhone, validStellarAddress } from './validate'

test('validates customer data for tier 1', () => {
  expect(validPhone('3001234567')).toBe(true)
  expect(validPhone('6011234567')).toBe(false)
  expect(validPhone('300123456')).toBe(false)
  expect(validName('Ana Pérez')).toBe(true)
  expect(validName('Ana')).toBe(false)
  expect(validDocument('1036123456')).toBe(true)
  expect(validDocument('12345')).toBe(false)
})

test('validates Stellar addresses', () => {
  const g = 'G' + 'A'.repeat(54) + '7'
  expect(validStellarAddress(g)).toBe(true)
  expect(validStellarAddress(` ${g} `)).toBe(true)
  expect(validStellarAddress('S' + 'A'.repeat(55))).toBe(false)
  expect(validStellarAddress(g.toLowerCase())).toBe(false)
  expect(shortAddress(g)).toBe('GAAAAA…AAAAA7')
})
