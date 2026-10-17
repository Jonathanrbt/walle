import { DomainError } from '../../shared/errors.ts'
import { money, type Money } from '../../shared/money.ts'
import { PaymentsNetworkError } from '../../cash-in/payments-network.ts'

export interface SdkAmount {
  readonly value: string
  readonly assetCode: string
  readonly assetScale: number
}

export function toSdkAmount(value: Money): SdkAmount {
  return {
    value: value.amount.toString(),
    assetCode: value.assetCode,
    assetScale: value.assetScale,
  }
}

export function fromSdkAmount(amount: SdkAmount): Money {
  if (!/^\d+$/.test(amount.value)) {
    throw new PaymentsNetworkError('unavailable', 'amount value was not an integer')
  }
  try {
    return money(BigInt(amount.value), amount.assetCode, amount.assetScale)
  } catch (error) {
    if (error instanceof DomainError) {
      throw new PaymentsNetworkError('unavailable', 'amount was not a valid minor-unit value')
    }
    throw error
  }
}
