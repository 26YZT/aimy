import type { CompanionPreferences } from '../../types/companion'
import type { WorkflowRule } from './workflow'

import { storage, updateRawLocal } from '../../database/storage'
import { DEFAULT_COMPANION_PREFERENCES } from '../../types/companion'
import { parseCompanionPreferences } from './preferences'
import { parseRules } from './workflow'

export interface CompanionSettingsSnapshot {
  schemaVersion: 1
  revision: number
  preferences: CompanionPreferences
  rules: WorkflowRule[]
}

const settingsKey = 'local:companion/settings/v1'

function parseSnapshot(value: unknown): CompanionSettingsSnapshot {
  if (!value || typeof value !== 'object' || !('schemaVersion' in value) || value.schemaVersion !== 1
    || !('revision' in value) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0
    || !('preferences' in value) || !('rules' in value)) {
    throw new Error('COMPANION_SETTINGS_INVALID')
  }
  return { schemaVersion: 1, revision: Number(value.revision), preferences: parseCompanionPreferences(value.preferences), rules: parseRules(value.rules) }
}

function initialSnapshot(): CompanionSettingsSnapshot {
  return { schemaVersion: 1, revision: 0, preferences: structuredClone(DEFAULT_COMPANION_PREFERENCES), rules: [] }
}

/** One existing IndexedDB key owns companion settings. Conflicting editors must reload before saving. */
export class CompanionSettingsRepository {
  async read(): Promise<CompanionSettingsSnapshot> {
    const value = await storage.getItem(settingsKey)
    return value === null || value === undefined ? initialSnapshot() : parseSnapshot(value)
  }

  async save(preferences: unknown, rules: unknown, expectedRevision: number): Promise<CompanionSettingsSnapshot> {
    const nextPreferences = parseCompanionPreferences(preferences)
    const nextRules = parseRules(rules)
    let saved: CompanionSettingsSnapshot | undefined
    await updateRawLocal(settingsKey, (raw: unknown) => {
      const current = raw === null || raw === undefined ? initialSnapshot() : parseSnapshot(raw)
      if (current.revision !== expectedRevision)
        throw new Error('COMPANION_SETTINGS_CONFLICT')
      saved = { schemaVersion: 1, revision: current.revision + 1, preferences: nextPreferences, rules: nextRules }
      return saved
    })
    if (!saved)
      throw new Error('COMPANION_SETTINGS_NOT_SAVED')
    return structuredClone(saved)
  }
}
