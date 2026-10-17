import { ApiError, httpStatusFor, type ApiErrorCode } from '@walle/contracts'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod'
import { ZodError } from 'zod'

import { DomainError, type DomainErrorCode } from '../../shared/errors.ts'
import { StoreGrantError } from '../../store-grant/application/errors.ts'

export class AppError extends Error {
  readonly code: ApiErrorCode
  readonly detail?: string

  constructor(code: ApiErrorCode, detail?: string) {
    super(detail ?? code)
    this.name = 'AppError'
    this.code = code
    if (detail !== undefined) this.detail = detail
  }
}

export function installErrorHandler(app: FastifyInstance, webBaseUrl: string): void {
  app.setErrorHandler((error, request, reply) => {
    if (isGrantFinish(request)) {
      logFinishFailure(request, error)
      return reply.redirect(storePage(webBaseUrl, 'error'), 302)
    }

    if (isNotFound(error)) return sendApi(reply, 'not_found')

    if (error instanceof AppError) return sendApi(reply, error.code, error.detail)
    if (error instanceof StoreGrantError) {
      return sendApi(reply, fromGrant(error.code), error.message)
    }
    if (error instanceof DomainError) {
      const code = fromDomain(error.code)
      return sendApi(reply, code, code === 'internal_error' ? undefined : error.message)
    }
    if (isResponseSerializationError(error)) {
      request.log.error({ reqId: request.id, err: error }, 'unhandled error')
      return sendApi(reply, 'internal_error')
    }

    const zodDetail = validationDetail(error)
    if (zodDetail !== undefined || isZodValidation(error)) {
      return sendApi(reply, 'invalid_request', zodDetail)
    }

    request.log.error({ reqId: request.id, err: error }, 'unhandled error')
    return sendApi(reply, 'internal_error')
  })
}

export function storePage(webBaseUrl: string, result: 'ok' | 'error'): string {
  return `${webBaseUrl.replace(/\/$/, '')}/tienda?grant=${result}`
}

function isGrantFinish(request: FastifyRequest): boolean {
  return request.url.split('?')[0] === '/api/grant/finish'
}

function logFinishFailure(request: FastifyRequest, error: unknown): void {
  if (error instanceof StoreGrantError || error instanceof AppError || !(error instanceof Error)) {
    return
  }
  request.log.error({ reqId: request.id, name: error.name }, 'grant finish failed')
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'FST_ERR_NOT_FOUND'
  )
}

function fromDomain(code: DomainErrorCode): ApiErrorCode {
  switch (code) {
    case 'limit_exceeded':
      return 'limit_exceeded'
    case 'quote_expired':
      return 'quote_expired'
    case 'invalid_transition':
    case 'version_conflict':
      return 'invalid_state'
    case 'invalid_amount':
      return 'invalid_request'
    case 'asset_mismatch':
      return 'internal_error'
  }
}

function fromGrant(code: StoreGrantError['code']): ApiErrorCode {
  switch (code) {
    case 'no_grant':
      return 'no_grant'
    case 'grant_exhausted':
      return 'grant_exhausted'
    case 'invalid_finish':
      return 'invalid_request'
  }
}

function isZodValidation(error: unknown): boolean {
  return error instanceof ZodError || hasZodFastifySchemaValidationErrors(error)
}

function validationDetail(error: unknown): string | undefined {
  if (isResponseSerializationError(error)) return undefined
  if (error instanceof ZodError) return textOrUndefined(error.issues[0]?.message)
  if (hasZodFastifySchemaValidationErrors(error)) {
    return textOrUndefined(error.validation[0]?.message)
  }
  return undefined
}

function textOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function sendApi(reply: FastifyReply, code: ApiErrorCode, detail?: string) {
  const body = detail === undefined ? { error: code } : { error: code, detail }
  ApiError.parse(body)
  return reply.status(httpStatusFor(code)).send(body)
}
