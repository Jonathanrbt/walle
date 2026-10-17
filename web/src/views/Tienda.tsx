import { useEffect, useState } from 'react'
import { api, mockApi, type Grant } from '../api'
import { formatCop } from '../cajero/cash'
import { StoreScene } from '../iso/scenes'

const POLL_MS = 3000

const fmt = (amount?: string) => (amount ? formatCop(Number(amount)) : '—')
const time = (iso?: string) =>
  iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—'

/** Stand-in for the test wallet's GNAP consent screen, shown only with the simulated API. */
function MockConsent({ onAnswer }: { onAnswer: (ok: boolean) => void }) {
  return (
    <section className="panel consent" aria-label="Consentimiento simulado">
      <p className="consent-host">wallet.interledger-test.dev · simulado</p>
      <h1>Autorizar pagos del cajero</h1>
      <p>
        <strong>walle · Cajero</strong> solicita permiso para enviar pagos desde tu billetera COP al operador:
      </p>
      <ul>
        <li>Hasta {formatCop(2_000_000)} COP por día</li>
        <li>Válido por 24 horas (intervalo P1D)</li>
        <li>Destino: billetera del operador</li>
      </ul>
      <div className="row">
        <button type="button" className="btn btn-ghost" onClick={() => onAnswer(false)}>
          Rechazar
        </button>
        <button type="button" className="btn" onClick={() => onAnswer(true)}>
          Aceptar
        </button>
      </div>
    </section>
  )
}

export function Tienda() {
  const params = new URLSearchParams(location.search)
  const [consent, setConsent] = useState(!!mockApi && params.get('consentimiento') === 'simulado')
  const [result, setResult] = useState(params.get('grant'))
  const [grant, setGrant] = useState<Grant | null>(null)
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    let live = true
    const load = () =>
      api.grant().then(
        (g) => {
          if (!live) return
          setGrant(g)
          setOffline(false)
        },
        () => live && setOffline(true),
      )
    load()
    const t = setInterval(load, POLL_MS)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [result, consent])

  const answer = async (ok: boolean) => {
    if (ok) setGrant(await mockApi!.approveGrant())
    const outcome = ok ? 'ok' : 'error'
    history.replaceState(null, '', `/tienda?grant=${outcome}`)
    setConsent(false)
    setResult(outcome)
  }

  if (consent) return <MockConsent onAnswer={answer} />

  const active = grant?.status === 'active'
  const spent = Number(grant?.spentCop ?? 0)
  const limit = Number(grant?.limitCop ?? 0)

  return (
    <section className="panel">
      <div className="panel-grid">
        <StoreScene active={active} />
        <div>
          <p className="kicker">Tienda · punto de efectivo</p>
          <h1>Autorización diaria de pagos</h1>
          <p className="dim">
            Cada ingreso de efectivo se liquida al operador desde la billetera de Open Payments de la tienda. Un solo
            consentimiento (grant GNAP) cubre todo el día hasta el límite.
          </p>

          {result === 'ok' && (
            <p className="banner banner-ok">Autorización aprobada. El cajero ya puede recibir efectivo.</p>
          )}
          {result === 'error' && (
            <p className="banner banner-error">No se aprobó la autorización. El cajero sigue fuera de servicio.</p>
          )}
          {offline && <p className="banner banner-error">Sin conexión con el backend.</p>}

          <div className="stats">
            <div className="stat">
              <span>Estado</span>
              <strong className={active ? 'ok' : 'error'}>
                {!grant ? '…' : active ? 'Activa' : grant.status === 'expired' ? 'Vencida' : 'Sin autorizar'}
              </strong>
            </div>
            <div className="stat">
              <span>Usado hoy</span>
              <strong>
                {fmt(grant?.spentCop)} / {fmt(grant?.limitCop)}
              </strong>
            </div>
            <div className="stat">
              <span>Vence</span>
              <strong>{time(grant?.expiresAt)}</strong>
            </div>
          </div>
          {limit > 0 && (
            <div
              className="atm-meter"
              role="meter"
              aria-label="Límite diario usado"
              aria-valuemin={0}
              aria-valuemax={limit}
              aria-valuenow={spent}
            >
              <span style={{ width: `${Math.min(100, (spent / limit) * 100)}%` }} />
            </div>
          )}

          <div className="row">
            <a className="btn" href={api.grantStartUrl}>
              {active ? 'Renovar autorización' : 'Autorizar el día'}
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
