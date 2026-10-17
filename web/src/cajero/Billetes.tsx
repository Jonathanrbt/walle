import { useState, type DragEvent, type ReactNode } from 'react'
import { DENOMINATIONS, formatCop, remaining, type Bill } from './cash'
import './billetes.css'

const DRAG_TYPE = 'text/plain'

export function BillNote({ bill }: { bill: Bill }) {
  return (
    <span className={`bill bill-${bill}`}>
      <span className="bill-corner">{bill / 1000}</span>
      <span className="bill-value">{formatCop(bill)}</span>
      <span className="bill-country">Colombia</span>
    </span>
  )
}

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
                <BillNote bill={bill} />
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
            <BillNote bill={lastInserted.bill} />
          </span>
        )}
      </div>
    </section>
  )
}
