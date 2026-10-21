import type { LeadershipMode, SyncedPiniaRuntime } from 'pinia-plugin-synced'
import type { App } from 'vue'

import type { ProviderSecretReference, ProviderSecretStorage } from '../../services/provider-secret-storage'

import { createPinia, disposePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'
import { z } from 'zod'

import { configureLocalOnly } from '../../services/local-data-policy'
import { configureProviderSecretStorage } from '../../services/provider-secret-storage'
import { useProviderConfigStore } from './config'

const remote = vi.hoisted(() => ({ listRemote: vi.fn(), upsertRemote: vi.fn(), deleteRemote: vi.fn() }))
vi.mock('../../composables/api', () => ({ client: {} }))
vi.mock('../../services/inference-service-providers', () => ({ inferenceServiceProvidersService: remote }))
vi.mock('../auth', () => ({
  useAuthStore: () => ({
    isAuthenticated: true,
    onAuthenticated: (hook: () => void) => {
      hook()
      return () => undefined
    },
    onLogout: () => () => undefined,
  }),
}))
vi.mock('../../libs/providers', () => ({
  getDefinedProvider: (id: string) => ({
    id,
    configuredBy: 'user',
    createProviderConfig: () => z.object({ apiKey: z.string().meta({ type: 'password' }), baseUrl: z.string() }),
  }),
}))

const secrets = new Map<string, { providerId: string, reference: ProviderSecretReference, values: Record<string, string> }>()
const platform: ProviderSecretStorage = {
  async write(input) {
    const reference = { secretRef: crypto.randomUUID(), revision: (input.previous?.revision ?? 0) + 1 }
    secrets.set(reference.secretRef, { providerId: input.providerId, reference, values: { ...input.secrets } })
    return reference
  },
  async read(input) {
    const record = secrets.get(input.reference.secretRef)
    if (!record || record.providerId !== input.providerId || record.reference.revision !== input.reference.revision)
      throw new Error('Synthetic secret reference not found')
    return { ...record.values }
  },
  async remove(input) {
    secrets.delete(input.reference.secretRef)
  },
}

const contexts: Array<{ app: App, pinia: ReturnType<typeof createPinia>, runtime: SyncedPiniaRuntime }> = []

function createWindow(namespace: string, leadership: LeadershipMode) {
  const pinia = createPinia()
  const runtime = createSyncedPiniaPlugin({ namespace, leadership, callTimeout: 2000 })
  pinia.use(runtime.plugin)
  let store: ReturnType<typeof useProviderConfigStore> | undefined
  const app = createApp({
    setup() {
      store = useProviderConfigStore()
      return () => null
    },
  })
  app.use(pinia).mount(document.createElement('div'))
  if (!store)
    throw new Error('Provider store was not created')
  contexts.push({ app, pinia, runtime })
  return { store, runtime }
}

describe('local provider configuration', () => {
  beforeAll(() => {
    configureLocalOnly()
    configureProviderSecretStorage(platform)
  })
  beforeEach(() => {
    localStorage.clear()
    secrets.clear()
    vi.clearAllMocks()
  })
  afterEach(() => {
    for (const { app, pinia, runtime } of contexts.splice(0)) {
      app.unmount()
      runtime.dispose()
      disposePinia(pinia)
    }
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('saves a follower key through secure storage and sends only its reference to the leader', async () => {
    const namespace = `local-provider:${crypto.randomUUID()}`
    const leader = createWindow(namespace, 'leader-only')
    await expect.poll(() => leader.runtime.isLeader()).toBe(true)
    const follower = createWindow(namespace, 'follower-only')
    await expect.poll(() => follower.runtime.getLeaderId()).toBe(leader.runtime.participantId)
    await leader.store.ensureProvider('synthetic-provider', 'synthetic-provider', { baseUrl: 'https://example.invalid/' })
    await expect.poll(() => follower.store.getProvider('synthetic-provider')).toBeDefined()
    const traffic = vi.spyOn(BroadcastChannel.prototype, 'postMessage')

    await expect(follower.store.ensureProvider('other-provider', 'synthetic-provider', { apiKey: 'private-ensure-canary' })).rejects.toThrow('secure configuration action')
    expect(JSON.stringify(traffic.mock.calls)).not.toContain('private-ensure-canary')
    await follower.store.patchProviderConfig('synthetic-provider', { apiKey: 'private-synthetic-value' })
    await expect.poll(() => follower.store.providers['synthetic-provider'].secretReference).toBeDefined()
    expect(JSON.stringify(leader.store.$state)).not.toContain('private-synthetic-value')
    expect(JSON.stringify(follower.store.$state)).not.toContain('private-synthetic-value')
    expect(JSON.stringify(traffic.mock.calls)).not.toContain('private-synthetic-value')
    expect(localStorage.getItem('settings/providers/local-configured-v1')).not.toContain('private-synthetic-value')
    await expect(follower.store.resolveProviderConfig('synthetic-provider')).resolves.toMatchObject({ apiKey: 'private-synthetic-value', baseUrl: 'https://example.invalid/' })
    expect(remote.listRemote).not.toHaveBeenCalled()
    expect(remote.upsertRemote).not.toHaveBeenCalled()
    expect(remote.deleteRemote).not.toHaveBeenCalled()
  })

  it('keeps direct form writes private and rejects a stale prepared configuration', async () => {
    const { store, runtime } = createWindow(`private-draft:${crypto.randomUUID()}`, 'leader-only')
    await expect.poll(() => runtime.isLeader()).toBe(true)
    await store.ensureProvider('synthetic-provider', 'synthetic-provider', { baseUrl: 'https://example.invalid/' })
    const revision = store.getProviderConfigRevision('synthetic-provider')
    const traffic = vi.spyOn(BroadcastChannel.prototype, 'postMessage')
    store.configs['synthetic-provider'].apiKey = 'private-draft-value'
    expect(JSON.stringify(store.$state)).not.toContain('private-draft-value')
    await store.flushProviderConfig('synthetic-provider')
    expect(JSON.stringify(traffic.mock.calls)).not.toContain('private-draft-value')
    expect(localStorage.getItem('settings/providers/local-configured-v1')).not.toContain('private-draft-value')
    await expect(store.resolveProviderConfig('synthetic-provider')).resolves.toMatchObject({ apiKey: 'private-draft-value' })
    await expect(store.commitPreparedConfiguration({ providerId: 'synthetic-provider', definitionId: 'synthetic-provider', config: {}, expectedRevision: revision })).rejects.toThrow('not committed: revision conflict')
    const latestRevision = store.getProviderConfigRevision('synthetic-provider')
    await store.removeProvider('synthetic-provider')
    await store.ensureProvider('synthetic-provider', 'synthetic-provider')
    expect(store.getProviderConfigRevision('synthetic-provider')).toBeGreaterThan(latestRevision)
  })

  it('rejects credentials in endpoints before public state or cross-window transport receives them', async () => {
    const { store, runtime } = createWindow(`endpoint-config:${crypto.randomUUID()}`, 'leader-only')
    await expect.poll(() => runtime.isLeader()).toBe(true)
    await store.ensureProvider('synthetic-provider', 'synthetic-provider', { baseUrl: 'https://example.invalid/v1/' })
    const traffic = vi.spyOn(BroadcastChannel.prototype, 'postMessage')
    for (const baseUrl of [
      'https://canary-user:canary-password@example.invalid/v1/',
      'https://example.invalid/v1/?api_key=canary-query',
      'https://example.invalid/v1/#canary-fragment',
    ]) {
      await expect(store.patchProviderConfig('synthetic-provider', { baseUrl })).rejects.toThrow('Use a provider endpoint without credentials')
    }
    expect(JSON.stringify(store.$state)).not.toContain('canary-')
    expect(JSON.stringify(traffic.mock.calls)).not.toContain('canary-')
    expect(localStorage.getItem('settings/providers/local-configured-v1')).not.toContain('canary-')
    expect(store.getProviderConfig('synthetic-provider').baseUrl).toBe('https://example.invalid/v1/')
  })

  it('does not read or migrate old plaintext credentials into the local profile', async () => {
    localStorage.setItem('settings/credentials/providers', JSON.stringify({ 'synthetic-provider': { apiKey: 'legacy-synthetic-value' } }))
    localStorage.setItem('settings/providers/configured', JSON.stringify({ old: { id: 'old', config: { apiKey: 'legacy-synthetic-value' } } }))
    const reads = vi.spyOn(Storage.prototype, 'getItem')
    const { store, runtime } = createWindow(`old-profile:${crypto.randomUUID()}`, 'leader-only')
    await expect.poll(() => runtime.isLeader()).toBe(true)
    expect(store.getProvider('synthetic-provider')).toBeUndefined()
    expect(store.getProvider('old')).toBeUndefined()
    expect(secrets.size).toBe(0)
    expect(reads).not.toHaveBeenCalledWith('settings/credentials/providers')
    expect(reads).not.toHaveBeenCalledWith('settings/providers/configured')
    expect(localStorage.getItem('settings/credentials/providers')).toContain('legacy-synthetic-value')
    expect(localStorage.getItem('settings/providers/configured')).toContain('legacy-synthetic-value')
  })

  it('acknowledges a durable envelope and leaves the previous key usable when a new configuration write fails', async () => {
    const { store, runtime } = createWindow(`durable-config:${crypto.randomUUID()}`, 'leader-only')
    await expect.poll(() => runtime.isLeader()).toBe(true)
    await store.ensureProvider('synthetic-provider', 'synthetic-provider', { baseUrl: 'https://example.invalid/' })
    await store.patchProviderConfig('synthetic-provider', { apiKey: 'private-original-key' })
    const previous = localStorage.getItem('settings/providers/local-configured-v1')
    const revision = store.getProviderConfigRevision('synthetic-provider')
    const setItem = Storage.prototype.setItem
    const failure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'settings/providers/local-configured-v1')
        throw new DOMException('Synthetic quota fault', 'QuotaExceededError')
      setItem.call(this, key, value)
    })
    await expect(store.patchProviderConfig('synthetic-provider', { apiKey: 'private-rejected-key' })).rejects.toThrow('not committed: persistence')
    failure.mockRestore()
    expect(store.getProviderConfigRevision('synthetic-provider')).toBe(revision)
    expect(localStorage.getItem('settings/providers/local-configured-v1')).toBe(previous)
    await expect(store.resolveProviderConfig('synthetic-provider')).resolves.toMatchObject({ apiKey: 'private-original-key' })
    expect(secrets.size).toBe(1)

    const recovered = createWindow(`recovered-config:${crypto.randomUUID()}`, 'leader-only')
    await expect.poll(() => recovered.runtime.isLeader()).toBe(true)
    expect(recovered.store.getProviderConfigRevision('synthetic-provider')).toBe(revision)
    await expect(recovered.store.resolveProviderConfig('synthetic-provider')).resolves.toMatchObject({ apiKey: 'private-original-key' })
    expect(JSON.stringify(recovered.store.$state)).not.toContain('private-original-key')
  })

  it('retains a committed key when the acknowledgement is lost and reclaims replaced keys after confirmed commits', async () => {
    const { store, runtime } = createWindow(`lost-ack:${crypto.randomUUID()}`, 'leader-only')
    await expect.poll(() => runtime.isLeader()).toBe(true)
    await store.ensureProvider('synthetic-provider', 'synthetic-provider', { baseUrl: 'https://example.invalid/' })
    const commit = store.commitPreparedConfiguration
    const lostAcknowledgement = vi.spyOn(store, 'commitPreparedConfiguration').mockImplementationOnce(async (prepared) => {
      await commit(prepared)
      throw new Error('Synthetic lost RPC acknowledgement')
    })
    await expect(store.patchProviderConfig('synthetic-provider', { apiKey: 'private-committed-key' })).rejects.toThrow('lost RPC acknowledgement')
    lostAcknowledgement.mockRestore()
    await expect(store.resolveProviderConfig('synthetic-provider')).resolves.toMatchObject({ apiKey: 'private-committed-key' })
    expect(secrets.size).toBe(1)
    for (const apiKey of ['private-replacement-one', 'private-replacement-two', 'private-replacement-three'])
      await store.patchProviderConfig('synthetic-provider', { apiKey })
    expect(secrets.size).toBe(1)
    await expect(store.resolveProviderConfig('synthetic-provider')).resolves.toMatchObject({ apiKey: 'private-replacement-three' })
    await store.removeProvider('synthetic-provider')
    expect(secrets.size).toBe(0)
  })
})
