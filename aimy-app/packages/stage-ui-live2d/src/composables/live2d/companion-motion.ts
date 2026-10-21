/** Optional settings enter from stage-ui. Live2D never imports its consuming application package. */
import type { MotionManager } from 'pixi-live2d-display/cubism4'

export interface CompanionMotionPreferences {
  enabled: boolean
  minimumIntervalMs: number
  avoidRecent: number
  models: Record<string, Record<string, Array<{ group: string, weight: number }>>>
}
export interface CompanionMotionCatalog { modelId: string, areas: string[], groups: string[] }

let preferences: CompanionMotionPreferences = { enabled: false, minimumIntervalMs: 800, avoidRecent: 2, models: {} }
const models = new Map<symbol, CompanionMotionCatalog>()
const listeners = new Set<() => void>()

export function setCompanionMotionPreferences(value: CompanionMotionPreferences): void {
  preferences = structuredClone(value)
}
export function getCompanionMotionCatalog(): readonly CompanionMotionCatalog[] {
  return structuredClone([...models.values()])
}
export function onCompanionMotionCatalogChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The loaded model registers actual groups and areas. Disposal removes only that model instance. */
export function registerCompanionMotionModel(catalog: CompanionMotionCatalog): () => void {
  const key = Symbol(catalog.modelId)
  models.set(key, structuredClone(catalog))
  for (const listener of listeners)
    listener()
  return () => {
    models.delete(key)
    for (const listener of listeners)
      listener()
  }
}

/** Preserve the SDK's exclusion of failed, active, and reserved motions before applying repeat spacing. */
export function eligibleIdleMotionIndices(manager: Pick<MotionManager<unknown, unknown>, 'definitions' | 'motionGroups'> & { state: Pick<MotionManager['state'], 'isActive'> }, group: string): number[] {
  const count = manager.definitions[group]?.length ?? 0
  return Array.from({ length: count }, (_, index) => index)
    .filter(index => manager.motionGroups[group]?.[index] !== null && !manager.state.isActive(group, index))
}

/**
 * Independent implementation of weighted region selection, inspired by OLV behavior, without its restricted frontend code.
 * Recent-choice avoidance and semantic hold follow Ryza conventions. Copyright (c) 2026 zeroa234. MIT.
 * State belongs to one loaded model. The existing motion manager owns timers, priorities, and playback.
 */
export class CompanionMotionPolicy {
  private lastTap = -Infinity
  private nextIdle = 0
  private semanticUntil = 0
  private recent: string[] = []
  private signature = ''

  constructor(private readonly modelId: string) {}

  private current() {
    const signature = JSON.stringify(preferences)
    if (this.signature !== signature) {
      this.signature = signature
      this.lastTap = -Infinity
      this.nextIdle = 0
      this.semanticUntil = 0
      this.recent = []
    }
    return preferences
  }

  /** Undefined means the caller retains AIRI's unconfigured body action. Null means a configured action was suppressed. */
  tap(areas: readonly string[], available: readonly string[], now: number, rng: () => number = Math.random): string | null | undefined {
    const settings = this.current()
    const mapping = settings.models[this.modelId]
    if (!settings.enabled || !mapping)
      return undefined
    const area = areas.find(candidate => Object.hasOwn(mapping, candidate))
    if (!area)
      return undefined
    if (now - this.lastTap < settings.minimumIntervalMs)
      return null
    const valid = mapping[area].filter(item => available.includes(item.group) && Number.isFinite(item.weight) && item.weight > 0)
    const fresh = valid.filter(item => !this.recent.includes(`tap:${item.group}`))
    const choices = fresh.length ? fresh : valid
    const total = choices.reduce((sum, item) => sum + item.weight, 0)
    if (!total)
      return null
    let point = Math.min(1 - Number.EPSILON, Math.max(0, rng())) * total
    for (const choice of choices) {
      point -= choice.weight
      if (point < 0) {
        this.lastTap = now
        this.remember(`tap:${choice.group}`, settings.avoidRecent)
        return choice.group
      }
    }
    return null
  }

  noteSemanticMotion(now: number): void {
    if (this.current().enabled)
      this.semanticUntil = now + 2300
  }

  /** Undefined preserves the SDK's idle choice. Null keeps it idle until the next allowed slot. */
  idle(group: string, indices: readonly number[], now: number, speaking: boolean, rng: () => number = Math.random): number | null | undefined {
    const settings = this.current()
    if (!settings.enabled || !settings.models[this.modelId])
      return undefined
    if (now < this.semanticUntil || now < this.nextIdle || indices.length < 1)
      return null
    const fresh = indices.filter(index => !this.recent.includes(`idle:${group}:${index}`))
    const choices = fresh.length ? fresh : indices
    const choice = choices[Math.floor(Math.min(1 - Number.EPSILON, Math.max(0, rng())) * choices.length)]
    this.remember(`idle:${group}:${choice}`, settings.avoidRecent)
    this.nextIdle = now + (speaking ? 1800 : 3800) + Math.max(0, Math.min(1, rng())) * (speaking ? 2000 : 3600)
    return choice
  }

  private remember(key: string, count: number) {
    this.recent.push(key)
    this.recent = count > 0 ? this.recent.slice(-count) : []
  }
}
