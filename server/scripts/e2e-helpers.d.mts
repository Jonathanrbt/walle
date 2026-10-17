export function parseArgs(argv: readonly string[]): {
  address: string
  copAmount: string
  base: string
}

export function syntheticCustomer(nowMs: number): {
  phone: string
  fullName: string
  documentNumber: string
}

export function derivePhases(cashIn: {
  status: string
  openPayments?: { outgoingPaymentId?: string; incomingCompleted?: boolean }
}): {
  solicitud: string
  autorizacion: string
  ejecucion: string
  finalizacion: string
  stellar: string
}

export function formatQuote(cashIn: {
  copAmount: string
  usdcAmount: string
  copPerUsdc: string
  expiresAt: string
}): string

export function formatStatusLine(
  cashIn: {
    status: string
    openPayments?: { outgoingPaymentId?: string; incomingCompleted?: boolean }
  },
  elapsedMs: number,
): string

export function formatInventory(
  label: string,
  inventory: { usdc: string; floatUsdc: string; lowThresholdPct: number },
): string

export function usdcDelta(before: string, after: string): string

export function missingGrantMessage(base: string): string

export function retryHint(base: string, id: string): string

export function terminalExit(status: string): number | undefined
