import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { flushPrefix, prefixChunk } from './prefix-lines.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

if (!existsSync(path.join(root, 'web', 'node_modules'))) {
  console.error('run: npm --prefix web ci')
  process.exit(1)
}

/** @type {import('node:child_process').ChildProcess[]} */
const children = []
let shuttingDown = false

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
    if (shuttingDown) return
    shuttingDown = true
    for (const other of children) signalChild(other, 'SIGTERM')
    process.exit(1)
  })

  child.on('exit', (code) => {
    const flushedOut = flushPrefix(prefix, outPending)
    const flushedErr = flushPrefix(prefix, errPending)
    outPending = flushedOut.pending
    errPending = flushedErr.pending
    if (flushedOut.text) process.stdout.write(flushedOut.text)
    if (flushedErr.text) process.stderr.write(flushedErr.text)

    if (shuttingDown) {
      const finished = children.every((item) => item.exitCode !== null || item.signalCode !== null)
      if (finished) process.exit(0)
      return
    }

    shuttingDown = true
    for (const other of children) signalChild(other, 'SIGTERM')
    process.exit(code === null || code === 0 ? 1 : code)
  })
}

function forward(/** @type {NodeJS.Signals} */ signal) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) signalChild(child, signal)
}

process.on('SIGINT', () => {
  forward('SIGINT')
})
process.on('SIGTERM', () => {
  forward('SIGTERM')
})

start('[server] ', 'npm', ['run', '-w', 'server', 'dev'], {})
start('[web] ', 'npm', ['--prefix', 'web', 'run', 'dev'], {
  VITE_API_MOCK: '0',
  VITE_API_TARGET: 'http://localhost:3000',
})
