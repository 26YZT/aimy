/** Optional companion behavior. Disabled features preserve the existing AIRI path. */
export interface CompanionPreferences {
  followup: { enabled: boolean, delayMinutes: number, maxPerDay: number, quietStartHour: number, quietEndHour: number }
  review: { idleEnabled: boolean, cadence: 'day' | 'week' | 'month', maxItems: number }
  speech: { translationEnabled: boolean, targetLanguage: string, directorEnabled: boolean, style: 'gentle' | 'calm' | 'lively', echoFilterEnabled: boolean, adaptiveSilenceEnabled: boolean }
  interaction: { enabled: boolean, minimumIntervalMs: number, avoidRecent: number, models: Record<string, Record<string, Array<{ group: string, weight: number }>>> }
}

export const DEFAULT_COMPANION_PREFERENCES: Readonly<CompanionPreferences> = {
  followup: { enabled: false, delayMinutes: 15, maxPerDay: 4, quietStartHour: 22, quietEndHour: 8 },
  review: { idleEnabled: false, cadence: 'week', maxItems: 8 },
  speech: { translationEnabled: false, targetLanguage: 'ja', directorEnabled: false, style: 'gentle', echoFilterEnabled: false, adaptiveSilenceEnabled: false },
  interaction: { enabled: false, minimumIntervalMs: 800, avoidRecent: 2, models: {} },
}

/** Runtime identity is captured before an asynchronous operation and rechecked before side effects. */
export interface CompanionScope {
  principalId: string
  characterId: string
  sessionId: string
}
