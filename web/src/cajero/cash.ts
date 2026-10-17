/** Colombian banknotes in circulation, in COP. */
export const DENOMINATIONS = [2000, 5000, 10000, 20000, 50000, 100000] as const
export type Bill = (typeof DENOMINATIONS)[number]

/** Bills the customer starts with in the interactive wallet. */
export const WALLET: Record<Bill, number> = { 2000: 5, 5000: 4, 10000: 4, 20000: 3, 50000: 4, 100000: 2 }

/** Tier 1 per-transaction limit from PROJECT.md, in USDC cents. */
export const TIER1_TX_USDC_CENTS = 100_00

export const total = (bills: Bill[]) => bills.reduce((sum, b) => sum + b, 0)

export const usdcCents = (cop: number, copPerUsdc: number) => Math.floor((cop * 100) / copPerUsdc)

/** Whether one more bill keeps the cash-in within the tier 1 per-transaction limit. */
export const fits = (bills: Bill[], bill: Bill, copPerUsdc: number) =>
  usdcCents(total(bills) + bill, copPerUsdc) <= TIER1_TX_USDC_CENTS

export const remaining = (bills: Bill[], bill: Bill) => WALLET[bill] - bills.filter((b) => b === bill).length

export const grouped = (bills: Bill[]) =>
  DENOMINATIONS.map((d) => ({ bill: d, count: bills.filter((b) => b === d).length })).filter((g) => g.count > 0)

export const formatCop = (cop: number) => `$${cop.toLocaleString('es-CO')}`
export const formatUsdc = (cents: number) => (cents / 100).toFixed(2)
