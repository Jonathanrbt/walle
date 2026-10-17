import { ApiError, type Api, type CashIn, type CashInStatus, type Grant } from './types'

/**
 * In-browser stand-in for the team backend (team/contracts.md).
 * Status is derived from elapsed time since confirmation, so polling sees the
 * same progression a real Open Payments + Stellar backend reports.
 */

const MID_COP_PER_USDC = 4000
const SPREAD_PCT = 3
const COP_PER_USDC = (MID_COP_PER_USDC * (100 + SPREAD_PCT)) / 100
const QUOTE_TTL_MS = 60_000
const GRANT_TTL_MS = 24 * 60 * 60_000
const GRANT_LIMIT_COP = 2_000_000
const FLOAT_USDC_CENTS = 1000_00
const LOW_THRESHOLD_PCT = 30
/** Tier 1 KYC limits from PROJECT.md, in USDC cents. */
const TIER1 = { tx: 100_00, day: 150_00, month: 500_00 }

/** Milliseconds after confirmation at which each phase starts. */
export const TIMELINE = { settled: 1500, sendingUsdc: 2500, completed: 4000, retry: 1500 }

/** Failure forced with `?fallo=` for rehearsing the demo's fallback paths. */
export type Failure = 'stellar' | 'pago' | 'grant' | 'limite' | 'inventario'

type Rec = {
  id: string
  cop: number
  usdcCents: number
  stellarAddress: string
  documentNumber: string
  memo: string
  quoteId: string
  incomingPaymentUrl: string
  outgoingPaymentId?: string
  stellarTxHash: string
  createdAt: number
  confirmedAt?: number
  retriedAt?: number
  failStellar: boolean
  failPayment: boolean
}

type State = {
  cashIns: Rec[]
  grant: { createdAt: number; expiresAt: number } | null
  usdcBaseCents: number
}

type Options = {
  now?: () => number
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
  failure?: () => Failure | null
  latencyMs?: [number, number]
}

const STORAGE_KEY = 'walle-mock-api'

function browserStorage() {
  try {
    return sessionStorage
  } catch {
    return null
  }
}

function urlFailure(): Failure | null {
  try {
    return (new URLSearchParams(location.search).get('fallo') as Failure) || null
  } catch {
    return null
  }
}

function randomHex(bytes: number) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('')
}

const usdc = (cents: number) => (cents / 100).toFixed(2)
const iso = (ms: number) => new Date(ms).toISOString()
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString()
const sameMonth = (a: number, b: number) => {
  const x = new Date(a)
  const y = new Date(b)
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth()
}

export function createMockApi(opts: Options = {}) {
  const now = opts.now ?? Date.now
  const storage = opts.storage === undefined ? browserStorage() : opts.storage
  const failure = opts.failure ?? urlFailure
  const [minLatency, maxLatency] = opts.latencyMs ?? [200, 500]

  let memory: State = { cashIns: [], grant: null, usdcBaseCents: FLOAT_USDC_CENTS }

  const load = (): State => {
    try {
      const raw = storage?.getItem(STORAGE_KEY)
      if (raw) memory = JSON.parse(raw)
    } catch {
      /* keep in-memory state */
    }
    return memory
  }
  const save = (s: State) => {
    memory = s
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(s))
    } catch {
      /* keep in-memory state */
    }
  }

  const delay = () => {
    const ms = minLatency + Math.random() * (maxLatency - minLatency)
    return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve()
  }

  function statusOf(r: Rec, t: number): CashInStatus {
    if (r.confirmedAt === undefined) return t > r.createdAt + QUOTE_TTL_MS ? 'expired' : 'quoted'
    const since = t - r.confirmedAt
    if (since < TIMELINE.settled) return 'settling'
    if (r.failPayment) return 'failed_payment'
    if (since < TIMELINE.sendingUsdc) return 'settled'
    if (r.retriedAt !== undefined) return t - r.retriedAt < TIMELINE.retry ? 'sending_usdc' : 'completed'
    if (since < TIMELINE.completed) return 'sending_usdc'
    return r.failStellar ? 'failed_stellar' : 'completed'
  }

  function view(r: Rec, t: number): CashIn {
    const status = statusOf(r, t)
    const completed = status === 'completed'
    return {
      id: r.id,
      status,
      copAmount: String(r.cop),
      usdcAmount: usdc(r.usdcCents),
      copPerUsdc: String(COP_PER_USDC),
      expiresAt: iso(r.createdAt + QUOTE_TTL_MS),
      stellarAddress: r.stellarAddress,
      memo: r.memo,
      openPayments: {
        incomingPaymentUrl: r.incomingPaymentUrl,
        quoteId: r.quoteId,
        outgoingPaymentId: r.outgoingPaymentId,
        incomingCompleted: ['settled', 'sending_usdc', 'completed', 'failed_stellar'].includes(status),
      },
      stellarTxHash: completed ? r.stellarTxHash : undefined,
      createdAt: iso(r.createdAt),
    }
  }

  const grantActive = (s: State, t: number) => !!s.grant && t < s.grant.expiresAt && failure() !== 'grant'

  const spentCop = (s: State) =>
    s.cashIns
      .filter((r) => s.grant && r.confirmedAt !== undefined && r.confirmedAt >= s.grant.createdAt && !r.failPayment)
      .reduce((sum, r) => sum + r.cop, 0)

  const inventoryCents = (s: State, t: number) =>
    s.usdcBaseCents -
    s.cashIns.filter((r) => statusOf(r, t) === 'completed').reduce((sum, r) => sum + r.usdcCents, 0)

  /** USDC already committed (confirmed, not failed in Open Payments) but not yet delivered. */
  const inFlightCents = (s: State, t: number) =>
    s.cashIns
      .filter((r) => ['settling', 'settled', 'sending_usdc', 'failed_stellar'].includes(statusOf(r, t)))
      .reduce((sum, r) => sum + r.usdcCents, 0)

  function find(s: State, id: string) {
    const r = s.cashIns.find((c) => c.id === id)
    if (!r) throw new ApiError('not_found', id)
    return r
  }

  function assertGrantCovers(s: State, t: number, cop: number) {
    if (!grantActive(s, t)) throw new ApiError('no_grant')
    if (spentCop(s) + cop > GRANT_LIMIT_COP) throw new ApiError('grant_exhausted')
  }

  const api: Api & { approveGrant(): Promise<Grant> } = {
    async rate() {
      await delay()
      return { copPerUsdc: String(COP_PER_USDC), spreadPct: SPREAD_PCT, quotedAt: iso(now()) }
    },

    async createCashIn(req) {
      await delay()
      const s = load()
      const t = now()
      const cop = Number(req.copAmount)
      if (!Number.isInteger(cop) || cop <= 0) throw new ApiError('limit_exceeded', 'invalid amount')
      if (!/^G[A-Z2-7]{55}$/.test(req.stellarAddress)) throw new ApiError('invalid_address')
      assertGrantCovers(s, t, cop)

      const usdcCents = Math.floor((cop * 100) / COP_PER_USDC)
      const doc = req.customer.documentNumber
      const confirmedBy = (match: (a: number, b: number) => boolean) =>
        s.cashIns
          .filter((r) => r.documentNumber === doc && r.confirmedAt !== undefined && !r.failPayment && match(r.confirmedAt, t))
          .reduce((sum, r) => sum + r.usdcCents, 0)
      if (
        failure() === 'limite' ||
        usdcCents > TIER1.tx ||
        confirmedBy(sameDay) + usdcCents > TIER1.day ||
        confirmedBy(sameMonth) + usdcCents > TIER1.month
      )
        throw new ApiError('limit_exceeded')
      if (failure() === 'inventario' || usdcCents > inventoryCents(s, t) - inFlightCents(s, t))
        throw new ApiError('insufficient_inventory')

      const id = crypto.randomUUID()
      const rec: Rec = {
        id,
        cop,
        usdcCents,
        stellarAddress: req.stellarAddress,
        documentNumber: doc,
        memo: `walle-${id.slice(0, 8)}`,
        quoteId: `https://ilp.interledger-test.dev/cajero/quotes/${crypto.randomUUID()}`,
        incomingPaymentUrl: `https://ilp.interledger-test.dev/operador/incoming-payments/${crypto.randomUUID()}`,
        stellarTxHash: randomHex(32),
        createdAt: t,
        failStellar: failure() === 'stellar',
        failPayment: failure() === 'pago',
      }
      save({ ...s, cashIns: [rec, ...s.cashIns] })
      return view(rec, t)
    },

    async confirmCashIn(id) {
      await delay()
      const s = load()
      const t = now()
      const r = find(s, id)
      if (statusOf(r, t) === 'expired') throw new ApiError('quote_expired')
      if (r.confirmedAt === undefined) {
        assertGrantCovers(s, t, r.cop)
        r.confirmedAt = t
        r.outgoingPaymentId = `https://ilp.interledger-test.dev/cajero/outgoing-payments/${crypto.randomUUID()}`
        save(s)
      }
      return view(r, t)
    },

    async retryCashIn(id) {
      await delay()
      const s = load()
      const t = now()
      const r = find(s, id)
      if (statusOf(r, t) === 'failed_stellar') {
        r.retriedAt = t
        save(s)
      }
      return view(r, t)
    },

    async getCashIn(id) {
      await delay()
      return view(find(load(), id), now())
    },

    async grant() {
      await delay()
      const s = load()
      const t = now()
      if (!s.grant) return { status: 'missing' }
      return {
        status: grantActive(s, t) ? 'active' : 'expired',
        limitCop: String(GRANT_LIMIT_COP),
        spentCop: String(spentCop(s)),
        expiresAt: iso(s.grant.expiresAt),
      }
    },

    grantStartUrl: '/tienda?consentimiento=simulado',

    /** Simulated outcome of the store owner approving the GNAP consent screen. */
    async approveGrant() {
      await delay()
      const s = load()
      const t = now()
      save({ ...s, grant: { createdAt: t, expiresAt: t + GRANT_TTL_MS } })
      return api.grant()
    },

    async operatorCashIns() {
      await delay()
      const s = load()
      const t = now()
      return s.cashIns.filter((r) => r.confirmedAt !== undefined).map((r) => view(r, t))
    },

    async inventory() {
      await delay()
      const s = load()
      return {
        usdc: usdc(inventoryCents(s, now())),
        floatUsdc: usdc(FLOAT_USDC_CENTS),
        lowThresholdPct: LOW_THRESHOLD_PCT,
      }
    },

    async refill() {
      await delay()
      const s = load()
      const t = now()
      save({ ...s, usdcBaseCents: s.usdcBaseCents + FLOAT_USDC_CENTS - inventoryCents(s, t) })
      return { usdc: usdc(FLOAT_USDC_CENTS) }
    },
  }

  return api
}
