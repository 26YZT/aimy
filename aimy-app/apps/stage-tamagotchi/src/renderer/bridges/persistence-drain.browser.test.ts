import type { ShutdownRequest } from '../../shared/eventa/aimy-lifecycle'

import { setupSynced, usePiniaSynced } from '@proj-airi/stage-ui/libs/pinia'
import { configureLocalOnly } from '@proj-airi/stage-ui/services/local-data-policy'
import { configureProviderSecretStorage } from '@proj-airi/stage-ui/services/provider-secret-storage'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import { PersistenceDrain, WindowShutdownCoordinator } from './persistence-drain'

const contexts: Array<{ app: ReturnType<typeof createApp>, pinia: ReturnType<typeof createPinia> }> = []
const writes = { gate: Promise.withResolvers<void>(), started: false }
const providerId = 'openai-compatible'

beforeAll(() => {
  configureLocalOnly()
  configureProviderSecretStorage({
    async write() {
      writes.started = true
      await writes.gate.promise
      return { secretRef: 'synthetic-opaque-reference', revision: 1 }
    },
    async read() { return { config: '{}' } },
    async remove() {},
  })
})
beforeEach(() => {
  localStorage.clear()
  writes.gate = Promise.withResolvers<void>()
  writes.started = false
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => {
    throw new Error('No network in shutdown tests')
  }))
})
afterEach(() => {
  for (const { app, pinia } of contexts.splice(0)) {
    app.unmount()
    disposePinia(pinia)
  }
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

function createWindow(leadership: 'leader-only' | 'follower-only') {
  const pinia = createPinia()
  const synced = setupSynced({ leadership })
  pinia.use(synced.pinia)
  let store: ReturnType<typeof useProviderConfigStore> | undefined
  let runtime: ReturnType<typeof usePiniaSynced> | undefined
  const app = createApp({
    setup() {
      store = useProviderConfigStore()
      runtime = usePiniaSynced()
      return () => null
    },
  })
  app.use(pinia).use(synced.vue).mount(document.createElement('div'))
  if (!store || !runtime)
    throw new Error('Window stores were not created')
  contexts.push({ app, pinia })
  return { store, runtime }
}

function request(id: string): ShutdownRequest {
  return { shutdownId: id, phase: 'prepare', scope: 'application', deadline: Date.now() + 3000 }
}

async function twoWindows() {
  const leader = createWindow('leader-only')
  await expect.poll(() => leader.runtime.isLeader()).toBe(true)
  await leader.store.ensureProvider(providerId, providerId, { baseUrl: 'https://example.invalid/v1/' })
  const follower = createWindow('follower-only')
  await expect.poll(() => follower.runtime.getLeaderId()).toBe(leader.runtime.participantId)
  await expect.poll(() => follower.store.getProvider(providerId)).toBeDefined()
  const ownerDrain = new PersistenceDrain()
  const callerDrain = new PersistenceDrain()
  ownerDrain.track(leader.store, ['patchProviderConfig', 'commitPreparedConfiguration'])
  callerDrain.track(follower.store, ['patchProviderConfig', 'commitPreparedConfiguration'])
  const finalized = vi.fn()
  function coordinator(store: typeof leader.store, drain: PersistenceDrain, finalize: () => void) {
    return new WindowShutdownCoordinator(new Set([{
      id: 'configuration',
      begin: (value: ShutdownRequest) => drain.begin(value.shutdownId),
      drain: (value: ShutdownRequest) => drain.waitFor(value.shutdownId, value.deadline),
      abort: (id: string) => drain.abort(id),
      stop: () => {},
      flush: () => store.flushProviderConfigurations(),
      finalize,
    }]))
  }
  return { leader, follower, owner: coordinator(leader.store, ownerDrain, finalized), caller: coordinator(follower.store, callerDrain, () => {}), finalized }
}

describe('real provider writes across two renderer runtimes', () => {
  it('drains a follower secure write before its synced commit, then finalizes only after both prepare receipts', async () => {
    const windows = await twoWindows()
    const traffic = vi.spyOn(BroadcastChannel.prototype, 'postMessage')
    const saving = windows.follower.store.patchProviderConfig(providerId, { apiKey: 'synthetic-shutdown-canary' })
    await expect.poll(() => writes.started).toBe(true)
    const quit = request('two-window-save')
    const callerPrepared = vi.fn()
    const ownerReceipt = await windows.owner.run(quit)
    const callerReceipt = windows.caller.run(quit).then((receipt) => {
      callerPrepared(receipt)
      return receipt
    })
    expect(ownerReceipt.persisted).toBe(true)
    expect(callerPrepared).not.toHaveBeenCalled()
    expect(windows.finalized).not.toHaveBeenCalled()
    writes.gate.resolve()
    await saving
    await expect(callerReceipt).resolves.toMatchObject({ persisted: true })
    await expect(windows.owner.run({ ...quit, phase: 'finalize' })).resolves.toMatchObject({ persisted: true })
    expect(windows.finalized).toHaveBeenCalledOnce()
    expect(windows.leader.store.getProvider(providerId)?.secretReference).toEqual({ secretRef: 'synthetic-opaque-reference', revision: 1 })
    expect(localStorage.getItem('settings/providers/local-configured-v1')).toContain('synthetic-opaque-reference')
    expect(localStorage.getItem('settings/providers/local-configured-v1')).not.toContain('synthetic-shutdown-canary')
    expect(JSON.stringify(traffic.mock.calls)).not.toContain('synthetic-shutdown-canary')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports a pending native quota failure and permits a later close after confirmed rollback', async () => {
    const windows = await twoWindows()
    const oldRevision = windows.leader.store.getProviderConfigRevision(providerId)
    const save = windows.follower.store.patchProviderConfig(providerId, { apiKey: 'synthetic-rejected-canary' }).catch(() => {})
    await expect.poll(() => writes.started).toBe(true)
    const close = windows.caller.run(request('failed-write'))
    const setItem = Storage.prototype.setItem
    const failure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'settings/providers/local-configured-v1')
        throw new DOMException('Synthetic storage failure', 'QuotaExceededError')
      return setItem.call(this, key, value)
    })
    writes.gate.resolve()
    await save
    await expect(close).resolves.toMatchObject({ persisted: false })
    expect(windows.finalized).not.toHaveBeenCalled()
    expect(windows.leader.store.getProviderConfigRevision(providerId)).toBe(oldRevision)
    expect(windows.leader.store.getProvider(providerId)?.secretReference).toBeUndefined()
    failure.mockRestore()
    windows.caller.abort('failed-write')
    await expect(windows.caller.run({ ...request('retry-close'), scope: 'window' })).resolves.toMatchObject({ persisted: true })
    expect(fetch).not.toHaveBeenCalled()
  })
})
