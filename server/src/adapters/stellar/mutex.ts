/** Serializes async sections. A later caller waits until the earlier section settles. */
export class Mutex {
  private tail: Promise<void> = Promise.resolve()

  async run<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.tail
    let release: () => void = () => undefined
    this.tail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await action()
    } finally {
      release()
    }
  }
}
