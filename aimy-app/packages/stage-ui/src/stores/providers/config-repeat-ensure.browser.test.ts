import type { LeadershipMode, SyncedPiniaRuntime } from 'pinia-plugin-synced'
import type { App } from 'vue'

import { createPinia, disposePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'
import { z } from 'zod'

import { configureLocalOnly } from '../../services/local-data-policy'
import { useProviderConfigStore } from './config'

// Remote identity and catalog metadata are external boundaries. Store and transport are real.
vi.mock('../../composables/api', () => ({ client: {} }))
vi.mock('../../services/inference-service-providers', () => ({ inferenceServiceProvidersService: { listRemote: vi.fn(), upsertRemote: vi.fn(), deleteRemote: vi.fn() } }))
vi.mock('../auth', () => ({ useAuthStore: () => ({ isAuthenticated: false, onAuthenticated: () => () => {}, onLogout: () => () => {} }) }))
vi.mock('../../libs/providers', () => ({ getDefinedProvider: (id: string) => ({ id, configuredBy: 'user', createProviderConfig: () => z.object({ baseUrl: z.string(), model: z.string(), thinkingMode: z.string() }) }) }))

const contexts: Array<{ app: App, pinia: ReturnType<typeof createPinia>, runtime: SyncedPiniaRuntime }> = []
const initial = { baseUrl: 'https://example.invalid/', model: 'synthetic-model', thinkingMode: 'disable' }

function createWindow(namespace: string, leadership: LeadershipMode) {
  const pinia = createPinia()
  const runtime = createSyncedPiniaPlugin({ namespace, leadership, callTimeout: 2000 })
  pinia.use(runtime.plugin)
  let store: ReturnType<typeof useProviderConfigStore> | undefined
  const app = createApp({ setup() {
    store = useProviderConfigStore()
    return () => null
  } })
  app.use(pinia).mount(document.createElement('div'))
  if (!store)
    throw new Error('TEST_PROVIDER_STORE_MISSING')
  const owner = { app, pinia, runtime, store }
  contexts.push(owner)
  return owner
}

function closeWindows() {
  for (const { app, pinia, runtime } of contexts.splice(0)) {
    app.unmount()
    runtime.dispose()
    disposePinia(pinia)
  }
}

beforeAll(() => configureLocalOnly())
beforeEach(() => localStorage.clear())
afterEach(() => {
  closeWindows()
  localStorage.clear()
})

describe('provider ensure idempotency through the real synced action boundary', () => {
  it('patches nested voice settings through the leader and follower without returning reactive values', async () => {
    const namespace = `nested-voice:${crypto.randomUUID()}`
    const leader = createWindow(namespace, 'leader-only')
    await expect.poll(() => leader.runtime.isLeader()).toBe(true)
    await leader.store.ensureProvider('synthetic-provider', 'synthetic-provider', { ...initial, voiceSettings: { speed: 1, volume: 1 } })
    const follower = createWindow(namespace, 'follower-only')
    await expect.poll(() => follower.runtime.getLeaderId()).toBe(leader.runtime.participantId)
    await expect.poll(() => follower.store.getProviderConfig('synthetic-provider')?.voiceSettings).toEqual({ speed: 1, volume: 1 })
    const revision = leader.store.getProviderConfigRevision('synthetic-provider')

    await expect(leader.store.patchProviderConfig('synthetic-provider', { baseUrl: 'http://127.0.0.1:50021/' })).resolves.toBe(true)
    await expect.poll(() => follower.store.getProviderConfig('synthetic-provider')?.baseUrl).toBe('http://127.0.0.1:50021/')
    await expect(follower.store.patchProviderConfig('synthetic-provider', { voiceSettings: { speed: 1, volume: 0.8 } })).resolves.toBe(true)
    await expect.poll(() => leader.store.getProviderConfig('synthetic-provider')?.voiceSettings).toEqual({ speed: 1, volume: 0.8 })
    expect(leader.store.getProviderConfigRevision('synthetic-provider')).toBe(revision + 2)
    await expect.poll(() => follower.store.getProviderConfigRevision('synthetic-provider')).toBe(revision + 2)
  })

  it('returns an isolated clone on a second ensure without rewriting the existing configuration', async () => {
    const { store, runtime } = createWindow(`ensure-repeat:${crypto.randomUUID()}`, 'leader-only')
    await expect.poll(() => runtime.isLeader()).toBe(true)
    await store.ensureProvider('synthetic-provider', 'synthetic-provider', initial)
    const revision = store.getProviderConfigRevision('synthetic-provider')
    const repeated = await store.ensureProvider('synthetic-provider', 'synthetic-provider', { ...initial, model: 'must-not-replace' })
    expect(repeated.config).toEqual(initial)
    expect(store.getProviderConfigRevision('synthetic-provider')).toBe(revision)
    repeated.config.model = 'caller-edit'
    expect(store.getProvider('synthetic-provider')?.config.model).toBe('synthetic-model')
  })

  it('ensures a persisted provider after a fresh store owner restores the same local configuration', async () => {
    const first = createWindow(`ensure-before-reopen:${crypto.randomUUID()}`, 'leader-only')
    await expect.poll(() => first.runtime.isLeader()).toBe(true)
    await first.store.ensureProvider('synthetic-provider', 'synthetic-provider', initial)
    const revision = first.store.getProviderConfigRevision('synthetic-provider')
    closeWindows()
    const reopened = createWindow(`ensure-after-reopen:${crypto.randomUUID()}`, 'leader-only')
    await expect.poll(() => reopened.runtime.isLeader()).toBe(true)
    await expect(reopened.store.ensureProvider('synthetic-provider', 'synthetic-provider', initial)).resolves.toMatchObject({ id: 'synthetic-provider', config: initial })
    expect(reopened.store.getProviderConfigRevision('synthetic-provider')).toBe(revision)
  })

  it('returns the existing provider to a follower without exposing a reactive object to transport', async () => {
    const namespace = `ensure-follower:${crypto.randomUUID()}`
    const leader = createWindow(namespace, 'leader-only')
    await expect.poll(() => leader.runtime.isLeader()).toBe(true)
    await leader.store.ensureProvider('synthetic-provider', 'synthetic-provider', initial)
    const follower = createWindow(namespace, 'follower-only')
    await expect.poll(() => follower.runtime.getLeaderId()).toBe(leader.runtime.participantId)
    await expect(follower.store.ensureProvider('synthetic-provider', 'synthetic-provider', initial)).resolves.toMatchObject({ id: 'synthetic-provider', config: initial })
  })
})
