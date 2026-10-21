import type { MemoryCandidate, MemoryEnvelope, MemoryLeaseRef, MemoryModelRoute, MemoryMutation, MemoryOwnerLease, MemoryScope, MemorySourceRef } from '../../types/memory'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getEffectiveFacts } from '../../stores/memory/policy'
import { storage } from '../storage'
import { MemoryRepository } from './memory.repo'

const route: MemoryModelRoute = { providerId: 'synthetic-provider', modelId: 'synthetic-model', providerConfigRevision: 1, promptHash: 'synthetic-prompt' }
const ownedScopes: MemoryScope[] = []
let repo: MemoryRepository
let scope: MemoryScope
let lease: MemoryOwnerLease
let sequence: number

function newScope(): MemoryScope {
  const value = { principalId: `memory-test-${crypto.randomUUID()}`, characterId: 'synthetic-character' }
  ownedScopes.push(value)
  return value
}

function key(value: MemoryScope) {
  return `local:memory/v1/${encodeURIComponent(value.principalId)}/${encodeURIComponent(value.characterId)}`
}

function source(id: string, authoredAt = 1000): MemorySourceRef {
  return { ...scope, kind: 'chat-message', sourceId: id, sourceRevision: 1, contentHash: `hash-${id}`, author: 'user', authoredAt, committedAt: authoredAt + 1, sessionId: 'synthetic-session', messageId: id, activationId: 'activation-1', channel: 'text' }
}

function candidate(sourceId: string, text = '喜欢不太甜的栗子蛋糕'): MemoryCandidate {
  return { category: 'preference', subject: 'user', label: '甜品', text, keywords: ['栗子蛋糕'], sourceRefIds: [sourceId] }
}

async function state(): Promise<MemoryEnvelope> {
  const value = await repo.read(scope)
  if (!value)
    throw new Error('Missing synthetic test state')
  return value
}

async function mutate(command: MemoryMutation, id?: string, usingLease: MemoryLeaseRef = lease) {
  const mutationId = id ?? `mutation-${++sequence}`
  return await repo.mutate(scope, { mutationId, payloadDigest: mutationId, expectedRevision: (await state()).revision, lease: usingLease, now: 1100 + sequence, command })
}

async function startJob(id = 'source-1') {
  await mutate({ type: 'enqueue-source', source: source(id), jobId: `job-${id}` })
  return await repo.beginJob(scope, { jobId: `job-${id}`, lease, route, now: 1200 })
}

async function seedFacts() {
  const snapshot = await startJob()
  return await repo.commitCandidates(scope, {
    snapshot,
    currentRoute: route,
    lease,
    now: 1300,
    mutationId: 'commit-1',
    payloadDigest: 'commit-1',
    candidates: [candidate('source-1'), candidate('source-1', '喜欢安静的环境')],
  })
}

beforeEach(async () => {
  sequence = 0
  repo = new MemoryRepository()
  scope = newScope()
  lease = await repo.acquireOwner(scope, { ownerId: 'owner-1', now: 1000, leaseMs: 30_000, initialActivationId: 'activation-1' })
})

afterEach(async () => {
  for (const value of ownedScopes.splice(0))
    await storage.removeItem(key(value))
})

describe('memory repository with real IndexedDB', () => {
  it('api-close persists original policy result metadata across later changes and fresh repository reads', async () => {
    const request = { mutationId: 'recorded-pause', payloadDigest: 'recorded-pause', expectedRevision: 0, lease, now: 1100, command: { type: 'set-policy' as const, enabled: false, activationId: 'paused-activation' } }
    const first = await repo.mutate(scope, request)
    await mutate({ type: 'set-policy', enabled: true, activationId: 'resumed-activation' })
    const retried = await new MemoryRepository().mutate(scope, request)
    expect(retried).toEqual(first)
    expect(retried.result).toEqual({ kind: 'memory.setPolicy', enabled: false, activationId: 'paused-activation' })
    expect((await state()).policy.activationId).toBe('resumed-activation')
  })

  it('api-close accepts receipts without optional result metadata without rewriting their schema', async () => {
    await mutate({ type: 'set-policy', enabled: false, activationId: 'paused-activation' }, 'old-receipt')
    const old = await state()
    delete old.receipts[0].result
    await storage.setItemRaw(key(scope), old)
    const read = await new MemoryRepository().getOperation(scope, 'old-receipt')
    expect(read?.result).toBeUndefined()
    expect((await storage.getItemRaw<MemoryEnvelope>(key(scope)))?.receipts[0].result).toBeUndefined()
    expect((await state()).schemaVersion).toBe(1)
  })

  it('uses the same local mount as ordinary unstorage reads', async () => {
    const direct = await storage.getItemRaw<MemoryEnvelope>(key(scope))
    expect(direct?.scope).toEqual(scope)
    expect(direct?.policy).toEqual({ enabled: true, activationId: 'activation-1' })
    expect((await new MemoryRepository().read(scope))?.lease?.token).toBe(lease.token)
  })

  it('returns one original receipt after a duplicate command even with an old expected revision', async () => {
    const request = { mutationId: 'same', payloadDigest: 'same-payload', expectedRevision: 0, lease, now: 1100, command: { type: 'set-policy' as const, enabled: false, activationId: 'activation-1' } }
    const first = await repo.mutate(scope, request)
    const second = await repo.mutate(scope, request)
    expect(second).toEqual(first)
    expect((await state()).receipts).toHaveLength(1)
    expect((await state()).revision).toBe(1)
  })

  it('detects changed payload despite an unchanged caller-provided digest', async () => {
    await mutate({ type: 'set-policy', enabled: false, activationId: 'activation-1' }, 'same')
    await expect(mutate({ type: 'set-policy', enabled: true, activationId: 'activation-2' }, 'same')).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' })
    expect((await state()).policy.enabled).toBe(false)
  })

  it('rejects stale UI revisions without changing the persisted command state', async () => {
    await mutate({ type: 'set-policy', enabled: false, activationId: 'activation-1' })
    await expect(repo.mutate(scope, { mutationId: 'stale', payloadDigest: 'stale', expectedRevision: 0, lease, now: 1105, command: { type: 'set-policy', enabled: true, activationId: 'activation-2' } })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    expect((await state()).receipts).toHaveLength(1)
  })

  it('allows only one of two concurrent owners to claim a new scope', async () => {
    const isolated = newScope()
    const claims = await Promise.allSettled(['first', 'second'].map(ownerId => repo.acquireOwner(isolated, { ownerId, now: 1000, leaseMs: 10_000, initialActivationId: 'activation-1' })))
    expect(claims.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(claims.filter(result => result.status === 'rejected')).toHaveLength(1)
  })

  it('uses an increasing fence after expiry and rejects the previous owner', async () => {
    const next = await repo.acquireOwner(scope, { ownerId: 'owner-2', now: 31_001, leaseMs: 30_000, initialActivationId: 'unused' })
    expect(next.token).toBeGreaterThan(lease.token)
    await expect(mutate({ type: 'set-policy', enabled: false, activationId: 'activation-1' })).rejects.toMatchObject({ code: 'STALE_OWNER' })
  })

  it('does not let renewal create a new UI revision', async () => {
    const renewed = await repo.renewOwner(scope, lease, 2000, 30_000)
    expect(renewed.token).toBe(lease.token)
    expect(renewed.expiresAt).toBe(32_000)
    expect((await state()).revision).toBe(0)
  })

  it('revalidates policy after the model wait and does not save late facts', async () => {
    const snapshot = await startJob()
    await mutate({ type: 'set-policy', enabled: false, activationId: 'activation-1' })
    await expect(repo.commitCandidates(scope, { snapshot, currentRoute: route, lease, now: 1400, mutationId: 'late', payloadDigest: 'late', candidates: [candidate('source-1')] })).rejects.toMatchObject({ code: 'STALE_RESULT' })
    expect((await state()).facts).toEqual([])
    expect((await state()).jobs[0].status).toBe('cancelled')
  })

  it('rejects changed provider configuration without treating it as another valid route', async () => {
    const snapshot = await startJob()
    await expect(repo.commitCandidates(scope, { snapshot, currentRoute: { ...route, providerConfigRevision: 2 }, lease, now: 1400, mutationId: 'late', payloadDigest: 'late', candidates: [candidate('source-1')] })).rejects.toMatchObject({ code: 'STALE_RESULT' })
    expect((await state()).facts).toEqual([])
  })

  it('rejects all candidates atomically when a later candidate invents a source', async () => {
    const snapshot = await startJob()
    await expect(repo.commitCandidates(scope, { snapshot, currentRoute: route, lease, now: 1400, mutationId: 'bad', payloadDigest: 'bad', candidates: [candidate('source-1'), candidate('U999')] })).rejects.toMatchObject({ code: 'SOURCE_MISSING' })
    expect((await state()).facts).toEqual([])
    expect(await repo.getOperation(scope, 'bad')).toBeNull()
  })

  it('persists fact and operation evidence across a new repository instance', async () => {
    const receipt = await seedFacts()
    const reopened = new MemoryRepository()
    expect((await reopened.read(scope))?.facts).toHaveLength(2)
    expect(await reopened.getOperation(scope, 'commit-1')).toEqual(receipt)
  })

  it('removes F1 and its actual derived dependency while leaving same-source F2 recallable', async () => {
    const saved = await seedFacts()
    await mutate({ type: 'derive-fact', dependsOnFactIds: [saved.factIds[0]], label: '摘要', text: '栗子蛋糕偏好', keywords: ['栗子蛋糕'] })
    await mutate({ type: 'remove', factId: saved.factIds[0] })
    const persisted = await state()
    expect(getEffectiveFacts(persisted).map(fact => fact.factId)).toEqual([saved.factIds[1]])
    expect(persisted.sources[0].lifecycle).toBe('current')
    expect(persisted.replayBlocks[0].sourceId).toBe('source-1')
    expect(persisted.facts.find(fact => fact.kind === 'derived')?.status).toBe('invalidated')
  })

  it('blocks new jobs from removed source versions while preserving chat references', async () => {
    const saved = await seedFacts()
    await mutate({ type: 'remove', factId: saved.factIds[0] })
    await expect(mutate({ type: 'enqueue-source', source: source('source-1'), jobId: 'new-topic-job' })).rejects.toMatchObject({ code: 'SOURCE_SUPPRESSED' })
    expect((await state()).sources[0].ref.kind).toBe('chat-message')
  })

  it('isolates identical source IDs across principals and characters', async () => {
    await seedFacts()
    const other = newScope()
    await repo.acquireOwner(other, { ownerId: 'other-owner', now: 1000, leaseMs: 10_000, initialActivationId: 'activation-1' })
    expect((await repo.read(other))?.facts).toEqual([])
    expect(await repo.getOperation(other, 'commit-1')).toBeNull()
  })

  it('fails closed for unsupported persisted schema without overwriting the record', async () => {
    const bad = { ...(await state()), schemaVersion: 9 }
    await storage.setItemRaw(key(scope), bad)
    await expect(repo.read(scope)).rejects.toMatchObject({ code: 'SCHEMA_UNSUPPORTED' })
    expect((await storage.getItemRaw<{ schemaVersion: number }>(key(scope)))?.schemaVersion).toBe(9)
  })

  it('persists failure and starts another attempt only after explicit retry', async () => {
    const snapshot = await startJob()
    expect(await repo.failJob(scope, { snapshot, lease, now: 1300, reason: 'MODEL_UNAVAILABLE' })).toBe(true)
    expect((await state()).jobs[0].status).toBe('failed')
    await expect(repo.beginJob(scope, { jobId: snapshot.jobId, lease, route, now: 1400 })).rejects.toMatchObject({ code: 'STALE_RESULT' })
    await repo.retryJob(scope, { jobId: snapshot.jobId, lease, now: 1500 })
    const retried = await repo.beginJob(scope, { jobId: snapshot.jobId, lease, route, now: 1600 })
    expect(retried.attempt).toBe(snapshot.attempt + 1)
    await expect(repo.commitCandidates(scope, { snapshot, currentRoute: route, lease, now: 1700, mutationId: 'old-attempt', payloadDigest: 'old-attempt', candidates: [candidate('source-1')] })).rejects.toMatchObject({ code: 'STALE_RESULT' })
  })

  it('defers only the matching running attempt and cannot resurrect a paused job', async () => {
    const snapshot = await startJob()
    expect(await repo.deferJob(scope, { snapshot, lease, now: 1300 })).toBe(true)
    const resumed = await repo.beginJob(scope, { jobId: snapshot.jobId, lease, route, now: 1400 })
    expect(await repo.deferJob(scope, { snapshot, lease, now: 1500 })).toBe(false)
    await mutate({ type: 'set-policy', enabled: false, activationId: 'activation-1' })
    expect(await repo.deferJob(scope, { snapshot: resumed, lease, now: 1600 })).toBe(false)
    expect((await state()).jobs[0].status).toBe('cancelled')
  })

  it('recovers an interrupted running job after owner replacement without accepting its old completion', async () => {
    const snapshot = await startJob()
    const next = await repo.acquireOwner(scope, { ownerId: 'owner-2', now: 31_001, leaseMs: 30_000, initialActivationId: 'unused' })
    expect((await state()).jobs[0].status).toBe('pending')
    const recovered = await repo.beginJob(scope, { jobId: snapshot.jobId, lease: next, route, now: 31_100 })
    expect(recovered.attempt).toBe(snapshot.attempt + 1)
    await expect(repo.commitCandidates(scope, { snapshot, currentRoute: route, lease, now: 31_200, mutationId: 'old-owner', payloadDigest: 'old-owner', candidates: [candidate('source-1')] })).rejects.toMatchObject({ code: 'STALE_OWNER' })
  })
})

describe('persisted source change recovery', () => {
  it('retains an unresolved intent for the host to compare with the actual chat record after restart', async () => {
    await seedFacts()
    await mutate({ type: 'prepare-source-change', changeId: 'editing', sourceId: 'source-1', sourceRevision: 1, nextContentHash: 'next-hash' })
    const reopened = await new MemoryRepository().read(scope)
    expect(reopened?.sourceChanges[0].status).toBe('pending')
    expect(reopened?.sourceChanges[0].source.kind).toBe('chat-message')
    expect(reopened?.sourceChanges[0].nextContentHash).toBe('next-hash')
    expect(reopened?.sources[0].lifecycle).toBe('current')
    if (!reopened)
      throw new Error('Missing synthetic record')
    expect(getEffectiveFacts(reopened)).toEqual([])
    await mutate({ type: 'finalize-source-change', changeId: 'editing', outcome: 'aborted' })
    expect(getEffectiveFacts(await state())).toHaveLength(2)
  })

  it('does not restore an old running result when a failed source edit is rolled back', async () => {
    const snapshot = await startJob()
    await mutate({ type: 'prepare-source-change', changeId: 'editing', sourceId: 'source-1', sourceRevision: 1, nextContentHash: 'next-hash' })
    await mutate({ type: 'finalize-source-change', changeId: 'editing', outcome: 'aborted' })
    await expect(repo.commitCandidates(scope, { snapshot, currentRoute: route, lease, now: 1400, mutationId: 'late', payloadDigest: 'late', candidates: [candidate('source-1')] })).rejects.toMatchObject({ code: 'STALE_RESULT' })
    expect((await state()).facts).toEqual([])
    expect((await state()).sources[0].lifecycle).toBe('current')
  })
})
