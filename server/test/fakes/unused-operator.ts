import type { OperatorService } from '../../src/treasury/application/operator-service.ts'

/** Stand-in for tests that never reach the operator routes. */
export const unusedOperator: OperatorService = {
  listCashIns: () => Promise.reject(new Error('operator service not expected in this test')),
  inventory: () => Promise.reject(new Error('operator service not expected in this test')),
  refill: () => Promise.reject(new Error('operator service not expected in this test')),
}
