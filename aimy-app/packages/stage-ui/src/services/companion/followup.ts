import type { CompanionScope } from '../../types/companion'

import * as v from 'valibot'

import { storage, updateRawLocal } from '../../database/storage'

// AionsHome MIT, Copyright (c) 2026 death34018-hue.
// Adapted timer replacement and single claim rules from proactive_companionship.py.
// Source: 8b7e5bfdb0e312fdc87bab65cebab8426ccee1c735d349a459371c44c079ab4a.
const id = v.pipe(v.string(), v.minLength(1), v.maxLength(256))
const time = v.pipe(v.number(), v.finite(), v.minValue(0))
const scopeSchema = v.strictObject({ principalId: id, characterId: id, sessionId: id })
const planSchema = v.strictObject({
  id,
  scope: scopeSchema,
  sourceId: id,
  createdAt: time,
  dueAt: time,
  expiresAt: time,
  state: v.picklist(['scheduled', 'claimed', 'delivered', 'cancelled', 'expired', 'failed', 'unknown']),
  activationEpoch: v.pipe(v.number(), v.integer(), v.minValue(0)),
  text: v.optional(v.pipe(v.string(), v.maxLength(6000))),
  claimedAt: v.optional(time),
  day: v.optional(v.string()),
  reason: v.optional(v.pipe(v.string(), v.maxLength(128))),
})
const envelopeSchema = v.strictObject({ version: v.literal(1), epoch: v.pipe(v.number(), v.integer(), v.minValue(0)), plans: v.array(planSchema) })
export type FollowupPlan = v.InferOutput<typeof planSchema>
type Envelope = v.InferOutput<typeof envelopeSchema>

function key(scope: CompanionScope) {
  v.parse(scopeSchema, scope)
  return `local:companion/followup/v1/${encodeURIComponent(scope.principalId)}/${encodeURIComponent(scope.characterId)}`
}

function envelope(raw: unknown): Envelope {
  return raw === undefined || raw === null ? { version: 1, epoch: 0, plans: [] } : v.parse(envelopeSchema, raw)
}

function dayFor(now: number) {
  const date = new Date(now)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

function quiet(now: number, start: number, end: number) {
  const hour = new Date(now).getHours()
  return start !== end && (start < end ? hour >= start && hour < end : hour >= start || hour < end)
}

/** Runtime guards are re-read after asynchronous boundaries. Only the stage leader invokes tick. */
export interface FollowupContext {
  enabled: boolean
  visible: boolean
  busy: boolean
  maxPerDay: number
  quietStartHour: number
  quietEndHour: number
  isSourceCurrent: (sourceId: string) => boolean
  isCurrent?: () => boolean
}

/** Owns one atomic plan and daily admission history per person and character. */
export class FollowupRepository {
  async read(scope: CompanionScope): Promise<FollowupPlan[]> {
    return structuredClone(envelope(await storage.getItemRaw(key(scope))).plans)
  }

  async schedule(scope: CompanionScope, sourceId: string, minutes: number | null, now: number): Promise<void> {
    v.parse(time, now)
    v.parse(id, sourceId)
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 60))
      throw new Error('Invalid followup delay')
    await updateRawLocal<unknown>(key(scope), (raw) => {
      const value = envelope(raw)
      value.epoch++
      for (const plan of value.plans) {
        if (plan.state === 'scheduled' || plan.state === 'claimed') {
          plan.state = 'cancelled'
          plan.reason = 'replaced'
        }
      }
      // Preserve this day's admissions even after cancellation or failure.
      value.plans = value.plans.filter(plan => plan.day === dayFor(now) || now - plan.createdAt < 7 * 86_400_000)
      if (minutes !== null)
        value.plans.push({ id: crypto.randomUUID(), scope: structuredClone(scope), sourceId, createdAt: now, dueAt: now + minutes * 60_000, expiresAt: now + (minutes + 60) * 60_000, state: 'scheduled', activationEpoch: value.epoch })
      return value
    })
  }

  async cancel(scope: CompanionScope, reason: string): Promise<void> {
    await updateRawLocal<unknown>(key(scope), (raw) => {
      const value = envelope(raw)
      value.epoch++
      for (const plan of value.plans) {
        if (plan.state === 'scheduled' || plan.state === 'claimed') {
          plan.state = 'cancelled'
          plan.reason = reason.slice(0, 128)
        }
      }
      return value
    })
  }

  /** Invoke once after acquiring stage ownership. Uncertain claims never automatically retry. */
  async recover(scope: CompanionScope): Promise<void> {
    await updateRawLocal<unknown>(key(scope), (raw) => {
      const value = envelope(raw)
      for (const plan of value.plans) {
        if (plan.state === 'claimed') {
          plan.state = 'unknown'
          plan.reason = 'interrupted-owner'
        }
      }
      return value
    })
  }

  async claim(scope: CompanionScope, context: FollowupContext, now: number): Promise<FollowupPlan | undefined> {
    v.parse(time, now)
    if (!Number.isInteger(context.maxPerDay) || context.maxPerDay < 1 || context.maxPerDay > 20)
      throw new Error('Invalid followup daily limit')
    for (const hour of [context.quietStartHour, context.quietEndHour]) {
      if (!Number.isInteger(hour) || hour < 0 || hour > 23)
        throw new Error('Invalid followup quiet hours')
    }
    let claimed: FollowupPlan | undefined
    await updateRawLocal<unknown>(key(scope), (raw) => {
      const value = envelope(raw)
      for (const plan of value.plans) {
        if (plan.state !== 'scheduled')
          continue
        if (now >= plan.expiresAt) {
          plan.state = 'expired'
          continue
        }
        if (plan.scope.sessionId !== scope.sessionId || !context.isSourceCurrent(plan.sourceId)) {
          plan.state = 'cancelled'
          plan.reason = 'source-or-session-changed'
          continue
        }
        if (!context.enabled || !context.visible || context.busy || context.isCurrent?.() === false || quiet(now, context.quietStartHour, context.quietEndHour) || now < plan.dueAt)
          continue
        const admissions = value.plans.filter(item => item.claimedAt !== undefined && item.day === dayFor(now))
        if (admissions.length >= context.maxPerDay || admissions.some(item => now - item.claimedAt! < 60_000))
          continue
        plan.state = 'claimed'
        plan.claimedAt = now
        plan.day = dayFor(now)
        claimed = structuredClone(plan)
        break
      }
      return value
    })
    return claimed
  }

  async isClaimCurrent(plan: FollowupPlan): Promise<boolean> {
    const value = envelope(await storage.getItemRaw(key(plan.scope)))
    return value.epoch === plan.activationEpoch && value.plans.some(item => item.id === plan.id && item.state === 'claimed')
  }

  async finish(plan: FollowupPlan, state: 'delivered' | 'failed' | 'cancelled', text?: string): Promise<void> {
    await updateRawLocal<unknown>(key(plan.scope), (raw) => {
      const value = envelope(raw)
      const current = value.plans.find(item => item.id === plan.id)
      if (current?.state === 'claimed' && current.activationEpoch === value.epoch) {
        current.state = state
        if (state === 'delivered' && text !== undefined)
          current.text = text
      }
      return value
    })
  }
}

/** Generation and presentation remain owned by AIRI. No synthetic user message is created. */
export interface FollowupEffects {
  generate: (plan: FollowupPlan, signal: AbortSignal, isCurrent: () => boolean) => Promise<string>
  deliver: (plan: FollowupPlan, text: string, isCurrent: () => boolean) => boolean
}

/** One stage owner drives this coordinator. Cancellation revokes in-flight output synchronously. */
export class FollowupCoordinator {
  private epoch = 0
  private controller?: AbortController
  private running = false
  private stopped = false

  constructor(private readonly repository: FollowupRepository, private readonly effects: FollowupEffects) {}

  schedule(scope: CompanionScope, sourceId: string, delayMinutes: number | null, now: number) {
    this.invalidate()
    return this.repository.schedule(scope, sourceId, delayMinutes, now)
  }

  cancel(scope: CompanionScope, reason: string) {
    this.invalidate()
    return this.repository.cancel(scope, reason)
  }

  recover(scope: CompanionScope) { return this.repository.recover(scope) }
  status(scope: CompanionScope) { return this.repository.read(scope) }

  private invalidate() {
    this.epoch++
    this.controller?.abort()
  }

  dispose() {
    this.stopped = true
    this.invalidate()
  }

  async tick(scope: CompanionScope, context: FollowupContext, now: number): Promise<void> {
    if (this.stopped || this.running)
      return
    this.running = true
    const epoch = this.epoch
    const controller = new AbortController()
    this.controller = controller
    let plan: FollowupPlan | undefined
    const isCurrent = () => !this.stopped && !controller.signal.aborted && epoch === this.epoch && context.enabled && context.visible && !context.busy && context.isCurrent?.() !== false && (!plan || context.isSourceCurrent(plan.sourceId))
    try {
      if (!isCurrent())
        return
      plan = await this.repository.claim(scope, context, now)
      if (!plan)
        return
      if (!isCurrent()) {
        await this.repository.finish(plan, 'cancelled')
        return
      }
      const text = await this.effects.generate(plan, controller.signal, isCurrent)
      if (!isCurrent() || !await this.repository.isClaimCurrent(plan) || !isCurrent()) {
        await this.repository.finish(plan, 'cancelled')
        return
      }
      if (text.length > 6000)
        throw new Error('Followup output exceeds display limit')
      const delivered = Boolean(text.trim()) && this.effects.deliver(plan, text, isCurrent)
      await this.repository.finish(plan, delivered ? 'delivered' : 'cancelled', text)
    }
    catch (error) {
      if (plan)
        await this.repository.finish(plan, controller.signal.aborted ? 'cancelled' : 'failed')
      throw error
    }
    finally {
      if (this.controller === controller)
        this.controller = undefined
      this.running = false
    }
  }
}
