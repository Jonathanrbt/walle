import { useEffect, useState } from 'react'
import { api, ApiError, type CashIn } from '../api'
import { apiMock } from '../config'
import { PhaseCube } from '../iso/scenes'
import { formatCop } from './cash'
import { isTerminal, phases } from './phases'
import { shortAddress } from './validate'

const POLL_MS = 1000

const cop = (amount: string) => formatCop(Number(amount))
const stellarTxUrl = (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`

function useCountdown(until: string) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [])
  return Math.max(0, Math.ceil((Date.parse(until) - now) / 1000))
}

export function QuoteScreen({
  cashIn,
  busy,
  onConfirm,
  onRequote,
  onCancel,
}: {
  cashIn: CashIn
  busy: boolean
  onConfirm: () => void
  onRequote: () => void
  onCancel: () => void
}) {
  const left = useCountdown(cashIn.expiresAt)
  const expired = left === 0

  return (
    <>
      <p className="atm-kicker">Cotización · Solicitud de pago creada</p>
      <dl className="atm-quote">
        <dt>Entregas</dt>
        <dd>{cop(cashIn.copAmount)} COP</dd>
        <dt>Tasa</dt>
        <dd>1 USDC = {cop(cashIn.copPerUsdc)}</dd>
        <dt>Recibes</dt>
        <dd className="atm-quote-usdc">{cashIn.usdcAmount} USDC</dd>
        <dt>En</dt>
        <dd>{shortAddress(cashIn.stellarAddress)}</dd>
      </dl>
      <p className={expired ? 'atm-notice' : 'atm-dim'} aria-live="polite">
        {expired ? 'La cotización venció.' : `Precio garantizado por ${left} s.`}
      </p>
      <div className="atm-actions">
        <button type="button" className="atm-btn atm-btn-ghost" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
        {expired ? (
          <button type="button" className="atm-btn" onClick={onRequote} disabled={busy}>
            Recotizar
          </button>
        ) : (
          <button type="button" className="atm-btn" onClick={onConfirm} disabled={busy}>
            {busy ? 'Confirmando…' : 'Confirmar'}
          </button>
        )}
      </div>
    </>
  )
}

/** Live Open Payments + Stellar progress; polls the cash-in until it settles or fails. */
export function ProcessingScreen({
  initial,
  onDone,
  onReturnCash,
}: {
  initial: CashIn
  onDone: (c: CashIn) => void
  onReturnCash: () => void
}) {
  const [cashIn, setCashIn] = useState(initial)
  const [offline, setOffline] = useState(false)
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    if (isTerminal(cashIn)) return
    const t = setTimeout(async () => {
      try {
        setCashIn(await api.getCashIn(cashIn.id))
        setOffline(false)
      } catch (e) {
        if (e instanceof ApiError && e.code === 'backend_down') setOffline(true)
        setCashIn({ ...cashIn })
      }
    }, POLL_MS)
    return () => clearTimeout(t)
  }, [cashIn])

  const retry = async () => {
    setRetrying(true)
    try {
      setCashIn(await api.retryCashIn(cashIn.id))
    } catch {
      setOffline(true)
    } finally {
      setRetrying(false)
    }
  }

  return (
    <>
      <p className="atm-kicker">
        Procesando · {cop(cashIn.copAmount)} COP → {cashIn.usdcAmount} USDC
      </p>
      <ol className="timeline">
        {phases(cashIn).map((p) => (
          <li key={p.key} className={`phase phase-${p.state}`} aria-current={p.state === 'active' ? 'step' : undefined}>
            <PhaseCube state={p.state} />
            <span>
              <strong>{p.label}</strong>
              <small>{p.detail}</small>
            </span>
          </li>
        ))}
      </ol>
      {offline && <p className="atm-notice">Reconectando con el operador…</p>}

      {cashIn.status === 'failed_payment' && (
        <>
          <p className="atm-notice">El pago por Open Payments no se completó. No se movió dinero.</p>
          <div className="atm-actions">
            <button type="button" className="atm-btn" onClick={onReturnCash}>
              Retirar mis billetes
            </button>
          </div>
        </>
      )}

      {cashIn.status === 'failed_stellar' && (
        <>
          <p className="atm-notice">
            El operador ya recibió el pago, pero el envío en Stellar falló. Tus USDC quedan pendientes.
          </p>
          <div className="atm-actions">
            <button type="button" className="atm-btn atm-btn-ghost" onClick={() => onDone(cashIn)}>
              Ver comprobante
            </button>
            <button type="button" className="atm-btn" onClick={retry} disabled={retrying}>
              {retrying ? 'Reintentando…' : 'Reintentar envío'}
            </button>
          </div>
        </>
      )}

      {cashIn.status === 'completed' && (
        <div className="atm-actions">
          <button type="button" className="atm-btn" onClick={() => onDone(cashIn)}>
            Ver comprobante
          </button>
        </div>
      )}
    </>
  )
}

export function Receipt({ cashIn, onFinish }: { cashIn: CashIn; onFinish: () => void }) {
  const done = cashIn.status === 'completed'
  return (
    <>
      <div className="ticket">
        <p className="atm-kicker">Comprobante</p>
        <h1 className={done ? 'atm-ok' : 'atm-notice'}>
          {done ? '¡Listo! Tus USDC llegaron' : 'USDC pendientes de envío'}
        </h1>
        <dl className="atm-quote">
          <dt>Entregaste</dt>
          <dd>{cop(cashIn.copAmount)} COP</dd>
          <dt>Recibiste</dt>
          <dd className="atm-quote-usdc">{cashIn.usdcAmount} USDC</dd>
          <dt>Billetera</dt>
          <dd>{shortAddress(cashIn.stellarAddress)}</dd>
          <dt>Memo</dt>
          <dd>{cashIn.memo}</dd>
          <dt>Operación</dt>
          <dd>{cashIn.id.slice(0, 8)}</dd>
        </dl>
        {cashIn.stellarTxHash && (
          <p className="atm-dim">
            Transacción:{' '}
            <a className="atm-link" href={stellarTxUrl(cashIn.stellarTxHash)} target="_blank" rel="noreferrer">
              {cashIn.stellarTxHash.slice(0, 12)}…
            </a>
            {apiMock && ' (simulada)'}
          </p>
        )}
        <p className="atm-dim">
          {done ? 'Ábrelos en Freighter (Testnet).' : 'Guarda este comprobante: el operador reintentará el envío.'}
        </p>
      </div>
      <div className="atm-actions">
        <button type="button" className="atm-btn" onClick={onFinish}>
          Terminar
        </button>
      </div>
    </>
  )
}
