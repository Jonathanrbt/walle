import { useState, type DragEvent, type ReactNode } from 'react'
import {
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
import { Banknote } from './Banknote'
import './billetes.css'

const DRAG_TYPE = 'text/plain'

/** Customer's interactive wallet: drag a bill to the cashier or press it to insert. */
export function Wallet({
  bills,
  canInsert,
  onInsert,
}: {
  bills: Bill[]
  canInsert: (bill: Bill) => boolean
  onInsert: (bill: Bill) => void
}) {
  return (
    <aside className="wallet" aria-label="Tu billetera">
      <h2>Tu billetera</h2>
      <p className="wallet-hint">Arrastra un billete al cajero o tócalo para insertarlo.</p>
      <ul>
        {DENOMINATIONS.map((bill) => {
          const left = remaining(bills, bill)
          const allowed = left > 0 && canInsert(bill)
          return (
            <li key={bill}>
              <button
                type="button"
                className="wallet-bill"
                draggable={allowed}
                disabled={!allowed}
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_TYPE, String(bill))
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onClick={() => onInsert(bill)}
                aria-label={`Insertar billete de ${formatCop(bill)}, quedan ${left}`}
                title={left > 0 && !allowed ? 'Supera el límite de 100 USDC por operación' : undefined}
              >
                <Banknote bill={bill} />
                <span className="wallet-count">×{left}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}

/** Cashier body that accepts dropped bills; the slot animates each inserted bill. */
export function DropZone({
  enabled,
  lastInserted,
  onInsert,
  children,
}: {
  enabled: boolean
  lastInserted: { bill: Bill; seq: number } | null
  onInsert: (bill: Bill) => void
  children: ReactNode
}) {
  const [over, setOver] = useState(false)

  const onDragOver = (e: DragEvent) => {
    if (!enabled) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setOver(true)
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const bill = Number(e.dataTransfer.getData(DRAG_TYPE)) as Bill
    if (enabled && DENOMINATIONS.includes(bill)) onInsert(bill)
  }

  return (
    <section
      className={`atm${over ? ' atm-drop' : ''}`}
      aria-label="Cajero de efectivo a USDC"
      onDragOver={onDragOver}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      {children}
      <div className={`atm-slot${enabled ? ' atm-slot-ready' : ''}`}>
        {lastInserted && (
          <span key={lastInserted.seq} className="slot-feed" aria-hidden="true">
            <Banknote bill={lastInserted.bill} />
          </span>
        )}
      </div>
    </section>
  )
}

/** Bill insertion screen: running totals against the tier 1 per-transaction limit. */
export function BillsScreen({
  bills,
  copPerUsdc,
  onUndo,
  onCancel,
  onContinue,
}: {
  bills: Bill[]
  copPerUsdc: number | null
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
