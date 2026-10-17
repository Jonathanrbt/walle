import type { ApiErrorCode, CashIn } from '../api/types'

export type PhaseState = 'done' | 'active' | 'pending' | 'error'
export type Phase = { key: string; label: string; detail: string; state: PhaseState }

/** The four Open Payments phases the demo must show, plus the Stellar delivery. */
export function phases(c: CashIn): Phase[] {
  const s = c.status
  const confirmed = s !== 'quoted' && s !== 'expired'
  const settled = c.openPayments.incomingCompleted
  return [
    {
      key: 'solicitud',
      label: 'Solicitud de pago',
      detail: 'Incoming payment del operador y quote del cajero',
      state: 'done',
    },
    {
      key: 'autorizacion',
      label: 'Autorización',
      detail: 'Grant GNAP diario del cajero',
      state: confirmed ? 'done' : s === 'expired' ? 'error' : 'active',
    },
    {
      key: 'ejecucion',
      label: 'Ejecución del pago',
      detail: 'Outgoing payment cajero → operador',
      state: s === 'failed_payment' ? 'error' : settled ? 'done' : s === 'settling' ? 'active' : 'pending',
    },
    {
      key: 'finalizacion',
      label: 'Finalización',
      detail: 'El operador recibe el pago completo',
      state: settled ? 'done' : 'pending',
    },
    {
      key: 'stellar',
      label: 'USDC en tu billetera',
      detail: 'Envío en Stellar testnet',
      state:
        s === 'completed' ? 'done' : s === 'failed_stellar' ? 'error' : s === 'sending_usdc' || s === 'settled' ? 'active' : 'pending',
    },
  ]
}

export const isTerminal = (c: CashIn) => ['completed', 'failed_payment', 'failed_stellar', 'expired'].includes(c.status)

export const errorMessages: Record<ApiErrorCode, string> = {
  limit_exceeded: 'Supera tu límite de nivel 1: 100 USDC por operación, 150 por día y 500 por mes.',
  no_grant: 'El cajero no tiene autorización de pagos para hoy. La tienda debe autorizar el día.',
  grant_exhausted: 'El cajero alcanzó su límite diario de pagos.',
  invalid_address: 'La dirección Stellar no es válida.',
  insufficient_inventory: 'El operador no tiene USDC suficientes en este momento.',
  quote_expired: 'La cotización venció.',
  not_found: 'No encontramos esta operación.',
  backend_down: 'Sin conexión con el operador.',
}
