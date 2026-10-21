import type { InferenceServiceProvidersRemoteClient } from '../services/inference-service-providers'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { inferenceServiceProvidersService } from '../services/inference-service-providers'
import { configureLocalOnly } from '../services/local-data-policy'
import { authedFetch } from './auth-fetch'
import { createCloudChatMapper } from './chat-sync/cloud-mapper'
import { SERVER_URL } from './server'

vi.mock('../stores/auth', () => ({
  useAuthStore: () => ({
    token: 'synthetic-access-token',
    sessionVersion: 1,
    refreshTokenNow: async () => {
      configureLocalOnly()
      return 'synthetic-refreshed-token'
    },
    expireSession: vi.fn(),
  }),
}))
vi.mock('./product-signals', () => ({ getAnalyticsIdentitySnapshot: () => null }))

afterEach(() => vi.unstubAllGlobals())

describe('local-only replica transports', () => {
  it('stops an in-flight auth retry and prevents provider and chat replicas without disabling model requests', async () => {
    const transport = vi.fn<typeof fetch>(async () => new Response(null, { status: 401 }))
    vi.stubGlobal('fetch', transport)
    await expect(authedFetch(`${SERVER_URL}/api/v1/chats`)).rejects.toThrow('Cloud replicas are disabled')
    expect(transport).toHaveBeenCalledTimes(1)
    transport.mockClear()

    await expect(authedFetch(`${SERVER_URL}/api/v1/providers/provider-one`, { method: 'PUT' })).rejects.toThrow('Cloud replicas are disabled')
    expect(transport).not.toHaveBeenCalled()
    const mapper = createCloudChatMapper({ serverUrl: SERVER_URL, fetch: transport })
    await expect(mapper.listChats()).rejects.toThrow('Cloud replicas are disabled')
    await expect(mapper.createChat({ id: 'synthetic-chat' })).rejects.toThrow('Cloud replicas are disabled')
    await expect(mapper.deleteChat('synthetic-chat')).rejects.toThrow('Cloud replicas are disabled')
    expect(transport).not.toHaveBeenCalled()

    const remoteGet = vi.fn(async () => ({ ok: true, status: 200, json: async () => [] }))
    const remotePut = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    const remoteDelete = vi.fn(async () => ({ ok: true, status: 204 }))
    const client: InferenceServiceProvidersRemoteClient = { api: { v1: { providers: {
      '$get': remoteGet,
      ':id': { $put: remotePut, $delete: remoteDelete },
    } } } }
    await expect(inferenceServiceProvidersService.listRemote(client)).rejects.toThrow('Cloud replicas are disabled')
    await expect(inferenceServiceProvidersService.upsertRemote(client, { id: 'provider-one', definitionId: 'deepseek', config: {} })).rejects.toThrow('Cloud replicas are disabled')
    await expect(inferenceServiceProvidersService.deleteRemote(client, 'provider-one')).rejects.toThrow('Cloud replicas are disabled')
    expect(remoteGet).not.toHaveBeenCalled()
    expect(remotePut).not.toHaveBeenCalled()
    expect(remoteDelete).not.toHaveBeenCalled()

    transport.mockResolvedValue(Response.json({ id: 'synthetic-model-response' }))
    await expect(fetch('https://example.invalid/v1/chat/completions', { method: 'POST' })).resolves.toBeInstanceOf(Response)
    expect(transport).toHaveBeenCalledTimes(1)
  })
})
