import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CashInStatus, FrontApiErrorCode } from '@walle/contracts'

const webTypesUrl = new URL('../../../web/src/api/types.ts', import.meta.url)
const contractUrl = new URL('../../scripts/contract/web-types-contract.ts', import.meta.url)
const contractTsconfig = new URL('../../scripts/contract/tsconfig.json', import.meta.url)
const tscBin = new URL('../../../node_modules/typescript/bin/tsc', import.meta.url)

describe('web client types match @walle/contracts', () => {
  it('typechecks the cashier types against z.infer of the contract schemas', () => {
    const source = readFileSync(contractUrl, 'utf8')
    expect(source).toContain("from '../../../web/src/api/types.ts'")
    expect(source).toContain('import type {')
    execFileSync(
      process.execPath,
      [tscBin.pathname, '--noEmit', '--pretty', 'false', '-p', contractTsconfig.pathname],
      {
        stdio: 'pipe',
        encoding: 'utf8',
      },
    )
  })

  it('lists the same statuses and front error codes as the contract enums', () => {
    const text = readFileSync(webTypesUrl, 'utf8')
    expect(unionLiterals(text, 'CashInStatus')).toEqual([...CashInStatus.options])
    expect(unionLiterals(text, 'ApiErrorCode')).toEqual([...FrontApiErrorCode.options])
  })
})

function unionLiterals(source: string, typeName: string): string[] {
  const match = new RegExp(`export type ${typeName} =([\\s\\S]*?)\\n\\n`).exec(source)
  const body = match?.[1]
  if (body === undefined) throw new Error(`type ${typeName} not found in web/src/api/types.ts`)
  return [...body.matchAll(/'([^']+)'/g)].flatMap((found) => {
    const literal = found[1]
    return literal === undefined ? [] : [literal]
  })
}
