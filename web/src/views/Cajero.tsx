import { useEffect, useState } from 'react'
import { api } from '../api'
import { DropZone, Wallet } from '../cajero/Billetes'
import { FieldStep } from '../cajero/Datos'
import { AddressStep } from '../cajero/Direccion'
import {
  fits,
  formatCop,
  formatUsdc,
  grouped,
  remaining,
  TIER1_TX_USDC_CENTS,
  total,
  usdcCents,
  type Bill,
} from '../cajero/cash'
import { validDocument, validName, validPhone } from '../cajero/validate'
import type { Customer } from '../api'

type Step = 'idle' | 'telefono' | 'nombre' | 'documento' | 'direccion' | 'billetes' | 'cotizacion'

const EMPTY_CUSTOMER: Customer = { phone: '', fullName: '', documentNumber: '' }

export function Cajero() {
  const [step, setStep] = useState<Step>('idle')
  const [customer, setCustomer] = useState<Customer>(EMPTY_CUSTOMER)
  const [address, setAddress] = useState('')
  const [bills, setBills] = useState<Bill[]>([])
  const [lastInserted, setLastInserted] = useState<{ bill: Bill; seq: number } | null>(null)
  const [copPerUsdc, setCopPerUsdc] = useState<number | null>(null)

  useEffect(() => {
    api.rate().then(
      (r) => setCopPerUsdc(Number(r.copPerUsdc)),
      () => setCopPerUsdc(null),
    )
  }, [])

  const canInsert = (bill: Bill) =>
    step === 'billetes' && copPerUsdc !== null && remaining(bills, bill) > 0 && fits(bills, bill, copPerUsdc)

  const insert = (bill: Bill) => {
    if (!canInsert(bill)) return
    setBills([...bills, bill])
    setLastInserted({ bill, seq: (lastInserted?.seq ?? 0) + 1 })
  }

  const reset = () => {
    setCustomer(EMPTY_CUSTOMER)
    setAddress('')
    setBills([])
    setLastInserted(null)
    setStep('idle')
  }

  const cop = total(bills)
  const cents = copPerUsdc ? usdcCents(cop, copPerUsdc) : 0

  return (
    <div className="cajero-layout">
      <DropZone enabled={step === 'billetes'} lastInserted={lastInserted} onInsert={insert}>
        <div className="atm-screen">
          {step === 'idle' && (
            <>
              <p className="atm-kicker">Efectivo → USDC en Stellar</p>
              <h1>Bienvenido</h1>
              <p>Convierte tus billetes en dólares digitales en tu propia billetera.</p>
              <button type="button" className="atm-btn" onClick={() => setStep('telefono')}>
                Empezar
              </button>
            </>
          )}

          {step === 'telefono' && (
            <FieldStep
              step="Paso 1 de 5 · Tus datos"
              title="Número de celular"
              hint="10 dígitos, empieza por 3."
              value={customer.phone}
              onChange={(phone) => setCustomer({ ...customer, phone })}
              valid={validPhone(customer.phone)}
              numeric
              maxLength={10}
              onNext={() => setStep('nombre')}
              onBack={reset}
            />
          )}

          {step === 'nombre' && (
            <FieldStep
              step="Paso 2 de 5 · Tus datos"
              title="Nombre completo"
              hint="Como aparece en tu documento."
              value={customer.fullName}
              onChange={(fullName) => setCustomer({ ...customer, fullName })}
              valid={validName(customer.fullName)}
              maxLength={80}
              onNext={() => setStep('documento')}
              onBack={() => setStep('telefono')}
            />
          )}

          {step === 'documento' && (
            <FieldStep
              step="Paso 3 de 5 · Tus datos"
              title="Número de cédula"
              hint="Nivel 1: hasta 100 USDC por operación, 150 por día y 500 por mes."
              value={customer.documentNumber}
              onChange={(documentNumber) => setCustomer({ ...customer, documentNumber })}
              valid={validDocument(customer.documentNumber)}
              numeric
              maxLength={10}
              onNext={() => setStep('direccion')}
              onBack={() => setStep('nombre')}
            />
          )}

          {step === 'direccion' && (
            <AddressStep
              value={address}
              onChange={setAddress}
              onNext={() => setStep('billetes')}
              onBack={() => setStep('documento')}
            />
          )}

          {step === 'billetes' && (
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
                <button type="button" className="atm-btn atm-btn-ghost" onClick={reset}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="atm-btn atm-btn-ghost"
                  disabled={bills.length === 0}
                  onClick={() => setBills(bills.slice(0, -1))}
                >
                  Deshacer último
                </button>
                <button
                  type="button"
                  className="atm-btn"
                  disabled={bills.length === 0}
                  onClick={() => setStep('cotizacion')}
                >
                  Continuar
                </button>
              </div>
            </>
          )}

          {step === 'cotizacion' && (
            <>
              <p className="atm-kicker">Cotización</p>
              <p className="atm-total">
                {formatCop(cop)} → {formatUsdc(cents)} USDC
              </p>
              <button type="button" className="atm-btn atm-btn-ghost" onClick={reset}>
                Volver al inicio
              </button>
            </>
          )}
        </div>
      </DropZone>

      {step === 'billetes' && <Wallet bills={bills} canInsert={canInsert} onInsert={insert} />}
    </div>
  )
}
