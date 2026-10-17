import { existsSync, readFileSync } from 'node:fs'

const BEGIN = '-----BEGIN PRIVATE KEY-----'
const END = '-----END PRIVATE KEY-----'
const LINE_WIDTH = 64

export class PrivateKeyError extends Error {
  constructor() {
    super('private key must be a PEM document or a path to one')
    this.name = 'PrivateKeyError'
  }
}

/** PEM text, re-wrapped to 64-character lines, or the contents of a PEM file. */
export function loadPrivateKey(valueOrPath: string): string {
  return wrapPem(readMaterial(valueOrPath))
}

function readMaterial(valueOrPath: string): string {
  const unescaped = valueOrPath.includes('\\n') ? valueOrPath.replaceAll('\\n', '\n') : valueOrPath
  if (unescaped.includes(BEGIN)) return unescaped
  try {
    if (!existsSync(valueOrPath)) throw new PrivateKeyError()
    return readFileSync(valueOrPath, 'utf8')
  } catch (error) {
    if (error instanceof PrivateKeyError) throw error
    throw new PrivateKeyError()
  }
}

function wrapPem(source: string): string {
  const begin = source.indexOf(BEGIN)
  const end = source.indexOf(END)
  if (begin < 0 || end < begin) throw new PrivateKeyError()
  const body = source.slice(begin + BEGIN.length, end).replaceAll(/\s+/g, '')
  if (body.length === 0 || !/^[A-Za-z0-9+/=]+$/.test(body)) throw new PrivateKeyError()
  const lines: string[] = []
  for (let index = 0; index < body.length; index += LINE_WIDTH) {
    lines.push(body.slice(index, index + LINE_WIDTH))
  }
  return `${BEGIN}\n${lines.join('\n')}\n${END}\n`
}
