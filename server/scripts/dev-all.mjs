import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { flushPrefix, prefixChunk } from './prefix-lines.mjs'

/**
 * @typedef {{ phase: 'running' | 'signal' | 'child', failureCode: number | undefined }} ExitState
 * @typedef {{ kind: 'signal' } | { kind: 'error' } | { kind: 'exit', code: number | null }} ExitEvent
 */

/**
 * The parent leaves `running` on the first signal, spawn error, or child exit.
 * A child that exits by itself records that failure (1 when the code is 0 or
 * missing). Later exits do not replace it. `exitCode` is set only once every
 * child has finished, so a signal waits for both processes.
 *
 * @param {ExitState} state
 * @param {ExitEvent} event
 * @param {boolean} allFinished
 * @returns {{ state: ExitState, exitCode: number | undefined }}
 */
export function reduceExit(state, event, allFinished) {
  let phase = state.phase
  let failureCode = state.failureCode
  if (event.kind === 'signal') {
    if (phase === 'running') phase = 'signal'
  } else if (event.kind === 'error') {
    if (phase === 'running') phase = 'child'
    failureCode ??= 1
  } else if (phase === 'running') {
    phase = 'child'
    failureCode = event.code === null || event.code === 0 ? 1 : event.code
  }
  const next = { phase, failureCode }
  const exitCode = phase === 'running' || !allFinished ? undefined : (failureCode ?? 0)
  return { state: next, exitCode }
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

  if (!existsSync(path.join(root, 'web', 'node_modules'))) {
    console.error('run: npm --prefix web ci')
    process.exit(1)
  }

  /** @type {import('node:child_process').ChildProcess[]} */
  const children = []
  /** @type {Set<import('node:child_process').ChildProcess>} */
  const settled = new Set()
  /** @type {ExitState} */
  let exitState = { phase: 'running', failureCode: undefined }

  /**
   * @param {import('node:child_process').ChildProcess} child
   * @param {NodeJS.Signals} signal
   */
  function signalChild(child, signal) {
    if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
    try {
      process.kill(-child.pid, signal)
    } catch {
      child.kill(signal)
    }
  }

  /**
   * @param {ExitEvent} event
   * @param {import('node:child_process').ChildProcess | undefined} child
   * @param {NodeJS.Signals} signal
   */
  function observe(event, child, signal) {
    if (child !== undefined) settled.add(child)
    const wasRunning = exitState.phase === 'running'
    const result = reduceExit(
      exitState,
      event,
      children.every((item) => settled.has(item)),
    )
    exitState = result.state
    if (wasRunning && exitState.phase !== 'running') {
      for (const other of children) signalChild(other, signal)
    }
    if (result.exitCode !== undefined) process.exit(result.exitCode)
  }

  /**
   * @param {string} prefix
   * @param {string} command
   * @param {string[]} args
   * @param {Record<string, string>} extraEnv
   */
  function start(prefix, command, args, extraEnv) {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })
    children.push(child)

    let outPending = ''
    let errPending = ''
    child.stdout.on('data', (buf) => {
      const next = prefixChunk(prefix, outPending, String(buf))
      outPending = next.pending
      if (next.text) process.stdout.write(next.text)
    })
    child.stderr.on('data', (buf) => {
      const next = prefixChunk(prefix, errPending, String(buf))
      errPending = next.pending
      if (next.text) process.stderr.write(next.text)
    })

    child.on('error', () => {
      observe({ kind: 'error' }, child, 'SIGTERM')
    })

    child.on('exit', (code) => {
      const flushedOut = flushPrefix(prefix, outPending)
      const flushedErr = flushPrefix(prefix, errPending)
      outPending = flushedOut.pending
      errPending = flushedErr.pending
      if (flushedOut.text) process.stdout.write(flushedOut.text)
      if (flushedErr.text) process.stderr.write(flushedErr.text)
      observe({ kind: 'exit', code }, child, 'SIGTERM')
    })
  }

  process.on('SIGINT', () => {
    observe({ kind: 'signal' }, undefined, 'SIGINT')
  })
  process.on('SIGTERM', () => {
    observe({ kind: 'signal' }, undefined, 'SIGTERM')
  })

  start('[server] ', 'npm', ['run', '-w', 'server', 'dev'], {})
  start('[web] ', 'npm', ['--prefix', 'web', 'run', 'dev'], {
    VITE_API_MOCK: '0',
    VITE_API_TARGET: 'http://localhost:3000',
  })
}

if (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
