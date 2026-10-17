import type { CashIn as CashInDto } from '@walle/contracts'

import type { CashIn } from '../../cash-in/domain/cash-in.ts'
import { formatDecimal } from '../../shared/money.ts'

/** Domain cash-in to the public contract. Internal fields (customer, envelope, version) never leave. */
export function toCashInDto(cashIn: CashIn): CashInDto {
  return {
    id: cashIn.id,
    status: cashIn.status,
    copAmount: formatDecimal(cashIn.cop),
    usdcAmount: formatDecimal(cashIn.usdc),
    copPerUsdc: formatDecimal(cashIn.copPerUsdc),
    expiresAt: cashIn.expiresAt.toISOString(),
    stellarAddress: cashIn.stellarAddress,
    memo: cashIn.memo,
    openPayments: {
      incomingPaymentUrl: cashIn.openPayments.incomingPaymentUrl,
      quoteId: cashIn.openPayments.quoteId,
      ...(cashIn.openPayments.outgoingPaymentId === undefined
        ? {}
        : { outgoingPaymentId: cashIn.openPayments.outgoingPaymentId }),
      incomingCompleted: cashIn.openPayments.incomingCompleted,
    },
    ...(cashIn.stellarTxHash === undefined ? {} : { stellarTxHash: cashIn.stellarTxHash }),
    createdAt: cashIn.createdAt.toISOString(),
  }
}
