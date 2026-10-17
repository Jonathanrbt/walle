import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadPrivateKey, PrivateKeyError } from './private-key.ts'

const RAW = `${'A'.repeat(64)}BBBBBB`
const CANONICAL = `-----BEGIN PRIVATE KEY-----\n${'A'.repeat(64)}\nBBBBBB\n-----END PRIVATE KEY-----\n`

describe('loadPrivateKey', () => {
  it('keeps a multi-line PEM canonical', () => {
    expect(loadPrivateKey(CANONICAL)).toBe(CANONICAL)
  })

  it('rewraps a one-line PEM into 64-character lines', () => {
    const oneLine = `-----BEGIN PRIVATE KEY-----${RAW}-----END PRIVATE KEY-----`
    expect(loadPrivateKey(oneLine)).toBe(CANONICAL)
  })

  it('reads a PEM file path', () => {
    const directory = mkdtempSync(join(tmpdir(), 'walle-key-'))
    const path = join(directory, 'private.key')
    writeFileSync(path, CANONICAL)
    expect(loadPrivateKey(path)).toBe(CANONICAL)
  })

  it('rejects garbage without echoing the input', () => {
    const secret = 'SENTINEL-KEY-VALUE-DO-NOT-ECHO'
    expect(() => loadPrivateKey(secret)).toThrow(PrivateKeyError)
    try {
      loadPrivateKey(secret)
    } catch (error) {
      expect(error).toBeInstanceOf(PrivateKeyError)
      expect(error instanceof Error ? error.message : '').not.toContain(secret)
    }
  })
})
