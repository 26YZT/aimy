import type { CompanionScope } from '../../types/companion'
import type { FollowupContext } from './followup'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { storage } from '../../database/storage'
import { FollowupCoordinator, FollowupRepository } from './followup'

const scopes: CompanionScope[] = []
const now = new Date(2026, 9, 18, 12).getTime()
function scope() {
  const value = { principalId: crypto.randomUUID(), characterId: 'test', sessionId: 'session-1',
  }
  scopes.push(value)
  return value
}
function context(): FollowupContext {
  return { enabled: true, visible: true, busy: false, maxPerDay: 2, quietStartHour: 22, quietEndHour: 8, isSourceCurrent: () => true }
}
afterEach(async () => {
  for (const value of scopes.splice(0)) await storage.removeItem(`local:companion/followup/v1/${value.principalId}/test`)
})
describe('durable followup admission with real IndexedDB', () => {
  it('claims once across two owners and recovers uncertainty without retry', async () => {
    const value = scope()
    const repository = new FollowupRepository()
    await repository.schedule(value, 'source', 1, now)
    const results = await Promise.all([repository.claim(value, context(), now + 60_000), new FollowupRepository().claim(value, context(), now + 60_000)])
    expect(results.filter(Boolean)).toHaveLength(1)
    await new FollowupRepository().recover(value)
    expect((await repository.read(value))[0].state).toBe('unknown')
    expect(await repository.claim(value, context(), now + 70_000)).toBeUndefined()
  })
  it('counts cancelled admissions against daily limit', async () => {
    const value = scope()
    const repository = new FollowupRepository()
    const policy = { ...context(), maxPerDay: 1,
    }
    await repository.schedule(value, 'first', 1, now)
    await repository.claim(value, policy, now + 60_000)
    await repository.cancel(value, 'user-returned')
    await repository.schedule(value, 'second', 1, now + 120_000)
    expect(await repository.claim(value, policy, now + 180_000)).toBeUndefined()
  })
  it('honors cross-midnight quiet hours and expires missed plans', async () => {
    const value = scope()
    const repository = new FollowupRepository()
    const late = new Date(2026, 9, 18, 23).getTime()
    await repository.schedule(value, 'source', 1, late)
    expect(await repository.claim(value, context(), late + 60_000)).toBeUndefined()
    expect(await repository.claim(value, context(), late + 10 * 3_600_000)).toBeUndefined()
    expect((await repository.read(value))[0].state).toBe('expired')
  })
  it.each(['disabled', 'hidden', 'busy'] as const)('does not generate while %s', async (condition) => {
    const value = scope()
    const generate = vi.fn(async () => 'response')
    const coordinator = new FollowupCoordinator(new FollowupRepository(), { generate, deliver: () => true,
    })
    await coordinator.schedule(value, 'source', 1, now)
    const policy = context()
    if (condition === 'disabled')
      policy.enabled = false
    if (condition === 'hidden')
      policy.visible = false
    if (condition === 'busy')
      policy.busy = true
    await coordinator.tick(value, policy, now + 60_000)
    expect(generate).not.toHaveBeenCalled()
  })
  it('revokes late output synchronously during generation', async () => {
    const value = scope()
    let complete: ((text: string) => void) | undefined
    const generate = vi.fn(() => new Promise<string>((resolve) => {
      complete = resolve
    }))
    const deliver = vi.fn(() => true)
    const coordinator = new FollowupCoordinator(new FollowupRepository(), { generate, deliver,
    })
    await coordinator.schedule(value, 'source', 1, now)
    const pending = coordinator.tick(value, context(), now + 60_000)
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce())
    const cancelled = coordinator.cancel(value, 'new-message')
    complete?.('late')
    await Promise.all([pending, cancelled])
    expect(deliver).not.toHaveBeenCalled()
    expect((await coordinator.status(value))[0].state).toBe('cancelled')
  })
  it('checks fresh runtime state after generation', async () => {
    const value = scope()
    let current = true
    const deliver = vi.fn(() => true)
    const coordinator = new FollowupCoordinator(new FollowupRepository(), { generate: async () => {
      current = false
      return 'late'
    }, deliver })
    await coordinator.schedule(value, 'source', 1, now)
    await coordinator.tick(value, { ...context(), isCurrent: () => current }, now + 60_000)
    expect(deliver).not.toHaveBeenCalled()
  })
  it('publishes and persists one current reply', async () => {
    const value = scope()
    const deliver = vi.fn(() => true)
    const coordinator = new FollowupCoordinator(new FollowupRepository(), { generate: async () => 'Rest a bit', deliver,
    })
    await coordinator.schedule(value, 'source', 1, now)
    await coordinator.tick(value, context(), now + 60_000)
    await coordinator.tick(value, context(), now + 80_000)
    expect(deliver).toHaveBeenCalledOnce()
    expect((await coordinator.status(value))[0]).toMatchObject({ state: 'delivered', text: 'Rest a bit',
    })
  })
  it('rejects wrong sessions, removed sources and invalid delay', async () => {
    const value = scope()
    const repository = new FollowupRepository()
    await repository.schedule(value, 'source', 1, now)
    expect(await repository.claim({ ...value, sessionId: 'other' }, context(), now + 60_000)).toBeUndefined()
    await repository.schedule(value, 'source-2', 1, now)
    expect(await repository.claim(value, { ...context(), isSourceCurrent: () => false }, now + 60_000)).toBeUndefined()
    expect((await repository.read(value)).every(plan => plan.state === 'cancelled')).toBe(true)
    await expect(repository.schedule(value, 'source', 61, now)).rejects.toThrow('Invalid followup delay')
  })
})
