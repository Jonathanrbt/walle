export function Cajero() {
  return (
    <section className="atm" aria-label="Cajero de efectivo a USDC">
      <div className="atm-screen">
        <p className="atm-kicker">Efectivo → USDC en Stellar</p>
        <h1>Bienvenido</h1>
        <p>Toca la pantalla para empezar.</p>
      </div>
      <div className="atm-slot" aria-hidden="true" />
    </section>
  )
}
