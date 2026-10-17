import { apiMock } from '../config'
import { httpApi } from './http'
import { createMockApi } from './mock'
import type { Api } from './types'

export const mockApi = apiMock ? createMockApi() : null

export const api: Api = mockApi ?? httpApi

export * from './types'
