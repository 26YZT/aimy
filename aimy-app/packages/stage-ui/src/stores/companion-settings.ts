import type { CompanionSettingsSnapshot } from '../services/companion/settings'

import { cloneDeep } from 'es-toolkit'
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

import { applyCompanionPreferences } from '../services/companion/preferences'
import { CompanionSettingsRepository } from '../services/companion/settings'
import { DEFAULT_COMPANION_PREFERENCES } from '../types/companion'

export const useCompanionSettingsStore = defineStore('companion-settings', () => {
  const snapshot = ref<CompanionSettingsSnapshot>({ schemaVersion: 1, revision: 0, preferences: structuredClone(DEFAULT_COMPANION_PREFERENCES), rules: [] })
  const ready = ref(false)
  const error = ref('')
  const repository = new CompanionSettingsRepository()
  let loading: Promise<void> | undefined

  // Remote snapshots change runtime behavior only. They never write a second persistence proposal.
  watch(snapshot, value => applyCompanionPreferences(cloneDeep(value.preferences)), { deep: true, immediate: true })

  async function load(): Promise<void> {
    if (ready.value)
      return
    loading ??= (async () => {
      try {
        snapshot.value = await repository.read()
        ready.value = true
        error.value = ''
      }
      catch {
        error.value = 'COMPANION_SETTINGS_LOAD_FAILED'
        throw new Error(error.value)
      }
      finally { loading = undefined }
    })()
    await loading
  }

  async function save(preferences: unknown, rules: unknown, expectedRevision: number): Promise<CompanionSettingsSnapshot> {
    if (!ready.value)
      throw new Error('COMPANION_SETTINGS_NOT_READY')
    try {
      const saved = await repository.save(preferences, rules, expectedRevision)
      snapshot.value = saved
      error.value = ''
      return cloneDeep(saved)
    }
    catch (cause) {
      error.value = cause instanceof Error && cause.message === 'COMPANION_SETTINGS_CONFLICT' ? cause.message : 'COMPANION_SETTINGS_SAVE_FAILED'
      throw new Error(error.value)
    }
  }

  async function reload(): Promise<void> {
    ready.value = false
    await load()
  }

  return { snapshot, ready, error, load, save, reload }
}, { synced: { actions: ['load', 'save', 'reload'], state: true } })
