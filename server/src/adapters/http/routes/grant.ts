import { Grant } from '@walle/contracts'
import type { FastifyInstance } from 'fastify'

import { formatDecimal } from '../../../shared/money.ts'
import type { Clock } from '../../../shared/ports.ts'
import type { StoreGrantService } from '../../../store-grant/application/store-grant-service.ts'
import { storePage } from '../errors.ts'

export function registerGrantRoutes(
  app: FastifyInstance,
  deps: {
    readonly storeGrant: Pick<StoreGrantService, 'start' | 'finish' | 'status'>
    readonly webBaseUrl: string
    readonly clock: Clock
  },
): void {
  app.get(
    '/api/grant',
    {
      schema: {
        response: { 200: Grant },
      },
    },
    async () => {
      const snapshot = await deps.storeGrant.status(deps.clock.now())
      return {
        status: snapshot.status,
        ...(snapshot.limit !== undefined ? { limitCop: formatDecimal(snapshot.limit) } : {}),
        ...(snapshot.spent !== undefined ? { spentCop: formatDecimal(snapshot.spent) } : {}),
        ...(snapshot.expiresAt !== undefined
          ? { expiresAt: snapshot.expiresAt.toISOString() }
          : {}),
      }
    },
  )

  app.get('/api/grant/start', async (_request, reply) => {
    const result = await deps.storeGrant.start()
    const url = result.kind === 'already_active' ? storePage(deps.webBaseUrl, 'ok') : result.url
    return reply.redirect(url, 302)
  })

  app.get('/api/grant/finish', async (request, reply) => {
    const query = request.query
    const hash = readQuery(query, 'hash')
    const interactRef = readQuery(query, 'interact_ref')
    if (hash === undefined || interactRef === undefined) {
      return reply.redirect(storePage(deps.webBaseUrl, 'error'), 302)
    }
    await deps.storeGrant.finish({ hash, interactRef })
    return reply.redirect(storePage(deps.webBaseUrl, 'ok'), 302)
  })
}

function readQuery(query: unknown, key: string): string | undefined {
  if (typeof query !== 'object' || query === null) return undefined
  const value: unknown = Reflect.get(query, key)
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
