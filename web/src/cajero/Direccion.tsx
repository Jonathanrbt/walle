import { getNetwork, isConnected, requestAccess } from '@stellar/freighter-api'
import { useState } from 'react'
import { shortAddress, validStellarAddress } from './validate'

/** Asks for the customer's Stellar address: from Freighter (Testnet) or pasted. */
export function AddressStep({
  value,
  onChange,
  onNext,
  onBack,
}: {
  value: string
  onChange: (v: string) => void
  onNext: () => void
  onBack: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const valid = validStellarAddress(value)

  const connect = async () => {
    setBusy(true)
    setNotice(null)
    try {
      if (!(await isConnected()).isConnected) {
        setNotice('Freighter no está instalado en este navegador. Pega tu dirección abajo.')
        return
      }
      const access = await requestAccess()
      if (access.error || !access.address) {
        setNotice('Freighter no compartió la dirección. Puedes pegarla abajo.')
        return
      }
      onChange(access.address)
      const net = await getNetwork()
      if (net.network !== 'TESTNET') setNotice(`Freighter está en ${net.network || 'otra red'}: cámbialo a Testnet para ver el USDC.`)
    } catch {
      setNotice('No se pudo hablar con Freighter. Pega tu dirección abajo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="atm-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) onNext()
      }}
    >
      <p className="atm-kicker">Paso 4 de 5 · Billetera de destino</p>
      <p className="atm-label">¿A qué billetera Stellar enviamos tus USDC?</p>
      <button type="button" className="atm-btn atm-btn-wide" onClick={connect} disabled={busy}>
        {busy ? 'Conectando…' : 'Conectar Freighter'}
      </button>
      {notice && (
        <p className="atm-notice" role="status">
          {notice}
        </p>
      )}
      <label className="atm-dim" htmlFor="atm-address">
        o pega tu dirección pública (empieza por G)
      </label>
      <input
        id="atm-address"
        className={`atm-input atm-input-mono${value && !valid ? ' atm-input-bad' : ''}`}
        value={value}
        placeholder="G…"
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value.trim().toUpperCase())}
        aria-invalid={!!value && !valid}
      />
      {valid && <p className="atm-ok">✓ Enviaremos a {shortAddress(value)}</p>}
      <div className="atm-actions">
        <button type="button" className="atm-btn atm-btn-ghost" onClick={onBack}>
          Atrás
        </button>
        <button type="submit" className="atm-btn" disabled={!valid}>
          Continuar
        </button>
      </div>
    </form>
  )
}
