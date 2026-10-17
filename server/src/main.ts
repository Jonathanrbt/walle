import { composeApp } from './compose.ts'
import { ConfigError, loadConfig } from './config.ts'

try {
  const config = loadConfig(process.env)
  const runtime = composeApp(config)

  const shutdown = (): void => {
    runtime.close().catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'shutdown failed')
      process.exit(1)
    })
  }

  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)

  await runtime.app.listen({ port: config.http.port, host: '0.0.0.0' })
  runtime.start()
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message)
    process.exit(1)
  }
  throw error
}
