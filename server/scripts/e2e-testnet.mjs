import { randomUUID } from 'node:crypto'

import { ApiError, CashIn, Grant, Inventory } from '@walle/contracts'

import {
  formatInventory,
  formatQuote,
  formatStatusLine,
  missingGrantMessage,
  parseArgs,
  retryHint,
  syntheticCustomer,
  terminalExit,
  usdcDelta,
} from './e2e-helpers.mjs'

const POLL_MS = 1000
const TIMEOUT_MS = 180_000

const usage =
  'Uso: npm run -w server e2e:testnet -- --address G... [--cop 100000] [--base http://localhost:3000]'

async function main() {
  /** @type {{ address: string, copAmount: string, base: string }} */
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'argumentos inválidos')
    console.error(usage)
    process.exit(1)
  }

  const grant = await readJson(args.base, '/api/grant', Grant, 'GET /api/grant', 200)
  if (grant.status !== 'active') {
    console.log(missingGrantMessage(args.base))
    process.exit(2)
  }

  const before = await readJson(
    args.base,
    '/api/operator/inventory',
    Inventory,
    'GET /api/operator/inventory',
    200,
  )
  console.log(formatInventory('Inventario antes', before))

  const created = await readJson(args.base, '/api/cash-ins', CashIn, 'POST /api/cash-ins', 201, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
    },
    body: JSON.stringify({
      copAmount: args.copAmount,
      stellarAddress: args.address,
      customer: syntheticCustomer(Date.now()),
    }),
  })
  console.log(formatQuote(created))

  const started = Date.now()
  let current = await readJson(
    args.base,
    `/api/cash-ins/${encodeURIComponent(created.id)}/confirm`,
    CashIn,
    'POST /api/cash-ins/:id/confirm',
    202,
    { method: 'POST' },
  )
  console.log(formatStatusLine(current, Date.now() - started))

  const deadline = started + TIMEOUT_MS
  while (terminalExit(current.status) === undefined) {
    if (Date.now() >= deadline) {
      console.error(`Tiempo agotado tras ${TIMEOUT_MS.toString()} ms en estado ${current.status}`)
      process.exit(5)
    }
    await sleep(POLL_MS)
    const next = await readJson(
      args.base,
      `/api/cash-ins/${encodeURIComponent(created.id)}`,
      CashIn,
      'GET /api/cash-ins/:id',
      200,
    )
    if (next.status !== current.status) console.log(formatStatusLine(next, Date.now() - started))
    current = next
  }

  const code = terminalExit(current.status)
  if (code === 0) {
    await printCompleted(args.base, current, before.usdc, Date.now() - started)
  } else if (code === 3) {
    console.log(retryHint(args.base, current.id))
  }
  process.exit(code)
}

/**
 * @param {string} base
 * @param {{ id: string, stellarTxHash?: string, openPayments: { outgoingPaymentId?: string } }} cashIn
 * @param {string} usdcBefore
 * @param {number} elapsedMs
 */
async function printCompleted(base, cashIn, usdcBefore, elapsedMs) {
  const hash = cashIn.stellarTxHash
  const outgoing = cashIn.openPayments.outgoingPaymentId
  if (hash === undefined || hash.length === 0) {
    throw new Error('el ingreso completado no trae hash de Stellar')
  }
  if (outgoing === undefined || outgoing.length === 0) {
    throw new Error('el ingreso completado no trae el pago saliente')
  }
  const after = await readJson(
    base,
    '/api/operator/inventory',
    Inventory,
    'GET /api/operator/inventory',
    200,
  )
  console.log(`Hash Stellar: ${hash}`)
  console.log(`https://stellar.expert/explorer/testnet/tx/${hash}`)
  console.log(`Pago saliente: ${outgoing}`)
  console.log(`Tiempo total: ${elapsedMs.toString()} ms`)
  console.log(formatInventory('Inventario después', after))
  console.log(`Delta USDC: ${usdcDelta(usdcBefore, after.usdc)}`)
}

/**
 * @template T
 * @param {string} base
 * @param {string} path
 * @param {{ safeParse: (value: unknown) => { success: true, data: T } | { success: false, error: { issues: { path: PropertyKey[] }[] } } }} schema
 * @param {string} label
 * @param {number} expected
 * @param {RequestInit} [init]
 * @returns {Promise<T>}
 */
async function readJson(base, path, schema, label, expected, init) {
  const response = await fetch(`${base}${path}`, init)
  const text = await response.text()
  /** @type {unknown} */
  let body
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`${label}: el cuerpo no es JSON`)
  }
  if (response.status !== expected) {
    const parsed = ApiError.safeParse(body)
    const code = parsed.success ? parsed.data.error : 'unexpected'
    throw new Error(`${label}: HTTP ${response.status.toString()} ${code}`)
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    const paths = parsed.error.issues.map((issue) => issue.path.map(String).join('.')).join(', ')
    throw new Error(`${label}: la respuesta no cumple el contrato (${paths})`)
  }
  return parsed.data
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

main().catch(
  /** @param {unknown} error */
  (error) => {
    console.error(error instanceof Error ? error.message : 'falló el recorrido')
    process.exit(1)
  },
)
