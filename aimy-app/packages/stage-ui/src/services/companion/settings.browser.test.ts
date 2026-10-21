import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'
import type { App } from 'vue'

import { createPinia, disposePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from 'vue'

import { storage } from '../../database/storage'
import { useCompanionSettingsStore } from '../../stores/companion-settings'
import { DEFAULT_COMPANION_PREFERENCES } from '../../types/companion'
import { getCompanionPreferences } from './preferences'
import { CompanionSettingsRepository } from './settings'

const windows: Array<{ app: App, pinia: ReturnType<typeof createPinia>, runtime: SyncedPiniaRuntime }> = []
function closeWindows() {
  for (const { app, pinia, runtime } of windows.splice(0)) {
    app.unmount()
    runtime.dispose()
    disposePinia(pinia)
  }
}
function createWindow(namespace: string, leadership: 'leader-only' | 'follower-only') {
  const pinia = createPinia()
  const runtime = createSyncedPiniaPlugin({ namespace, leadership, callTimeout: 3000 })
  pinia.use(runtime.plugin)
  let store: ReturnType<typeof useCompanionSettingsStore> | undefined
  const app = createApp({ setup() {
    store = useCompanionSettingsStore()
    return () => null
  } })
  app.use(pinia).mount(document.createElement('div'))
  if (!store)
    throw new Error('TEST_SETTINGS_MISSING')
  windows.push({ app, pinia, runtime })
  return { store, runtime }
}
beforeEach(async () => {
  await storage.removeItem('local:companion/settings/v1')
})
afterEach(async () => {
  closeWindows()
  await storage.removeItem('local:companion/settings/v1')
})

describe('companion settings through real persistence and synced windows', () => {
  it('starts disabled, persists once, and restores from a fresh repository', async () => {
    const repository = new CompanionSettingsRepository()
    const initial = await repository.read()
    expect(initial.preferences.followup.enabled).toBe(false)
    expect(initial.preferences.speech.translationEnabled).toBe(false)
    const preferences = structuredClone(initial.preferences)
    preferences.followup.enabled = true
    const saved = await repository.save(preferences, [], 0)
    expect(saved.revision).toBe(1)
    expect((await new CompanionSettingsRepository().read()).preferences.followup.enabled).toBe(true)
  })

  it('allows only one simultaneous stale editor and preserves the winning value', async () => {
    const first = structuredClone(DEFAULT_COMPANION_PREFERENCES)
    const second = structuredClone(DEFAULT_COMPANION_PREFERENCES)
    first.followup.delayMinutes = 7
    second.followup.delayMinutes = 23
    const repository = new CompanionSettingsRepository()
    const results = await Promise.allSettled([repository.save(first, [], 0), repository.save(second, [], 0)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect((await repository.read()).revision).toBe(1)
  })

  it('rejects invalid preferences and invalid rules without replacing saved data', async () => {
    const repository = new CompanionSettingsRepository()
    await repository.save(DEFAULT_COMPANION_PREFERENCES, [], 0)
    await expect(repository.save({ ...DEFAULT_COMPANION_PREFERENCES, followup: { ...DEFAULT_COMPANION_PREFERENCES.followup, delayMinutes: 0 } }, [], 1)).rejects.toThrow()
    await expect(repository.save(DEFAULT_COMPANION_PREFERENCES, [{ conditions: [] }], 1)).rejects.toThrow()
    expect((await repository.read()).revision).toBe(1)
  })

  it('saves from a follower, broadcasts without another write, and survives owner replacement', async () => {
    const namespace = `companion-settings:${crypto.randomUUID()}`
    const leader = createWindow(namespace, 'leader-only')
    await expect.poll(() => leader.runtime.isLeader()).toBe(true)
    await leader.store.load()
    const follower = createWindow(namespace, 'follower-only')
    await expect.poll(() => follower.runtime.getLeaderId()).toBe(leader.runtime.participantId)
    await follower.store.load()
    const preferences = structuredClone(DEFAULT_COMPANION_PREFERENCES)
    preferences.speech.echoFilterEnabled = true
    const saved = await follower.store.save(preferences, [], 0)
    expect(saved.revision).toBe(1)
    await expect.poll(() => leader.store.snapshot.preferences.speech.echoFilterEnabled).toBe(true)
    await expect.poll(() => follower.store.snapshot.revision).toBe(1)
    expect((await new CompanionSettingsRepository().read()).revision).toBe(1)
    expect(getCompanionPreferences().speech.echoFilterEnabled).toBe(true)
    closeWindows()
    const next = createWindow(`companion-reopened:${crypto.randomUUID()}`, 'leader-only')
    await expect.poll(() => next.runtime.isLeader()).toBe(true)
    await next.store.load()
    expect(next.store.snapshot.preferences.speech.echoFilterEnabled).toBe(true)
    expect(next.store.snapshot.revision).toBe(1)
  })
})
