import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  ApiError,
  ApiErrorCode,
  CashIn,
  CashInRequest,
  CashInStatus,
  Customer,
  DecimalString,
  FrontApiErrorCode,
  Grant,
  GrantFinishQuery,
  Inventory,
  IsoDateTime,
  OpenPaymentsInfo,
  Rate,
  RefillResult,
  StellarAddress,
  httpStatusFor,
} from './index.ts'

const ADDRESS = `G${'A'.repeat(55)}`
const AT = '2026-10-17T05:00:00.000Z'
const LATER = '2026-10-17T05:01:00.000Z'

const CUSTOMER = {
  phone: '3001234567',
  fullName: 'Ana Perez',
  documentNumber: '1234567890',
}

function cashIn(
  status: CashIn['status'],
  options?: { outgoing?: string; hash?: string; completed?: boolean },
) {
  const openPayments: CashIn['openPayments'] = {
    incomingPaymentUrl: 'https://ilp.example.test/incoming-payments/1',
    quoteId: 'quote-1',
    incomingCompleted: options?.completed ?? false,
  }
  if (options?.outgoing !== undefined) openPayments.outgoingPaymentId = options.outgoing
  const value: CashIn = {
    id: 'cash-in-1',
    status,
    copAmount: '100000',
    usdcAmount: '24.27',
    copPerUsdc: '4120',
    expiresAt: LATER,
    stellarAddress: ADDRESS,
    memo: 'walle-cashin1',
    openPayments,
    createdAt: AT,
  }
  if (options?.hash !== undefined) value.stellarTxHash = options.hash
  return value
}

describe('DecimalString', () => {
  it.each(['0', '24.27', '100000', '0.0'])('accepts %j', (value) => {
    expect(DecimalString.parse(value)).toBe(value)
  })

  it.each(['.5', '1e3', '-1', '', '1.', '+1', ' 1', '1.2.3'])('rejects %j', (value) => {
    expect(DecimalString.safeParse(value).success).toBe(false)
  })
})

describe('IsoDateTime', () => {
  it.each([
    '2026-10-17T05:48:00Z',
    '2026-10-17T00:48:00.123Z',
    '2026-10-17T00:48:00-05:00',
    '2026-10-17T00:48:00+00:00',
  ])('accepts %j', (value) => {
    expect(IsoDateTime.parse(value)).toBe(value)
  })

  it.each([
    '',
    '2026-10-17T05:48:00',
    '2026-10-17',
    '2026-02-30T00:00:00Z',
    '2026-10-17 05:48:00Z',
  ])('rejects %j', (value) => {
    expect(IsoDateTime.safeParse(value).success).toBe(false)
  })
})

describe('StellarAddress', () => {
  it('accepts a StrKey-shaped account id without checking the checksum', () => {
    expect(StellarAddress.parse(ADDRESS)).toBe(ADDRESS)
  })

  it.each([
    '',
    'G',
    `G${'A'.repeat(54)}`,
    `g${'A'.repeat(55)}`,
    `S${'A'.repeat(55)}`,
    `G${'A'.repeat(54)}0`,
  ])('rejects %j', (value) => {
    expect(StellarAddress.safeParse(value).success).toBe(false)
  })
})

describe('CashInStatus', () => {
  it.each([
    'quoted',
    'settling',
    'settled',
    'sending_usdc',
    'completed',
    'failed_payment',
    'failed_stellar',
    'expired',
  ] as const)('accepts %s', (status) => {
    expect(CashInStatus.parse(status)).toBe(status)
  })

  it('rejects an unknown status', () => {
    expect(CashInStatus.safeParse('pending').success).toBe(false)
  })
})

describe('Customer', () => {
  it('accepts a cashier customer', () => {
    expect(Customer.parse(CUSTOMER)).toEqual(CUSTOMER)
    expect(Customer.parse({ ...CUSTOMER, fullName: '  Ana   Perez  ' }).fullName).toBe(
      '  Ana   Perez  ',
    )
  })

  it.each([
    { ...CUSTOMER, phone: '2001234567' },
    { ...CUSTOMER, phone: '300123456' },
    { ...CUSTOMER, phone: '30012345678' },
    { ...CUSTOMER, phone: '' },
    { ...CUSTOMER, fullName: 'Ana' },
    { ...CUSTOMER, fullName: 'A Perez' },
    { ...CUSTOMER, fullName: 'Ana P' },
    { ...CUSTOMER, fullName: '' },
    { ...CUSTOMER, documentNumber: '12345' },
    { ...CUSTOMER, documentNumber: '12345678901' },
    { ...CUSTOMER, documentNumber: '' },
    { ...CUSTOMER, documentNumber: '123456a' },
  ])('rejects %j', (value) => {
    expect(Customer.safeParse(value).success).toBe(false)
  })

  it('accepts the document length bounds', () => {
    expect(Customer.parse({ ...CUSTOMER, documentNumber: '123456' }).documentNumber).toBe('123456')
    expect(Customer.parse({ ...CUSTOMER, documentNumber: '1234567890' }).documentNumber).toBe(
      '1234567890',
    )
  })
})

describe('CashInRequest', () => {
  const request = { copAmount: '100000', stellarAddress: ADDRESS, customer: CUSTOMER }

  it('accepts a create payload', () => {
    expect(CashInRequest.parse(request)).toEqual(request)
  })

  it('rejects a bad amount, address, or customer', () => {
    expect(CashInRequest.safeParse({ ...request, copAmount: '-1' }).success).toBe(false)
    expect(CashInRequest.safeParse({ ...request, stellarAddress: 'not-an-address' }).success).toBe(
      false,
    )
    expect(
      CashInRequest.safeParse({ ...request, customer: { ...CUSTOMER, phone: '' } }).success,
    ).toBe(false)
  })
})

describe('OpenPaymentsInfo', () => {
  it('accepts a quote without an outgoing payment', () => {
    const info = {
      incomingPaymentUrl: 'https://ilp.example.test/incoming-payments/1',
      quoteId: 'quote-1',
      incomingCompleted: false,
    }
    expect(OpenPaymentsInfo.parse(info)).toEqual(info)
    expect(OpenPaymentsInfo.parse(info)).not.toHaveProperty('outgoingPaymentId')
  })

  it('accepts an outgoing payment id when present', () => {
    const info = {
      incomingPaymentUrl: 'https://ilp.example.test/incoming-payments/1',
      quoteId: 'quote-1',
      outgoingPaymentId: 'outgoing-1',
      incomingCompleted: true,
    }
    expect(OpenPaymentsInfo.parse(info)).toEqual(info)
  })

  it('rejects a missing url and an explicit undefined outgoing id', () => {
    expect(
      OpenPaymentsInfo.safeParse({ quoteId: 'quote-1', incomingCompleted: false }).success,
    ).toBe(false)
    expect(
      OpenPaymentsInfo.safeParse({
        incomingPaymentUrl: 'https://ilp.example.test/incoming-payments/1',
        quoteId: 'quote-1',
        outgoingPaymentId: undefined,
        incomingCompleted: false,
      }).success,
    ).toBe(false)
  })
})

describe('CashIn', () => {
  it.each([
    ['quoted', cashIn('quoted')],
    ['settling', cashIn('settling', { outgoing: 'outgoing-1' })],
    ['settled', cashIn('settled', { outgoing: 'outgoing-1', completed: true })],
    ['sending_usdc', cashIn('sending_usdc', { outgoing: 'outgoing-1', completed: true })],
    [
      'completed',
      cashIn('completed', { outgoing: 'outgoing-1', completed: true, hash: 'a'.repeat(64) }),
    ],
    ['failed_payment', cashIn('failed_payment', { outgoing: 'outgoing-1' })],
    ['failed_stellar', cashIn('failed_stellar', { outgoing: 'outgoing-1', completed: true })],
    ['expired', cashIn('expired')],
  ] as const)('parses a realistic %s cash-in', (_status, value) => {
    expect(CashIn.parse(value)).toEqual(value)
  })

  it('rejects a non-decimal amount and an explicit undefined tx hash', () => {
    expect(CashIn.safeParse({ ...cashIn('quoted'), usdcAmount: '.5' }).success).toBe(false)
    expect(CashIn.safeParse({ ...cashIn('quoted'), stellarTxHash: undefined }).success).toBe(false)
  })
})

describe('Rate', () => {
  const rate = { copPerUsdc: '4120', spreadPct: 3, quotedAt: AT }

  it('accepts a quoted rate', () => {
    expect(Rate.parse(rate)).toEqual(rate)
  })

  it('rejects a non-decimal price and a non-numeric spread', () => {
    expect(Rate.safeParse({ ...rate, copPerUsdc: '1e3' }).success).toBe(false)
    expect(Rate.safeParse({ ...rate, spreadPct: '3' }).success).toBe(false)
  })
})

describe('Grant', () => {
  it('accepts an active grant and a missing grant with no amounts', () => {
    const active = { status: 'active', limitCop: '2000000', spentCop: '0', expiresAt: LATER }
    expect(Grant.parse(active)).toEqual(active)
    expect(Grant.parse({ status: 'missing' })).toEqual({ status: 'missing' })
    expect(Grant.parse({ status: 'expired', spentCop: '100000' }).spentCop).toBe('100000')
  })

  it('rejects an unknown status and a signed amount', () => {
    expect(Grant.safeParse({ status: 'revoked' }).success).toBe(false)
    expect(Grant.safeParse({ status: 'active', limitCop: '-1' }).success).toBe(false)
  })
})

describe('Inventory and RefillResult', () => {
  const inventory = { usdc: '24.27', floatUsdc: '1000', lowThresholdPct: 30 }

  it('accepts operator inventory and a refill', () => {
    expect(Inventory.parse(inventory)).toEqual(inventory)
    expect(RefillResult.parse({ usdc: '1000' })).toEqual({ usdc: '1000' })
  })

  it('rejects bad decimals and a non-numeric threshold', () => {
    expect(Inventory.safeParse({ ...inventory, usdc: '' }).success).toBe(false)
    expect(Inventory.safeParse({ ...inventory, lowThresholdPct: '30' }).success).toBe(false)
    expect(RefillResult.safeParse({ usdc: '.5' }).success).toBe(false)
  })
})

describe('ApiError', () => {
  it('accepts every front code and the server-only codes', () => {
    for (const error of [
      'limit_exceeded',
      'no_grant',
      'grant_exhausted',
      'invalid_address',
      'insufficient_inventory',
      'quote_expired',
      'not_found',
      'backend_down',
    ] as const) {
      expect(FrontApiErrorCode.parse(error)).toBe(error)
      expect(ApiError.parse({ error })).toEqual({ error })
    }
    expect(FrontApiErrorCode.safeParse('invalid_request').success).toBe(false)
    for (const error of ['invalid_request', 'invalid_state', 'internal_error'] as const) {
      expect(ApiErrorCode.parse(error)).toBe(error)
      expect(ApiError.parse({ error, detail: 'nope' })).toEqual({ error, detail: 'nope' })
    }
  })

  it('rejects an unknown code', () => {
    expect(ApiError.safeParse({ error: 'nope' }).success).toBe(false)
    expect(ApiError.safeParse({}).success).toBe(false)
  })
})

describe('GrantFinishQuery', () => {
  it('accepts the GNAP return query', () => {
    const query = { hash: 'abc', interact_ref: 'ref-1' }
    expect(GrantFinishQuery.parse(query)).toEqual(query)
  })

  it.each([
    { interact_ref: 'ref-1' },
    { hash: 'abc' },
    { hash: '', interact_ref: 'ref-1' },
    { hash: 'abc', interact_ref: '' },
  ])('rejects %j', (value) => {
    expect(GrantFinishQuery.safeParse(value).success).toBe(false)
  })
})

describe('httpStatusFor', () => {
  it('maps every code', () => {
    const statuses = {
      invalid_request: 400,
      invalid_address: 400,
      limit_exceeded: 400,
      not_found: 404,
      invalid_state: 409,
      quote_expired: 409,
      grant_exhausted: 409,
      insufficient_inventory: 409,
      no_grant: 412,
      internal_error: 500,
      backend_down: 503,
    } satisfies Record<ApiErrorCode, number>
    for (const [code, status] of Object.entries(statuses)) {
      expect(httpStatusFor(code as ApiErrorCode)).toBe(status)
    }
  })
})

describe('inferred types', () => {
  it('matches the cashier contract, with optional fields truly optional', () => {
    expectTypeOf<CashInStatus>().toEqualTypeOf<
      | 'quoted'
      | 'settling'
      | 'settled'
      | 'sending_usdc'
      | 'completed'
      | 'failed_payment'
      | 'failed_stellar'
      | 'expired'
    >()
    expectTypeOf<Customer>().toEqualTypeOf<{
      phone: string
      fullName: string
      documentNumber: string
    }>()
    expectTypeOf<CashInRequest>().toEqualTypeOf<{
      copAmount: string
      stellarAddress: string
      customer: Customer
    }>()
    expectTypeOf<OpenPaymentsInfo>().toEqualTypeOf<{
      incomingPaymentUrl: string
      quoteId: string
      outgoingPaymentId?: string
      incomingCompleted: boolean
    }>()
    expectTypeOf<CashIn>().toEqualTypeOf<{
      id: string
      status: CashInStatus
      copAmount: string
      usdcAmount: string
      copPerUsdc: string
      expiresAt: string
      stellarAddress: string
      memo: string
      openPayments: OpenPaymentsInfo
      stellarTxHash?: string
      createdAt: string
    }>()
    expectTypeOf<Rate>().toEqualTypeOf<{
      copPerUsdc: string
      spreadPct: number
      quotedAt: string
    }>()
    expectTypeOf<Grant>().toEqualTypeOf<{
      status: 'active' | 'missing' | 'expired'
      limitCop?: string
      spentCop?: string
      expiresAt?: string
    }>()
    expectTypeOf<Inventory>().toEqualTypeOf<{
      usdc: string
      floatUsdc: string
      lowThresholdPct: number
    }>()
    expectTypeOf<RefillResult>().toEqualTypeOf<{ usdc: string }>()
    expectTypeOf<FrontApiErrorCode>().toEqualTypeOf<
      | 'limit_exceeded'
      | 'no_grant'
      | 'grant_exhausted'
      | 'invalid_address'
      | 'insufficient_inventory'
      | 'quote_expired'
      | 'not_found'
      | 'backend_down'
    >()
    expectTypeOf<ApiErrorCode>().toEqualTypeOf<
      FrontApiErrorCode | 'invalid_request' | 'invalid_state' | 'internal_error'
    >()
    expectTypeOf<ApiError>().toEqualTypeOf<{ error: ApiErrorCode; detail?: string }>()
    expectTypeOf<GrantFinishQuery>().toEqualTypeOf<{ hash: string; interact_ref: string }>()
  })
})
