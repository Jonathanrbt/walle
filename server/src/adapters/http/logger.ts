import type Fastify from 'fastify'

type LoggerOptions = Exclude<NonNullable<Fastify.FastifyServerOptions['logger']>, boolean>

/** Pino paths for secrets and customer PII. Fastify logs through its bundled logger. */
export const loggerOptions = {
  redact: {
    paths: [
      'req.headers.authorization',
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
