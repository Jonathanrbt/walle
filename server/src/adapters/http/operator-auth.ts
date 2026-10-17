import { timingSafeEqual } from 'node:crypto'

import type { FastifyRequest, preHandlerHookHandler } from 'fastify'

export const OPERATOR_DENIED = {
  error: 'invalid_request',
  detail: 'operator token required',
} as const

export function tokenMatches(provided: string, expected: string): boolean {
  const left = Buffer.from(provided)
  const right = Buffer.from(expected)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function operatorGuard(expected: string): preHandlerHookHandler {
  return (request, reply, done) => {
    if (!tokenMatches(headerToken(request), expected)) {
      reply.code(401).send(OPERATOR_DENIED)
    }
    done()
  }
}

function headerToken(request: FastifyRequest): string {
  const value = request.headers['x-operator-token']
  return typeof value === 'string' ? value : ''
}
