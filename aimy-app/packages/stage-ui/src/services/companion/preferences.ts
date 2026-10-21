import type { CompanionPreferences } from '../../types/companion'

import * as v from 'valibot'

import { DEFAULT_COMPANION_PREFERENCES } from '../../types/companion'

const numberBetween = (minimum: number, maximum: number) => v.pipe(v.number(), v.integer(), v.minValue(minimum), v.maxValue(maximum))
const motionSchema = v.strictObject({ group: v.pipe(v.string(), v.minLength(1), v.maxLength(128)), weight: v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(1000)) })
const preferencesSchema = v.strictObject({
  followup: v.strictObject({ enabled: v.boolean(), delayMinutes: numberBetween(1, 60), maxPerDay: numberBetween(1, 20), quietStartHour: numberBetween(0, 23), quietEndHour: numberBetween(0, 23) }),
  review: v.strictObject({ idleEnabled: v.boolean(), cadence: v.picklist(['day', 'week', 'month']), maxItems: numberBetween(1, 20) }),
  speech: v.strictObject({ translationEnabled: v.boolean(), targetLanguage: v.pipe(v.string(), v.regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/)), directorEnabled: v.boolean(), style: v.picklist(['gentle', 'calm', 'lively']), echoFilterEnabled: v.boolean(), adaptiveSilenceEnabled: v.boolean() }),
  interaction: v.strictObject({ enabled: v.boolean(), minimumIntervalMs: numberBetween(0, 10000), avoidRecent: numberBetween(0, 5), models: v.record(v.pipe(v.string(), v.minLength(1), v.maxLength(256)), v.record(v.pipe(v.string(), v.minLength(1), v.maxLength(64)), v.pipe(v.array(motionSchema), v.maxLength(30)))) }),
})
let current = structuredClone(DEFAULT_COMPANION_PREFERENCES)
const listeners = new Set<() => void>()

export function parseCompanionPreferences(value: unknown): CompanionPreferences {
  return v.parse(preferencesSchema, value)
}

/** Read-only runtime projection. The settings owner persists and broadcasts changes first. */
export function getCompanionPreferences(): Readonly<CompanionPreferences> {
  return current
}

/** Applies an already persisted settings snapshot without creating a second persistence writer. */
export function applyCompanionPreferences(value: unknown): void {
  current = structuredClone(parseCompanionPreferences(value))
  for (const listener of listeners)
    listener()
}

export function onCompanionPreferencesChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
