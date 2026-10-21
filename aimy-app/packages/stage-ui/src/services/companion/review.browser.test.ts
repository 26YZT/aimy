import type { MemoryFact } from '../../types/memory'

import { afterEach, describe, expect, it } from 'vitest'

import { storage } from '../../database/storage'
import { createReviewGroups, ReviewRepository } from './review'

const now = new Date(2026, 9, 18, 12).getTime()
const owned: string[] = []
function scope() {
  const principalId = crypto.randomUUID()
  owned.push(principalId)
  return { principalId, characterId: 'character', sessionId: 'session' }
}
function fact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  return { factId: 'fact', factKey: 'key', revision: 1, category: 'plan', subject: 'user', label: '围巾', text: '考虑买围巾，还没有买。', keywords: [], status: 'current', kind: 'direct', sourceVersions: [{ sourceId: 'source', sourceRevision: 1, contentHash: 'hash' }], dependsOnFactIds: [], confirmationAt: now, committedAt: now, ...overrides }
}
afterEach(async () => {
  for (const id of owned.splice(0)) await storage.removeItem(`local:companion/review/v1/${id}/character`)
})
describe('non-destructive derived reviews', () => {
  it('keeps complete negation and originals untouched', () => {
    const input = [fact()]
    const original = structuredClone(input)
    expect(createReviewGroups(input, 'day', 8, now)[0].entries[0].text).toBe('考虑买围巾，还没有买。')
    expect(input).toEqual(original)
  })
  it('groups local day, Monday week and month', () => {
    expect(createReviewGroups([fact()], 'day', 8, now)[0].period).toBe('2026-10-18')
    expect(createReviewGroups([fact()], 'week', 8, now)[0].period).toBe('2026-10-12')
    expect(createReviewGroups([fact()], 'month', 8, now)[0].period).toBe('2026-10')
  })
  it('excludes removed, expired and ungrounded entries', () => {
    expect(createReviewGroups([fact({ status: 'removed' }), fact({ expiresAt: now }), fact({ sourceVersions: [] })], 'day', 8, now)).toEqual([])
  })
  it('persists and invalidates changed source versions before display', async () => {
    const value = scope()
    await new ReviewRepository().create(value, [fact()], 'week', 8, now)
    expect((await new ReviewRepository().read(value, [fact()], now))[0].status).toBe('current')
    const revised = fact({ sourceVersions: [{ sourceId: 'source', sourceRevision: 2, contentHash: 'changed' }],
    })
    expect((await new ReviewRepository().read(value, [revised], now))[0].status).toBe('invalidated')
  })
  it('invalidates removed dependencies', async () => {
    const value = scope()
    await new ReviewRepository().create(value, [fact()], 'day', 8, now)
    expect((await new ReviewRepository().read(value, [], now))[0].status).toBe('invalidated')
  })
})
