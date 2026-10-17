import { useEffect, useState } from 'react'
import { api, ApiError, type ApiErrorCode, type CashIn, type Customer } from '../api'
import { BillsScreen, DropZone, Wallet } from '../cajero/Billetes'
import { fits, formatCop, remaining, total, type Bill } from '../cajero/cash'
import { FieldStep } from '../cajero/Datos'
import { AddressStep } from '../cajero/Direccion'
import { errorMessages } from '../cajero/phases'
import { ProcessingScreen, QuoteScreen, Receipt } from '../cajero/Proceso'
import { validDocument, validName, validPhone } from '../cajero/validate'

type Step =
  | 'idle'
  | 'fuera'
  | 'telefono'
  | 'nombre'
  | 'documento'
  | 'direccion'
  | 'billetes'
  | 'cotizacion'
  | 'procesando'
  | 'recibo'
  | 'devolucion'
  | 'error'

const EMPTY_CUSTOMER: Customer = { phone: '', fullName: '', documentNumber: '' }
const GRANT_POLL_MS = 5000

const rejectNotice = (bill: Bill, copPerUsdc: number | null) =>
  copPerUsdc === null
    ? 'Esperando la tasa del operador…'
    : `El billete de ${formatCop(bill)} supera el límite de 100 USDC por operación.`

const codeOf = (e: unknown): ApiErrorCode => (e instanceof ApiError ? e.code : 'backend_down')

export function Cajero() {
  const [step, setStep] = useState<Step>('idle')
  const [customer, setCustomer] = useState<Customer>(EMPTY_CUSTOMER)
  const [address, setAddress] = useState('')
  const [bills, setBills] = useState<Bill[]>([])
  const [lastInserted, setLastInserted] = useState<{ bill: Bill; seq: number } | null>(null)
  const [rejected, setRejected] = useState<{ bill: Bill; seq: number } | null>(null)
  const [copPerUsdc, setCopPerUsdc] = useState<number | null>(null)
  const [cashIn, setCashIn] = useState<CashIn | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiErrorCode | null>(null)
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    if (copPerUsdc !== null || (step !== 'idle' && step !== 'billetes')) return
    api.rate().then(
      (r) => setCopPerUsdc(Number(r.copPerUsdc)),
      () => setCopPerUsdc(null),
    )
  }, [step, copPerUsdc])

  // Out of service while the store has no active daily grant.
  useEffect(() => {
    if (step !== 'idle' && step !== 'fuera') return
    let live = true
    const check = () =>
      api.grant().then(
        (g) => {
          if (!live) return
          setOffline(false)
          setStep(g.status === 'active' ? 'idle' : 'fuera')
        },
        () => {
          if (!live) return
          setOffline(true)
          setStep('fuera')
        },
      )
    check()
    const t = setInterval(check, GRANT_POLL_MS)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [step])

  const canInsert = (bill: Bill) =>
    step === 'billetes' && copPerUsdc !== null && remaining(bills, bill) > 0 && fits(bills, bill, copPerUsdc)

  const insert = (bill: Bill) => {
    if (!canInsert(bill)) return
    setBills((prev) => [...prev, bill])
    setLastInserted((l) => ({ bill, seq: (l?.seq ?? 0) + 1 }))
    setRejected(null)
  }

  const reject = (bill: Bill) => setRejected((r) => ({ bill, seq: (r?.seq ?? 0) + 1 }))

  const reset = () => {
    setCustomer(EMPTY_CUSTOMER)
    setAddress('')
    setBills([])
    setLastInserted(null)
    setRejected(null)
    setCashIn(null)
    setError(null)
    setStep('idle')
  }

  const fail = (code: ApiErrorCode) => {
    setError(code)
    setStep('error')
  }

  const quote = async () => {
    setStep('cotizacion')
    setCashIn(null)
    setBusy(true)
    try {
      setCashIn(await api.createCashIn({ copAmount: String(total(bills)), stellarAddress: address, customer }))
    } catch (e) {
      fail(codeOf(e))
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (!cashIn) return
    setBusy(true)
    try {
      setCashIn(await api.confirmCashIn(cashIn.id))
      setStep('procesando')
    } catch (e) {
      const code = codeOf(e)
      if (code === 'quote_expired') await quote()
      else fail(code)
    } finally {
      setBusy(false)
    }
  }

  const cop = formatCop(total(bills))

  return (
    <div className="cajero-layout">
      <DropZone
        enabled={step === 'billetes'}
        lastInserted={step === 'billetes' ? lastInserted : null}
        rejected={step === 'billetes' ? rejected : null}
      >
        <div className="atm-screen">
          <div key={step} className="screen-in">
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

            {step === 'fuera' && (
              <>
                <p className="atm-kicker">Fuera de servicio</p>
                <h1>{offline ? 'Sin conexión' : 'Cajero sin autorización'}</h1>
                <p>{offline ? `${errorMessages.backend_down} Reintentando…` : errorMessages.no_grant}</p>
                {!offline && (
                  <a className="atm-link" href="/tienda">
                    Ir a la vista de la tienda
                  </a>
                )}
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
              <BillsScreen
                bills={bills}
                copPerUsdc={copPerUsdc}
                notice={rejected ? rejectNotice(rejected.bill, copPerUsdc) : undefined}
                onUndo={() => {
                  setBills(bills.slice(0, -1))
                  setRejected(null)
                }}
                onCancel={() => (bills.length ? setStep('devolucion') : reset())}
                onContinue={quote}
              />
            )}

            {step === 'cotizacion' && !cashIn && (
              <>
                <p className="atm-kicker">Cotización</p>
                <p className="atm-total">{cop} COP</p>
                <p className="atm-dim">Creando la solicitud de pago en Open Payments…</p>
              </>
            )}

            {step === 'cotizacion' && cashIn && (
              <QuoteScreen
                cashIn={cashIn}
                busy={busy}
                onConfirm={confirm}
                onRequote={quote}
                onCancel={() => setStep('devolucion')}
              />
            )}

            {step === 'procesando' && cashIn && (
              <ProcessingScreen
                initial={cashIn}
                onDone={(c) => {
                  setCashIn(c)
                  setStep('recibo')
                }}
                onReturnCash={() => setStep('devolucion')}
              />
            )}

            {step === 'recibo' && cashIn && <Receipt cashIn={cashIn} onFinish={reset} />}

            {step === 'devolucion' && (
              <>
                <p className="atm-kicker">Devolución</p>
                <h1>Retire sus billetes</h1>
                <p className="atm-total">{cop} COP</p>
                <p className="atm-dim">No se hizo ningún pago.</p>
                <button type="button" className="atm-btn" onClick={reset}>
                  Ya los retiré
                </button>
              </>
            )}

            {step === 'error' && error && (
              <>
                <p className="atm-kicker">No pudimos continuar</p>
                <h1>{error === 'backend_down' ? 'Sin conexión' : 'Operación rechazada'}</h1>
                <p>{errorMessages[error]}</p>
                <div className="atm-actions">
                  <button type="button" className="atm-btn atm-btn-ghost" onClick={() => setStep('devolucion')}>
                    Retirar mis billetes
                  </button>
                  {error === 'invalid_address' && (
                    <button type="button" className="atm-btn" onClick={() => setStep('direccion')}>
                      Corregir dirección
                    </button>
                  )}
                  {(error === 'backend_down' || error === 'insufficient_inventory') && (
                    <button type="button" className="atm-btn" onClick={quote}>
                      Reintentar
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </DropZone>

      {step === 'billetes' && <Wallet bills={bills} canInsert={canInsert} onInsert={insert} onReject={reject} />}
    </div>
  )
}
