import { expectTypeOf } from 'vitest'
import type { z } from 'zod'
import {
  CashIn,
  CashInRequest,
  CashInStatus,
  Customer,
  FrontApiErrorCode,
  Grant,
  Inventory,
  Rate,
} from '@walle/contracts'
import type {
  ApiErrorCode as WebApiErrorCode,
  CashIn as WebCashIn,
  CashInRequest as WebCashInRequest,
  CashInStatus as WebCashInStatus,
  Customer as WebCustomer,
  Grant as WebGrant,
  Inventory as WebInventory,
  Rate as WebRate,
} from '../../../web/src/api/types.ts'

expectTypeOf<WebCashIn>().toEqualTypeOf<z.infer<typeof CashIn>>()
expectTypeOf<WebCashInRequest>().toEqualTypeOf<z.infer<typeof CashInRequest>>()
expectTypeOf<WebCustomer>().toEqualTypeOf<z.infer<typeof Customer>>()
expectTypeOf<WebRate>().toEqualTypeOf<z.infer<typeof Rate>>()
expectTypeOf<WebGrant>().toEqualTypeOf<z.infer<typeof Grant>>()
expectTypeOf<WebInventory>().toEqualTypeOf<z.infer<typeof Inventory>>()
expectTypeOf<WebApiErrorCode>().toEqualTypeOf<z.infer<typeof FrontApiErrorCode>>()
expectTypeOf<WebCashInStatus>().toEqualTypeOf<z.infer<typeof CashInStatus>>()
