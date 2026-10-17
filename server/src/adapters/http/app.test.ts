import { describe, expect, it } from 'vitest'
import { buildApp } from './app.ts'

describe('buildApp', () => {
  it('returns 200 and { status: "ok" } for GET /healthz', async () => {
    const app = buildApp({ logger: false })
    try {
      const response = await app.inject({ method: 'GET', url: '/healthz' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ status: 'ok' })
    } finally {
      await app.close()
    }
  })

  it('returns 404 for an unknown route', async () => {
    const app = buildApp({ logger: false })
    try {
      const response = await app.inject({ method: 'GET', url: '/missing' })

      expect(response.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  })
})
