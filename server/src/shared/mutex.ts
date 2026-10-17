/** FIFO async lock. A later caller waits until the earlier critical section settles. */
export class Mutex {
  #tail: Promise<undefined> = Promise.resolve(undefined)

  run<T>(body: () => Promise<T> | T): Promise<T> {
    const previous = this.#tail
    const gate = Promise.withResolvers<undefined>()
    this.#tail = gate.promise
    return previous
      .then(() => body())
      .finally(() => {
        gate.resolve(undefined)
      })
  }
}
