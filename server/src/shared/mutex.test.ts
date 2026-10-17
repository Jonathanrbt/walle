import { describe, expect, it } from 'vitest'

import { Mutex } from './mutex.ts'

describe('Mutex', () => {
  it('runs critical sections in FIFO order', async () => {
    const mutex = new Mutex()
    const order: string[] = []
    let releaseFirst: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = mutex.run(async () => {
      order.push('first-enter')
      await gate
      order.push('first-leave')
    })
    const second = mutex.run(() => {
      order.push('second')
      return 'second'
    })

    await Promise.resolve()
    expect(order).toEqual(['first-enter'])
    if (releaseFirst === undefined) throw new Error('gate was not installed')
    releaseFirst()
    await expect(first).resolves.toBeUndefined()
    await expect(second).resolves.toBe('second')
    expect(order).toEqual(['first-enter', 'first-leave', 'second'])
  })

  it('releases the queue when a critical section rejects', async () => {
    const mutex = new Mutex()
    const first = mutex.run(() => Promise.reject(new Error('boom')))
    const second = mutex.run(() => 'ok')
    await expect(first).rejects.toThrow('boom')
    await expect(second).resolves.toBe('ok')
  })
})
