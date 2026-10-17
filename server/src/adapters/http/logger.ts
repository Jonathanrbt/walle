import type Fastify from 'fastify'

type LoggerOptions = Exclude<NonNullable<Fastify.FastifyServerOptions['logger']>, boolean>

/** Secrets that can travel in a query string. Their values never reach the logs. */
const SECRET_QUERY = /([?&](?:token|hash|interact_ref)=)[^&#]*/gi

export function redactUrl(url: string): string {
  return url.replace(SECRET_QUERY, '$1[REDACTED]')
}

/** Pino paths for secrets and customer PII. Fastify logs through its bundled logger. */
export const loggerOptions = {
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-operator-token"]',
      '*.privateKey',
      '*.secret',
      '*.accessToken',
      '*.customer.phone',
      '*.customer.fullName',
      '*.customer.documentNumber',
      'customer.*',
    ],
    censor: '[REDACTED]',
  },
} satisfies LoggerOptions

export type { LoggerOptions }
