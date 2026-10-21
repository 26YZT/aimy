import type { CompanionScope } from '../../types/companion'
import type { MemoryFact } from '../../types/memory'

import * as v from 'valibot'

import { storage, updateRawLocal } from '../../database/storage'

// AionsHome MIT (2026 death34018-hue): period grouping and source lineage.
// Ryza MIT (2026 zeroa234): session/summary organization. Source records stay intact.
const identifier = v.pipe(v.string(), v.minLength(1), v.maxLength(256))
const sourceSchema = v.strictObject({ sourceId: identifier, sourceRevision: v.number(), contentHash: v.string() })
const entrySchema = v.strictObject({ factId: identifier, revision: v.number(), text: v.string(), sourceVersions: v.array(sourceSchema) })
const reviewSchema = v.strictObject({
  id: identifier,
  period: v.string(),
  cadence: v.picklist(['day', 'week', 'month']),
  createdAt: v.number(),
  status: v.picklist(['current', 'invalidated']),
  entries: v.array(entrySchema),
})
const stateSchema = v.strictObject({ version: v.literal(1), reviews: v.array(reviewSchema) })
export type DerivedReview = v.InferOutput<typeof reviewSchema>
export type ReviewCadence = DerivedReview['cadence']

function key(scope: CompanionScope) {
  v.parse(identifier, scope.principalId)
  v.parse(identifier, scope.characterId)
  return `local:companion/review/v1/${encodeURIComponent(scope.principalId)}/${encodeURIComponent(scope.characterId)}`
}

function state(raw: unknown): v.InferOutput<typeof stateSchema> {
  return raw === undefined || raw === null ? { version: 1, reviews: [] } : v.parse(stateSchema, raw)
}

function periodFor(timestamp: number, cadence: ReviewCadence) {
  const date = new Date(timestamp)
  if (cadence === 'week')
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return cadence === 'month' ? `${date.getFullYear()}-${month}` : `${date.getFullYear()}-${month}-${day}`
}

function currentFact(fact: MemoryFact, now: number) {
  return fact.status === 'current' && (fact.expiresAt === undefined || fact.expiresAt > now) && fact.sourceVersions.length > 0
}

function validReview(review: DerivedReview, facts: readonly MemoryFact[], now: number) {
  return review.entries.every((entry) => {
    const fact = facts.find(item => item.factId === entry.factId && currentFact(item, now))
    return fact?.revision === entry.revision && fact.text === entry.text && entry.sourceVersions.length === fact.sourceVersions.length
      && entry.sourceVersions.every(source => fact.sourceVersions.some(item => item.sourceId === source.sourceId && item.sourceRevision === source.sourceRevision && item.contentHash === source.contentHash))
  })
}

/** Organizes whole confirmed entries. This digest is not model-generated factual understanding. */
export function createReviewGroups(facts: readonly MemoryFact[], cadence: ReviewCadence, maxItems: number, now: number): DerivedReview[] {
  if (!['day', 'week', 'month'].includes(cadence) || !Number.isInteger(maxItems) || maxItems < 1 || maxItems > 20 || !Number.isFinite(now) || now < 0)
    throw new Error('Invalid review options')
  const selected = facts.filter(fact => currentFact(fact, now)).sort((a, b) => b.committedAt - a.committedAt).slice(0, maxItems)
  const groups = new Map<string, DerivedReview>()
  for (const fact of selected) {
    const period = periodFor(fact.committedAt, cadence)
    let group = groups.get(period)
    if (!group) {
      group = { id: crypto.randomUUID(), period, cadence, createdAt: now, status: 'current', entries: [] }
      groups.set(period, group)
    }
    group.entries.push({ factId: fact.factId, revision: fact.revision, text: fact.text, sourceVersions: structuredClone(fact.sourceVersions) })
  }
  return [...groups.values()]
}

/** Persists derived display material only. Facts and their source messages remain owned by memory storage. */
export class ReviewRepository {
  async create(scope: CompanionScope, facts: readonly MemoryFact[], cadence: ReviewCadence, maxItems: number, now: number): Promise<DerivedReview[]> {
    const reviews = createReviewGroups(facts, cadence, maxItems, now)
    await updateRawLocal<unknown>(key(scope), (raw) => {
      const value = state(raw)
      for (const item of value.reviews) {
        if (!validReview(item, facts, now))
          item.status = 'invalidated'
      }
      for (const review of reviews) {
        // Same period is a refreshed projection, never a replacement for underlying facts.
        value.reviews = value.reviews.filter(item => item.cadence !== cadence || item.period !== review.period)
        value.reviews.push(review)
      }
      value.reviews = value.reviews.sort((a, b) => b.createdAt - a.createdAt).slice(0, 60)
      return value
    })
    return reviews
  }

  /** Requires a current facts snapshot. Changed dependencies invalidate stored projections before display. */
  async read(scope: CompanionScope, facts: readonly MemoryFact[], now: number): Promise<DerivedReview[]> {
    await updateRawLocal<unknown>(key(scope), (raw) => {
      const value = state(raw)
      for (const review of value.reviews) {
        if (!validReview(review, facts, now))
          review.status = 'invalidated'
      }
      return value
    })
    return structuredClone(state(await storage.getItemRaw(key(scope))).reviews)
  }
}
