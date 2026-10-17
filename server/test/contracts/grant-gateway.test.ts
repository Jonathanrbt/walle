import { describe } from 'vitest'

import { FakeGrantGateway, ManualClock } from '../fakes/fake-grant-gateway.ts'
import { runGrantGatewayContract } from './grant-gateway.contract.ts'

const TTL_MS = 60_000

describe('grant gateway', () => {
  runGrantGatewayContract('memory', () => {
    const clock = new ManualClock(new Date('2026-10-17T00:00:00Z'))
    return Promise.resolve({ gateway: new FakeGrantGateway(clock, TTL_MS), clock, ttlMs: TTL_MS })
  })
})
