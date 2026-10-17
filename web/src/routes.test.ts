import { expect, test } from 'vitest'
import { viewFor } from './routes'

test('maps pathnames to views', () => {
  expect(viewFor('/')).toBe('cajero')
  expect(viewFor('/tienda')).toBe('tienda')
  expect(viewFor('/tienda/')).toBe('tienda')
  expect(viewFor('/operador')).toBe('operador')
  expect(viewFor('/nada')).toBe('cajero')
})
