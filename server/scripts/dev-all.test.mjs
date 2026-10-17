import { describe, expect, it } from 'vitest'
import { reduceExit } from './dev-all.mjs'

describe('reduceExit', () => {
  it('waits for every child after a signal and exits 0', () => {
    const signaled = reduceExit(
      { phase: 'running', failureCode: undefined },
      { kind: 'signal' },
      false,
    )
    expect(signaled.exitCode).toBeUndefined()
    expect(signaled.state.phase).toBe('signal')

    const first = reduceExit(signaled.state, { kind: 'exit', code: null }, false)
    expect(first.exitCode).toBeUndefined()
    const second = reduceExit(first.state, { kind: 'exit', code: null }, true)
    expect(second.exitCode).toBe(0)
  })

  it('exits with the first failing child only after the other child finishes', () => {
    const failed = reduceExit(
      { phase: 'running', failureCode: undefined },
      { kind: 'exit', code: 2 },
      false,
    )
    expect(failed.exitCode).toBeUndefined()
    expect(failed.state.failureCode).toBe(2)

    const sibling = reduceExit(failed.state, { kind: 'exit', code: 0 }, true)
    expect(sibling.exitCode).toBe(2)
  })

  it('treats an unexpected clean exit as failure and keeps a spawn error', () => {
    const clean = reduceExit(
      { phase: 'running', failureCode: undefined },
      { kind: 'exit', code: 0 },
      true,
    )
    expect(clean.exitCode).toBe(1)

    const spawned = reduceExit(
      { phase: 'running', failureCode: undefined },
      { kind: 'error' },
      false,
    )
    expect(spawned.exitCode).toBeUndefined()
    const rest = reduceExit(spawned.state, { kind: 'exit', code: 0 }, true)
    expect(rest.exitCode).toBe(1)
  })
})
