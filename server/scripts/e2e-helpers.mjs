const STELLAR_ADDRESS = /^G[A-Z2-7]{55}$/
const DECIMAL = /^\d+(\.\d+)?$/

/**
 * @param {readonly string[]} argv
 * @returns {{ address: string, copAmount: string, base: string }}
 */
export function parseArgs(argv) {
  /** @type {string | undefined} */
  let address
  let copAmount = '100000'
  let base = 'http://localhost:3000'
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--address') {
      address = readValue(argv, index, '--address')
      index += 1
    } else if (flag === '--cop') {
      copAmount = readValue(argv, index, '--cop')
      index += 1
    } else if (flag === '--base') {
      base = readValue(argv, index, '--base')
      index += 1
    } else {
      throw new Error(`argumento desconocido: ${flag}`)
    }
  }
  if (address === undefined) throw new Error('falta --address')
  if (!STELLAR_ADDRESS.test(address)) throw new Error('--address no es una cuenta Stellar')
  if (!isPositiveDecimal(copAmount)) throw new Error('--cop debe ser un decimal positivo')
  let url
  try {
    url = new URL(base)
  } catch {
    throw new Error('--base no es una URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('--base debe ser http(s)')
  }
  return { address, copAmount, base: base.replace(/\/+$/, '') }
}

/**
 * Phone and document come only from the clock so each run has a fresh document.
 * @param {number} nowMs
 * @returns {{ phone: string, fullName: string, documentNumber: string }}
 */
export function syntheticCustomer(nowMs) {
  const digits = Math.trunc(nowMs).toString().replace(/\D/g, '')
  return {
    phone: `3${digits.slice(-9).padStart(9, '0')}`,
    fullName: 'Prueba Testnet',
    documentNumber: digits.slice(-10).padStart(10, '0'),
  }
}

/**
 * The public cash-in does not name the hackathon phases. They follow the status
 * and whether the outgoing payment id is already present.
 * @param {{
 *   status: string,
 *   openPayments?: { outgoingPaymentId?: string, incomingCompleted?: boolean },
 * }} cashIn
 * @returns {{
 *   solicitud: string,
 *   autorizacion: string,
 *   ejecucion: string,
 *   finalizacion: string,
 *   stellar: string,
 * }}
 */
export function derivePhases(cashIn) {
  const outgoing = (cashIn.openPayments?.outgoingPaymentId ?? '').length > 0
  const incomingDone = cashIn.openPayments?.incomingCompleted === true
  const finished = new Set(['settled', 'sending_usdc', 'completed', 'failed_stellar'])
  /** @type {string} */
  let autorizacion = 'pendiente'
  /** @type {string} */
  let ejecucion = 'pendiente'
  /** @type {string} */
  let finalizacion = 'pendiente'
  /** @type {string} */
  let stellar = 'pendiente'

  if (cashIn.status === 'settling') {
    if (outgoing) autorizacion = 'hecha'
    if (outgoing && !incomingDone) ejecucion = 'en curso'
    if (incomingDone) {
      autorizacion = 'hecha'
      ejecucion = 'hecha'
      finalizacion = 'hecha'
    }
  } else if (cashIn.status === 'failed_payment') {
    if (outgoing) autorizacion = 'hecha'
    ejecucion = 'fallida'
  } else if (finished.has(cashIn.status)) {
    autorizacion = 'hecha'
    ejecucion = 'hecha'
    finalizacion = 'hecha'
    if (cashIn.status === 'sending_usdc') stellar = 'enviando'
    if (cashIn.status === 'completed') stellar = 'hecha'
    if (cashIn.status === 'failed_stellar') stellar = 'fallida'
  }

  return {
    solicitud: 'hecha',
    autorizacion,
    ejecucion,
    finalizacion,
    stellar,
  }
}

/**
 * @param {{ copAmount: string, usdcAmount: string, copPerUsdc: string, expiresAt: string }} cashIn
 */
export function formatQuote(cashIn) {
  return `Cotización: ${cashIn.copAmount} COP → ${cashIn.usdcAmount} USDC a ${cashIn.copPerUsdc} COP/USDC, vence ${cashIn.expiresAt}`
}

/**
 * @param {{ status: string, openPayments?: { outgoingPaymentId?: string, incomingCompleted?: boolean } }} cashIn
 * @param {number} elapsedMs
 */
export function formatStatusLine(cashIn, elapsedMs) {
  const phases = derivePhases(cashIn)
  return `+${elapsedMs.toString()}ms ${cashIn.status} | solicitud=${phases.solicitud} autorización=${phases.autorizacion} ejecución=${phases.ejecucion} finalización=${phases.finalizacion} stellar=${phases.stellar}`
}

/**
 * @param {string} label
 * @param {{ usdc: string, floatUsdc: string, lowThresholdPct: number }} inventory
 */
export function formatInventory(label, inventory) {
  return `${label}: ${inventory.usdc} USDC (flotante ${inventory.floatUsdc}, umbral ${inventory.lowThresholdPct.toString()}%)`
}

/**
 * @param {string} before
 * @param {string} after
 */
export function usdcDelta(before, after) {
  return minorToDecimal(decimalToMinor(after) - decimalToMinor(before))
}

/** @param {string} base */
export function missingGrantMessage(base) {
  return `Falta el grant diario. Apruébalo en ${base}/api/grant/start`
}

/**
 * @param {string} base
 * @param {string} id
 */
export function retryHint(base, id) {
  return `El envío Stellar falló. Reintenta con: POST ${base}/api/cash-ins/${id}/retry`
}

/** @param {string} status */
export function terminalExit(status) {
  if (status === 'completed') return 0
  if (status === 'failed_stellar') return 3
  if (status === 'failed_payment' || status === 'expired') return 4
  return undefined
}

/**
 * @param {readonly string[]} argv
 * @param {number} index
 * @param {string} flag
 */
function readValue(argv, index, flag) {
  if (index + 1 >= argv.length) throw new Error(`falta el valor de ${flag}`)
  const value = argv[index + 1]
  if (value.startsWith('--')) throw new Error(`falta el valor de ${flag}`)
  return value
}

/** @param {string} text */
function isPositiveDecimal(text) {
  if (!DECIMAL.test(text)) return false
  return text.replace(/[0.]/g, '').length > 0
}

/** @param {string} text */
function decimalToMinor(text) {
  const negative = text.startsWith('-')
  const body = negative ? text.slice(1) : text
  const [whole = '0', fraction = ''] = body.split('.')
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2))
  return negative ? -minor : minor
}

/** @param {bigint} minor */
function minorToDecimal(minor) {
  const negative = minor < 0n
  const absolute = negative ? -minor : minor
  const whole = absolute / 100n
  const fraction = (absolute % 100n).toString().padStart(2, '0')
  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`
}
