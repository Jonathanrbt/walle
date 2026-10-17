# Contratos entre miembros

Acuerden aquí antes de que dos personas construyan una contra la otra. Cada entrada, corta: proveedor, consumidor, forma, estado.

## API del cajero (proveedor: backend, por asignar · consumidor: andss-ye, `web/`)
Estado: **propuesto**. El front lo simula en `web/` hasta que el backend lo acepte o lo cambie aquí.
Montos como string decimal (`"100000"` COP, `"24.27"` USDC). Fechas ISO 8601.

### GET /api/rate
Respuesta: `{ copPerUsdc: string, spreadPct: number, quotedAt: string }`. `copPerUsdc` ya incluye el margen.

### POST /api/cash-ins
Solicitud: `{ copAmount: string, stellarAddress: string, customer: { phone: string, fullName: string, documentNumber: string } }`
Respuesta 201: `CashIn` en `status: "quoted"` (crea el `incoming payment` del operador y el `quote` del cajero).
Errores 4xx: `ApiError` con `"limit_exceeded" | "no_grant" | "grant_exhausted" | "invalid_address" | "insufficient_inventory"`

### POST /api/cash-ins/:id/confirm
Respuesta 202: `CashIn` en `status: "settling"` (crea el `outgoing payment` con el `grant` diario).
Errores 4xx: `ApiError` con `"quote_expired" | "no_grant" | "grant_exhausted"`.

### POST /api/cash-ins/:id/retry
Respuesta 202: `CashIn`. Solo válido en `failed_stellar`.

### GET /api/cash-ins/:id
Respuesta: `CashIn`. El front sondea cada ~1 s hasta `completed` o un `failed_*`.

```ts
type CashIn = {
  id: string
  status: "quoted" | "settling" | "settled" | "sending_usdc" | "completed"
        | "failed_payment" | "failed_stellar" | "expired"
  copAmount: string; usdcAmount: string; copPerUsdc: string; expiresAt: string
  stellarAddress: string; memo: string
  openPayments: { incomingPaymentUrl: string; quoteId: string; outgoingPaymentId?: string; incomingCompleted: boolean }
  stellarTxHash?: string
  createdAt: string
}

type ApiError = { error: string; detail?: string }
```

### GET /api/grant
Respuesta: `{ status: "active" | "missing" | "expired", limitCop?: string, spentCop?: string, expiresAt?: string }`

### GET /api/grant/start → 302 a `interact.redirect`
### GET /api/grant/finish?hash&interact_ref → verifica `hash`, `grant.continue`, 302 a `/tienda?grant=ok|error`

### GET /api/operator/cash-ins
Respuesta: `CashIn[]`, los más recientes primero.

### GET /api/operator/inventory
Respuesta: `{ usdc: string, floatUsdc: string, lowThresholdPct: number }`

### POST /api/operator/inventory/refill
Respuesta: `{ usdc: string }` (rellena USDC de testnet hasta el flotante).

<!-- Ejemplo
## POST /api/pay  (proveedor: ana, consumidor: luis)
Solicitud: { receiverWalletAddress: string, amount: string }
Respuesta: { redirectUrl: string }
Estado: acordado
-->
