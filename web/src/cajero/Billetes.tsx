import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Banknote } from './Banknote'
import {
  BILL_DESIGN,
  DENOMINATIONS,
  formatCop,
  formatUsdc,
  grouped,
  remaining,
  TIER1_TX_USDC_CENTS,
  total,
  usdcCents,
  type Bill,
} from './cash'
import { dropOutcome, tilt, type DropOutcome } from './drag'
import './billetes.css'

const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)'
const SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)'
const TAP_PX = 6

/** Relative note length, so the 100.000 is visibly longer than the 2.000. */
const lenVar = (bill: Bill) => ({ '--len': BILL_DESIGN[bill].lengthMm / 153 }) as CSSProperties

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

function play(el: HTMLElement, frames: Keyframe[], ms: number, easing: string) {
  return el.animate(frames, { duration: reducedMotion() ? 0 : ms, easing, fill: 'forwards' }).finished
}

/** Lifts the top note of a stack into a fixed ghost that can move over the whole page. */
function lift(stack: HTMLElement) {
  const notes = stack.querySelectorAll<HTMLElement>('.wallet-note')
  const note = notes[notes.length - 1]
  const r = note.getBoundingClientRect()
  const ghost = note.cloneNode(true) as HTMLElement
  ghost.className = 'bill-ghost'
  Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, visibility: '' })
  document.body.append(ghost)
  note.style.visibility = 'hidden'
  return { ghost, note, r }
}

/** Offset that rests the ghost on the slot, sunk `depth` px into it. */
function toSlot(r: DOMRect, depth: number) {
  const s = document.querySelector('[data-bill-slot]')?.getBoundingClientRect()
  if (!s) return 'none'
  const dx = s.left + s.width / 2 - (r.left + r.width / 2)
  const dy = s.top + s.height / 2 - (r.top + r.height) + depth
  return `translate(${dx}px, ${dy}px)`
}

/** Animates the ghost to its fate, then hands the outcome back and restores the stack. */
async function release(
  { ghost, note, r }: ReturnType<typeof lift>,
  outcome: DropOutcome,
  onDrop: (o: DropOutcome) => void,
) {
  const from = ghost.style.transform || 'none'
  if (outcome === 'insert') {
    await play(ghost, [{ transform: from }, { transform: toSlot(r, 0) }], 260, EASE)
    onDrop('insert')
  } else if (outcome === 'reject') {
    const at = toSlot(r, 10)
    await play(ghost, [{ transform: from }, { transform: at }], 240, EASE)
    onDrop('reject')
    const shake = [-6, 6, -6, 6, 0].map((x) => ({ transform: `${at} translateX(${x}px)` }))
    await play(ghost, [{ transform: at }, ...shake], 300, 'ease-in-out')
    await play(ghost, [{ transform: at }, { transform: 'none' }], 420, SPRING)
  } else {
    await play(ghost, [{ transform: from }, { transform: 'none' }], 420, SPRING)
  }
  ghost.remove()
  note.style.visibility = ''
}

/** Pointer drag with paper physics: the note leans with speed and pivots on the grab point. */
function drag(e: ReactPointerEvent<HTMLElement>, allowed: () => boolean, onDrop: (o: DropOutcome) => void) {
  if (e.button !== 0) return
  const stack = e.currentTarget
  stack.setPointerCapture(e.pointerId)
  const lifted = lift(stack)
  const { ghost, r } = lifted
  const start = { x: e.clientX, y: e.clientY }
  const p = { ...start }
  let last = e.timeStamp
  let v = 0
  let rot = 0
  let frame = 0
  ghost.style.transformOrigin = `${start.x - r.left}px ${start.y - r.top}px`

  const target = () => document.querySelector<HTMLElement>('[data-bill-drop]')
  const tick = () => {
    v *= 0.9
    rot += (tilt(v) - rot) * 0.25
    ghost.style.transform = `translate(${p.x - start.x}px, ${p.y - start.y}px) rotate(${rot}deg) scale(1.06)`
    const t = target()
    t?.toggleAttribute('data-over', dropOutcome(p, t.getBoundingClientRect(), true) === 'insert')
    frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)

  const move = (ev: PointerEvent) => {
    const dt = Math.max(1, ev.timeStamp - last)
    v = 0.8 * v + 0.2 * ((ev.clientX - p.x) / dt)
    p.x = ev.clientX
    p.y = ev.clientY
    last = ev.timeStamp
  }

  const end = (ev: PointerEvent) => {
    cancelAnimationFrame(frame)
    stack.removeEventListener('pointermove', move)
    stack.removeEventListener('pointerup', end)
    stack.removeEventListener('pointercancel', end)
    const t = target()
    t?.removeAttribute('data-over')
    const tapped = Math.hypot(p.x - start.x, p.y - start.y) < TAP_PX
    let outcome: DropOutcome
    if (ev.type === 'pointercancel') outcome = 'return'
    else if (tapped) outcome = allowed() ? 'insert' : 'reject'
    else outcome = dropOutcome(p, t?.getBoundingClientRect() ?? null, allowed())
    release(lifted, outcome, onDrop)
  }

  stack.addEventListener('pointermove', move)
  stack.addEventListener('pointerup', end)
  stack.addEventListener('pointercancel', end)
}

/** Customer's wallet: drag a note into the cashier, or tap it (or press Enter) to feed it. */
export function Wallet({
  bills,
  canInsert,
  onInsert,
  onReject,
}: {
  bills: Bill[]
  canInsert: (bill: Bill) => boolean
  onInsert: (bill: Bill) => void
  onReject: (bill: Bill) => void
}) {
  // Drops resolve after an animation, so they must read this render's state, not the one at pointerdown.
  const live = useRef({ canInsert, onInsert, onReject })
  live.current = { canInsert, onInsert, onReject }
  const allowed = (bill: Bill) => () => live.current.canInsert(bill)
  const handle = (bill: Bill) => (o: DropOutcome) => {
    if (o === 'insert') live.current.onInsert(bill)
    if (o === 'reject') live.current.onReject(bill)
  }

  return (
    <aside className="wallet" aria-label="Tu billetera">
      <h2>Tu billetera</h2>
      <p className="wallet-hint">Arrastra un billete a la ranura del cajero, o tócalo.</p>
      <ul>
        {DENOMINATIONS.map((bill) => {
          const left = remaining(bills, bill)
          return (
            <li key={bill} style={lenVar(bill)}>
              <button
                type="button"
                className="wallet-stack"
                disabled={left === 0}
                onPointerDown={(e) => drag(e, allowed(bill), handle(bill))}
                onClick={(e) => {
                  // Keyboard activation only; pointer taps are resolved in drag().
                  if (e.detail === 0)
                    release(lift(e.currentTarget), allowed(bill)() ? 'insert' : 'reject', handle(bill))
                }}
                aria-label={`Insertar billete de ${formatCop(bill)}, quedan ${left}`}
              >
                {Array.from({ length: Math.min(left, 3) }, (_, i) => (
                  <span key={i} className="wallet-note" style={{ '--d': Math.min(left, 3) - 1 - i } as CSSProperties}>
                    <Banknote bill={bill} />
                  </span>
                ))}
                <b className="wallet-count">×{left}</b>
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}

/** Cashier body: the drop target for notes, with a slot that swallows or rejects them. */
export function DropZone({
  enabled,
  lastInserted,
  rejected,
  children,
}: {
  enabled: boolean
  lastInserted: { bill: Bill; seq: number } | null
  rejected: { bill: Bill; seq: number } | null
  children: ReactNode
}) {
  return (
    <section className="atm" data-bill-drop={enabled || undefined} aria-label="Cajero de efectivo a USDC">
      <div className="atm-head" aria-hidden="true">
        <span>walle · cajero</span>
        <span className="atm-leds">
          <i />
          <i />
          <i />
        </span>
      </div>
      {children}
      <div className="atm-tray">
        <span className="atm-tray-label">{enabled ? 'Inserte billetes' : 'Ranura de billetes'}</span>
        <div className={`atm-slot${enabled ? ' atm-slot-ready' : ''}`} data-bill-slot>
          {lastInserted && (
            <span key={lastInserted.seq} className="slot-feed" style={lenVar(lastInserted.bill)} aria-hidden="true">
              <Banknote bill={lastInserted.bill} />
            </span>
          )}
          {rejected && <i key={rejected.seq} className="slot-reject" />}
        </div>
      </div>
    </section>
  )
}

/** Bill insertion screen: running totals against the tier 1 per-transaction limit. */
export function BillsScreen({
  bills,
  copPerUsdc,
  notice,
  onUndo,
  onCancel,
  onContinue,
}: {
  bills: Bill[]
  copPerUsdc: number | null
  notice?: string
  onUndo: () => void
  onCancel: () => void
  onContinue: () => void
}) {
  const cop = total(bills)
  const cents = copPerUsdc ? usdcCents(cop, copPerUsdc) : 0
  return (
    <>
      <p className="atm-kicker">Paso 5 de 5 · Inserte sus billetes</p>
      <p className="atm-total" aria-live="polite">
        {formatCop(cop)} <small>COP</small>
      </p>
      <p className="atm-usdc">
        ≈ {copPerUsdc ? formatUsdc(cents) : '…'} <small>USDC</small>
      </p>
      <div
        className="atm-meter"
        role="meter"
        aria-label="Límite por operación"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={cents / 100}
      >
        <span style={{ width: `${Math.min(100, (cents / TIER1_TX_USDC_CENTS) * 100)}%` }} />
      </div>
      <p className="atm-dim">
        Límite por operación: 100 USDC ·{' '}
        {copPerUsdc ? `1 USDC = ${formatCop(copPerUsdc)} (tasa de referencia del operador)` : 'tasa no disponible'}
      </p>
      {notice && (
        <p className="atm-notice" role="alert">
          {notice}
        </p>
      )}
      {bills.length > 0 && (
        <ul className="atm-bills">
          {grouped(bills).map((g) => (
            <li key={g.bill}>
              {g.count} × {formatCop(g.bill)}
            </li>
          ))}
        </ul>
      )}
      <div className="atm-actions">
        <button type="button" className="atm-btn atm-btn-ghost" onClick={onCancel}>
          Cancelar
        </button>
        <button type="button" className="atm-btn atm-btn-ghost" disabled={bills.length === 0} onClick={onUndo}>
          Deshacer último
        </button>
        <button type="button" className="atm-btn" disabled={bills.length === 0 || !copPerUsdc} onClick={onContinue}>
          Continuar
        </button>
      </div>
    </>
  )
}
