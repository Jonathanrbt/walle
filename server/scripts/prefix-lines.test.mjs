import { describe, expect, it } from 'vitest'
import { flushPrefix, prefixChunk } from './prefix-lines.mjs'

describe('prefixChunk', () => {
  it('prefixes each complete line and keeps a trailing fragment', () => {
    const first = prefixChunk('[server] ', '', 'hello\nwor')
    expect(first).toEqual({ text: '[server] hello\n', pending: 'wor' })

    const second = prefixChunk('[server] ', first.pending, 'ld\n')
    expect(second).toEqual({ text: '[server] world\n', pending: '' })
  })

  it('prefixes several lines from one chunk', () => {
    const result = prefixChunk('[web] ', '', 'a\nb\n')
    expect(result).toEqual({ text: '[web] a\n[web] b\n', pending: '' })
  })

  it('flushes a fragment that never saw a newline', () => {
    const partial = prefixChunk('[web] ', '', 'tail')
    expect(partial.text).toBe('')
    expect(flushPrefix('[web] ', partial.pending)).toEqual({
      text: '[web] tail\n',
      pending: '',
    })
  })

  it('flush of an empty buffer writes nothing', () => {
    expect(flushPrefix('[server] ', '')).toEqual({ text: '', pending: '' })
  })
})
