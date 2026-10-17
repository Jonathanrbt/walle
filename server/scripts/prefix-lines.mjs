/** Prefix complete lines from a stream chunk, holding a trailing fragment. */

/**
 * @param {string} prefix
 * @param {string} pending
 * @param {string} chunk
 * @returns {{ text: string, pending: string }}
 */
export function prefixChunk(prefix, pending, chunk) {
  const parts = (pending + chunk).split('\n')
  const nextPending = parts.pop() ?? ''
  const text = parts.map((line) => `${prefix}${line}\n`).join('')
  return { text, pending: nextPending }
}

/**
 * @param {string} prefix
 * @param {string} pending
 * @returns {{ text: string, pending: string }}
 */
export function flushPrefix(prefix, pending) {
  if (pending === '') return { text: '', pending: '' }
  return { text: `${prefix}${pending}\n`, pending: '' }
}
