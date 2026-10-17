import { useEffect, useState } from 'react'
import { api, type CashIn, type CashInStatus, type Inventory } from '../api'
import { formatCop } from '../cajero/cash'
import { shortAddress } from '../cajero/validate'
import { ServerScene } from '../iso/scenes'

const POLL_MS = 2000

const STATUS: Record<CashInStatus, { label: string; tone: string }> = {
  quoted: { label: 'Cotizado', tone: 'dim' },
  settling: { label: 'Pagando (OP)', tone: 'warn' },
  settled: { label: 'Liquidado (OP)', tone: 'warn' },
  sending_usdc: { label: 'Enviando USDC', tone: 'warn' },
  completed: { label: 'Completado', tone: 'ok' },
  failed_payment: { label: 'Pago fallido', tone: 'error' },
  failed_stellar: { label: 'USDC pendiente', tone: 'error' },
  expired: { label: 'Vencido', tone: 'dim' },
}

export function Operador() {
  const [cashIns, setCashIns] = useState<CashIn[] | null>(null)
  const [inventory, setInventory] = useState<Inventory | null>(null)
  const [offline, setOffline] = useState(false)
  const [refilling, setRefilling] = useState(false)

  const load = () =>
    Promise.all([api.operatorCashIns(), api.inventory()]).then(
      ([c, i]) => {
        setCashIns(c)
        setInventory(i)
        setOffline(false)
      },
      () => setOffline(true),
    )

  useEffect(() => {
    load()
    const t = setInterval(load, POLL_MS)
    return () => clearInterval(t)
  }, [])

  const refill = async () => {
    setRefilling(true)
    try {
      await api.refill()
      await load()
    } catch {
      setOffline(true)
    } finally {
      setRefilling(false)
    }
  }

  const usdc = Number(inventory?.usdc ?? 0)
  const float = Number(inventory?.floatUsdc ?? 0)
  const pct = float ? (usdc / float) * 100 : 0
  const low = !!inventory && pct < inventory.lowThresholdPct
  const settled = (cashIns ?? []).filter((c) => c.openPayments.incomingCompleted)
  const settledCop = settled.reduce((sum, c) => sum + Number(c.copAmount), 0)

  return (
    <section className="panel">
      <div className="panel-grid">
        <ServerScene pct={pct} low={low} />
        <div>
          <p className="kicker">Operador</p>
          <h1>Liquidación e inventario</h1>
          {offline && <p className="banner banner-error">Sin conexión con el backend.</p>}
          {low && (
            <p className="banner banner-warn">
              Inventario por debajo del {inventory!.lowThresholdPct}%: reponer USDC con los COP liquidados.
            </p>
          )}

          <div className="stats">
            <div className="stat">
              <span>Inventario USDC</span>
              <strong className={low ? 'error' : undefined}>
                {inventory ? `${inventory.usdc} / ${inventory.floatUsdc}` : '…'}
              </strong>
            </div>
            <div className="stat">
              <span>Recibido por Open Payments</span>
              <strong>{formatCop(settledCop)} COP</strong>
            </div>
            <div className="stat">
              <span>Ingresos liquidados</span>
              <strong>{settled.length}</strong>
            </div>
          </div>
          <div
            className="atm-meter"
            role="meter"
            aria-label="Inventario de USDC"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
          >
            <span style={{ width: `${Math.min(100, pct)}%`, background: low ? 'var(--danger)' : undefined }} />
          </div>
          <div className="row">
            <button type="button" className="btn" onClick={refill} disabled={refilling || !inventory || usdc >= float}>
              {refilling ? 'Reponiendo…' : 'Reponer USDC'}
            </button>
          </div>
        </div>
      </div>

      <h2>Pagos recibidos</h2>
      {cashIns && cashIns.length === 0 && <p className="dim">Aún no hay ingresos de efectivo confirmados.</p>}
      {cashIns && cashIns.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Hora</th>
                <th>COP</th>
                <th>USDC</th>
                <th>Estado</th>
                <th>Cliente</th>
                <th>Memo</th>
              </tr>
            </thead>
            <tbody>
              {cashIns.map((c) => (
                <tr key={c.id}>
                  <td>{new Date(c.createdAt).toLocaleTimeString('es-CO', { timeStyle: 'short' })}</td>
                  <td>{formatCop(Number(c.copAmount))}</td>
                  <td>{c.usdcAmount}</td>
                  <td className={STATUS[c.status].tone}>{STATUS[c.status].label}</td>
                  <td className="mono">{shortAddress(c.stellarAddress)}</td>
                  <td className="mono">
                    {c.stellarTxHash ? (
                      <a
                        href={`https://stellar.expert/explorer/testnet/tx/${c.stellarTxHash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {c.memo}
                      </a>
                    ) : (
                      c.memo
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
