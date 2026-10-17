import { buildApp } from './adapters/http/app.ts'
import { loggerOptions } from './adapters/http/logger.ts'
import { ConfigError, loadConfig } from './config.ts'

try {
  const config = loadConfig(process.env)
  const app = buildApp({
    logger: {
      ...loggerOptions,
      level: config.http.logLevel,
    },
  })

  const shutdown = (): void => {
    app.close().catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'shutdown failed')
      process.exit(1)
    })
  }

  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)

  await app.listen({ port: config.http.port, host: '0.0.0.0' })
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message)
    process.exit(1)
  }
  throw error
}
