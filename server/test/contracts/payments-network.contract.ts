import { beforeAll, describe, expect, it } from 'vitest'

import { money } from '../../src/shared/money.ts'
import { PaymentsNetworkError, type PaymentsNetwork } from '../../src/cash-in/payments-network.ts'

const COP = (majorUnitsTimes100: bigint) => money(majorUnitsTimes100, 'COP', 2)
const QUOTE_TTL_MS = 300_000

export function runPaymentsNetworkContract(
  name: string,
  makeSubject: () => Promise<PaymentsNetwork>,
): void {
  describe(name, () => {
    let network: PaymentsNetwork | undefined

    beforeAll(async () => {
      network = await makeSubject()
    })

    function subject(): PaymentsNetwork {
      if (network === undefined) throw new Error('payments network was not created')
      return network
    }

    it('quotes a fixed COP debit into a positive USD receive', async () => {
      const incoming = await subject().createIncomingPayment({})
      const quotedAt = Date.now()
      const quote = await subject().createQuote({
        incomingPaymentUrl: incoming.url,
        debit: COP(10_000_000n),
      })
      const seen = await subject().getIncomingPayment(incoming.url)

      expect(quote.receive.assetCode).toBe('USD')
      expect(quote.receive.assetScale).toBe(2)
      expect(quote.receive.amount > 0n).toBe(true)
      const ttl = quote.expiresAt.getTime() - quotedAt
      expect(ttl).toBeGreaterThanOrEqual(QUOTE_TTL_MS - 60_000)
      expect(ttl).toBeLessThanOrEqual(QUOTE_TTL_MS + 60_000)
      expect(seen.completed).toBe(false)
      expect(seen.received.amount).toBe(0n)
      expect(seen.received.assetCode).toBe('USD')
      expect(seen.received.assetScale).toBe(2)
    })

    it('rejects a quote below the minimum debit', async () => {
      const incoming = await subject().createIncomingPayment({})
      const quote = subject().createQuote({
        incomingPaymentUrl: incoming.url,
        debit: COP(1n),
      })
      await expect(quote).rejects.toBeInstanceOf(PaymentsNetworkError)
      await expect(quote).rejects.toMatchObject({ kind: 'rejected' })
    })
  })
}
