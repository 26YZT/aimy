import type { MemoryCandidate, MemoryEnvelope, MemorySourceRef } from '../../types/memory'

import { describe, expect, it } from 'vitest'

import { applyCandidates, applyMutation, createEnvelope, getEffectiveFacts, getViewStatus, listMemorySnapshot, memoryDiagnosticSnapshot, packMemoryEvidence, profileSnapshot, selectCoreFacts, selectDueFacts, selectRelatedFacts } from './policy'
import { parseCandidates, parseEnvelope, parseMemoryListRequest, parseMemorySourceRequest, parseMutation } from './schema'

const scope = { principalId: 'test-person', characterId: 'test-character' }

function source(id: string, authoredAt = 100): MemorySourceRef {
  return { ...scope, kind: 'chat-message', sourceId: id, sourceRevision: 1, contentHash: `hash-${id}`, author: 'user', authoredAt, committedAt: authoredAt + 1, sessionId: 'test-session', messageId: id, activationId: 'activation-1', channel: 'text' }
}

function candidate(sourceId: string, text = '喜欢不太甜的栗子蛋糕'): MemoryCandidate {
  return { category: 'preference', subject: 'user', label: '甜品', text, keywords: ['栗子蛋糕'], sourceRefIds: [sourceId] }
}

function seeded(): { envelope: MemoryEnvelope, ref: MemorySourceRef, factId: string } {
  const envelope = createEnvelope(scope, 'activation-1')
  const ref = source('source-1')
  applyMutation(envelope, { type: 'enqueue-source', source: ref, jobId: 'job-1' }, 'enqueue-1', 102)
  const [factId] = applyCandidates(envelope, [candidate(ref.sourceId)], [ref], 'commit-1', 104)
  return { envelope, ref, factId }
}

describe('memory source and fact policies', () => {
  it('api-close keeps historical fact revisions separate from current and pending-source facts', () => {
    const { envelope, factId } = seeded()
    const newer = source('newer', 200)
    applyMutation(envelope, { type: 'enqueue-source', source: newer, jobId: 'job-new' }, 'enqueue-new', 201)
    applyCandidates(envelope, [{ ...candidate(newer.sourceId), targetFactId: factId }], [newer], 'update', 202)
    expect(listMemorySnapshot(envelope, { stateFilter: 'history' }).facts.map(fact => [fact.factId, fact.revision])).toEqual([[factId, 1]])
    expect(listMemorySnapshot(envelope, { stateFilter: 'current' }).facts.map(fact => fact.revision)).toEqual([2])
    applyMutation(envelope, { type: 'prepare-source-change', changeId: 'pending', sourceId: newer.sourceId, sourceRevision: 1 }, 'pending-source', 203)
    expect(listMemorySnapshot(envelope, { stateFilter: 'current' }).facts).toEqual([])
    expect(listMemorySnapshot(envelope, { stateFilter: 'history' }).facts.map(fact => fact.revision)).toEqual([1])
  })

  it('api-close rejects forged cursor fields and returns detached pages in deterministic order', () => {
    const { envelope, ref } = seeded()
    for (let index = 0; index < 54; index++)
      applyCandidates(envelope, [candidate(ref.sourceId)], [ref], `same-time-${String(index).padStart(2, '0')}`, 300)
    const first = listMemorySnapshot(envelope, { stateFilter: 'current' })
    const second = listMemorySnapshot(envelope, { stateFilter: 'current', cursor: first.nextCursor })
    expect(first.facts[0].factId).toBe('same-time-00:0')
    expect(second.facts).toHaveLength(5)
    first.facts[0].text = 'Changed response only'
    expect(envelope.facts.some(fact => fact.text === 'Changed response only')).toBe(false)
    const cursor = JSON.parse(decodeURIComponent(first.nextCursor!))
    expect(() => listMemorySnapshot(envelope, { stateFilter: 'current', cursor: encodeURIComponent(JSON.stringify({ ...cursor, offset: 1 })) })).toThrow('INVALID_INPUT')
    expect(() => listMemorySnapshot(envelope, { stateFilter: 'current', cursor: encodeURIComponent(JSON.stringify({ ...cursor, scope: { ...scope, principalId: 'other' } })) })).toThrow('SCOPE_MISMATCH')
    expect(() => listMemorySnapshot(envelope, { stateFilter: 'current', cursor: '%bad' })).toThrow('INVALID_INPUT')
    expect(() => parseMemoryListRequest({ stateFilter: 'all', limit: 9999 })).toThrow('INVALID_INPUT')
    expect(() => parseMemorySourceRequest({ factId: 'a', sourceId: 'b' })).toThrow('INVALID_INPUT')
  })

  it('api-close diagnoses metadata without copying fact text, raw sources or receipt result content', () => {
    const { envelope } = seeded()
    envelope.facts[0].text = 'PRIVATE_FACT_CANARY'
    const profile: MemorySourceRef = { ...scope, kind: 'onboarding-answer', sourceId: 'profile-secret', sourceRevision: 1, contentHash: 'synthetic-hash', author: 'user', authoredAt: 200, committedAt: 201, submissionId: 'private-profile', fieldId: 'recentMatter', initializationRevision: 1 }
    applyMutation(envelope, { type: 'submit-profile', submissionId: 'private-profile', skipped: false, sources: [{ ref: profile, text: 'PRIVATE_API_KEY_CANARY' }], candidates: [] }, 'private-profile-op', 202)
    const snapshot = memoryDiagnosticSnapshot(envelope)
    expect(snapshot.counts?.facts.current).toBe(1)
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE_FACT_CANARY')
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE_API_KEY_CANARY')
    expect(profileSnapshot(createEnvelope(scope, 'activation')).initialProfile).toBeNull()
  })

  it('rejects model-invented source U999', () => {
    const { envelope, ref } = seeded()
    expect(() => applyCandidates(envelope, [candidate('U999')], [ref], 'commit-2', 110)).toThrow('SOURCE_MISSING')
  })

  it('deduplicates exact references and retains the user confirmation time', () => {
    const envelope = createEnvelope(scope, 'activation-1')
    const ref = source('source-1', 500)
    applyMutation(envelope, { type: 'enqueue-source', source: ref, jobId: 'job-1' }, 'enqueue-1', 501)
    applyCandidates(envelope, [{ ...candidate(ref.sourceId), sourceRefIds: [ref.sourceId, ref.sourceId] }], [ref], 'commit-1', 800)
    expect(envelope.facts[0].sourceVersions).toHaveLength(1)
    expect(envelope.facts[0].confirmationAt).toBe(500)
    expect(envelope.facts[0].committedAt).toBe(800)
  })

  it('rejects another person and changed bytes under one source revision', () => {
    const { envelope, ref } = seeded()
    expect(() => applyMutation(envelope, { type: 'enqueue-source', source: { ...source('other'), principalId: 'other' }, jobId: 'job-2' }, 'enqueue-2', 102)).toThrow('SCOPE_MISMATCH')
    expect(() => applyMutation(envelope, { type: 'enqueue-source', source: { ...ref, contentHash: 'different' }, jobId: 'job-2' }, 'enqueue-2', 105)).toThrow('SOURCE_CHANGED')
  })

  it('requires the actual old source to be invalidated before accepting a new revision', () => {
    const { envelope, ref } = seeded()
    const next = { ...ref, sourceRevision: 2, contentHash: 'new-hash' }
    expect(() => applyMutation(envelope, { type: 'enqueue-source', source: next, jobId: 'job-2' }, 'enqueue-2', 105)).toThrow('SOURCE_CHANGED')
    applyMutation(envelope, { type: 'invalidate-source', sourceId: ref.sourceId, sourceRevision: 1, lifecycle: 'changed' }, 'edit-1', 105)
    applyMutation(envelope, { type: 'enqueue-source', source: next, jobId: 'job-2' }, 'enqueue-2', 106)
    expect(envelope.sources.map(item => item.lifecycle)).toEqual(['changed', 'current'])
  })

  it('keeps newer preferences when an older source finishes later', () => {
    const { envelope, factId } = seeded()
    const older = source('older', 50)
    applyMutation(envelope, { type: 'enqueue-source', source: older, jobId: 'job-old' }, 'enqueue-old', 110)
    expect(applyCandidates(envelope, [{ ...candidate('older', '不喜欢所有甜品'), targetFactId: factId }], [older], 'old-complete', 120)).toEqual([])
    expect(getEffectiveFacts(envelope)[0].text).toBe('喜欢不太甜的栗子蛋糕')
  })

  it('updates host-matched facts and preserves their superseded version', () => {
    const { envelope, factId } = seeded()
    const newer = source('newer', 200)
    applyMutation(envelope, { type: 'enqueue-source', source: newer, jobId: 'job-new' }, 'enqueue-new', 202)
    applyCandidates(envelope, [{ ...candidate('newer', '最近更喜欢水果'), targetFactId: factId }], [newer], 'new-complete', 205)
    expect(envelope.facts.map(fact => fact.status)).toEqual(['superseded', 'current'])
    expect(getEffectiveFacts(envelope)[0].revision).toBe(2)
  })

  it('removes F1 and its derived fact but retains independent F2 from the same sentence', () => {
    const { envelope, ref, factId } = seeded()
    const [otherId] = applyCandidates(envelope, [candidate(ref.sourceId, '喜欢安静的环境')], [ref], 'commit-2', 106)
    applyMutation(envelope, { type: 'derive-fact', dependsOnFactIds: [factId], label: '摘要', text: '喜欢栗子蛋糕', keywords: ['蛋糕'] }, 'derive', 108)
    applyMutation(envelope, { type: 'remove', factId }, 'remove', 110)
    expect(envelope.facts.find(fact => fact.factId === factId)?.status).toBe('removed')
    expect(envelope.facts.find(fact => fact.kind === 'derived')?.status).toBe('invalidated')
    expect(getEffectiveFacts(envelope).map(fact => fact.factId)).toEqual([otherId])
    expect(envelope.sources[0].lifecycle).toBe('current')
    expect(envelope.extractionBlocks[0].sourceId).toBe(ref.sourceId)
    expect(envelope.replayBlocks[0].sourceId).toBe(ref.sourceId)
  })

  it('blocks old-source recreation under another topic while permitting a new explicit source', () => {
    const { envelope, ref, factId } = seeded()
    applyMutation(envelope, { type: 'remove', factId }, 'remove', 110)
    expect(() => applyCandidates(envelope, [{ ...candidate(ref.sourceId), label: '换个主题' }], [ref], 'recreate', 112)).toThrow('SOURCE_SUPPRESSED')
    const next = source('new-statement', 120)
    applyMutation(envelope, { type: 'enqueue-source', source: next, jobId: 'job-new' }, 'enqueue-new', 122)
    applyCandidates(envelope, [candidate(next.sourceId)], [next], 'new-complete', 125)
    expect(getEffectiveFacts(envelope)).toHaveLength(1)
    expect(getEffectiveFacts(envelope)[0].factId).not.toBe(factId)
  })

  it('invalidates every direct fact when the actual source is deleted', () => {
    const { envelope, ref } = seeded()
    applyCandidates(envelope, [candidate(ref.sourceId, '喜欢安静')], [ref], 'commit-2', 106)
    applyMutation(envelope, { type: 'invalidate-source', sourceId: ref.sourceId, sourceRevision: 1, lifecycle: 'deleted' }, 'delete-source', 110)
    expect(getEffectiveFacts(envelope)).toEqual([])
    expect(envelope.sources[0].lifecycle).toBe('deleted')
  })

  it('cancels pending extraction on pause and rejects old activation after resuming', () => {
    const { envelope, ref } = seeded()
    applyMutation(envelope, { type: 'set-policy', enabled: false, activationId: 'activation-1' }, 'pause', 110)
    expect(envelope.jobs[0].status).toBe('cancelled')
    applyMutation(envelope, { type: 'set-policy', enabled: true, activationId: 'activation-2' }, 'resume', 112)
    expect(() => applyMutation(envelope, { type: 'enqueue-source', source: ref, jobId: 'backfill' }, 'old-source', 115)).toThrow('STALE_RESULT')
    expect(getEffectiveFacts(envelope)).toHaveLength(1)
  })

  it('does not treat a passed interview time as a completed or failed interview', () => {
    const { envelope } = seeded()
    const plan = { ...envelope.facts[0], category: 'plan' as const, planStatus: 'planned' as const, dueAt: 500 }
    expect(getViewStatus(plan, 600)).toBe('outcome-unknown')
    expect(plan.planStatus).toBe('planned')
  })
})

describe('memory schema and evidence selection', () => {
  it('rejects model ownership fields, dependency declarations, and invalid categories', () => {
    expect(() => parseCandidates([{ ...candidate('source-1'), factKey: 'host-key' }])).toThrow('INVALID_INPUT')
    expect(() => parseCandidates([{ ...candidate('source-1'), dependsOnFactIds: ['arbitrary'] }])).toThrow('INVALID_INPUT')
    expect(() => parseCandidates([{ ...candidate('source-1'), category: 'system' }])).toThrow('INVALID_INPUT')
  })

  it('rejects unsupported stored versions instead of creating an empty envelope', () => {
    expect(() => parseEnvelope({ ...createEnvelope(scope, 'a'), schemaVersion: 2 })).toThrow('SCHEMA_UNSUPPORTED')
  })

  it('rejects caller-supplied deletion dependency sets', () => {
    expect(() => parseMutation({ mutationId: 'remove', payloadDigest: 'digest', expectedRevision: 0, lease: { ownerId: 'owner', token: 1 }, now: 100, command: { type: 'remove', factId: 'fact', confirmedAffectedIds: ['other'] } })).toThrow('INVALID_INPUT')
  })

  it('returns no unrelated facts, including date-only cues, and honors limit zero', () => {
    const { envelope } = seeded()
    expect(selectRelatedFacts(envelope, '今天想看电影', 110)).toEqual([])
    expect(selectRelatedFacts(envelope, '2026-10-17 最近怎么样', 110)).toEqual([])
    expect(selectRelatedFacts(envelope, '想买栗子蛋糕', 110, 0)).toEqual([])
    expect(selectRelatedFacts(envelope, '想买栗子蛋糕', 110)[0].reasons).toEqual(['keyword:栗子蛋糕'])
  })

  it('excludes expired facts from topical recall without deleting the stored fact', () => {
    const { envelope } = seeded()
    envelope.facts[0].expiresAt = 110
    expect(selectRelatedFacts(envelope, '栗子蛋糕', 120)).toEqual([])
    expect(envelope.facts[0].status).toBe('current')
  })

  it('selects an authorized current nickname through the separate core profile', () => {
    const { envelope, ref } = seeded()
    applyCandidates(envelope, [{ ...candidate(ref.sourceId, '可以叫我团团'), category: 'identity', slot: 'preferred-name', keywords: ['团团'] }], [ref], 'nickname', 110)
    expect(selectCoreFacts(envelope, 120).map(item => item.fact.text)).toEqual(['可以叫我团团'])
  })

  it('packs complete evidence without cutting negative qualifiers or dates', () => {
    const { envelope } = seeded()
    envelope.facts[0].qualifier = '不是喜欢所有甜食，2026-10-17 只是近期偏好'
    const items = selectRelatedFacts(envelope, '栗子蛋糕', 110)
    const full = packMemoryEvidence(items, 4000)
    expect(full.text).toContain('不是喜欢所有甜食，2026-10-17 只是近期偏好')
    expect(full.includedFactIds).toHaveLength(1)
    const small = packMemoryEvidence(items, full.estimatedTokens - 1)
    expect(small.text).toBe('')
    expect(small.excludedFactIds).toHaveLength(1)
  })
})

describe('bounded recent plan recall', () => {
  it('requires a forgotten-plan cue and never marks a future birthday gift as purchased', () => {
    const { envelope, ref } = seeded()
    const now = 1_000_000_000
    const dueAt = now + 12 * 60 * 60 * 1000
    applyCandidates(envelope, [{ ...candidate(ref.sourceId, '明天妈妈生日，考虑买围巾'), category: 'plan', dueAt, planStatus: 'planned', keywords: ['生日'] }], [ref], 'birthday', 110)
    const window = { from: now - 12 * 60 * 60 * 1000, to: now + 24 * 60 * 60 * 1000 }
    expect(selectDueFacts(envelope, '今天要看什么电影', now, window)).toEqual([])
    const result = selectDueFacts(envelope, '总觉得还有什么重要事情没做，想不起来了', now, window)
    expect(result).toHaveLength(1)
    expect(result[0].fact.planStatus).toBe('planned')
    expect(result[0].reasons).toEqual(['bounded-plan-window'])
  })

  it('uses an unknown outcome for a recent interview when the user returns tired', () => {
    const { envelope, ref } = seeded()
    const now = 1_000_000_000
    applyCandidates(envelope, [{ ...candidate(ref.sourceId, '今天下午两点有重要面试'), category: 'plan', dueAt: now - 6 * 60 * 60 * 1000, planStatus: 'planned', keywords: ['面试'] }], [ref], 'interview', 110)
    const result = selectDueFacts(envelope, '我回来啦，今天真的累死我了', now, { from: now - 12 * 60 * 60 * 1000, to: now + 12 * 60 * 60 * 1000 })
    expect(result[0].viewStatus).toBe('outcome-unknown')
    expect(result[0].fact.planStatus).toBe('planned')
  })

  it('rejects an unbounded historical window and honors a zero limit', () => {
    const { envelope } = seeded()
    expect(() => selectDueFacts(envelope, '忘了', 1_000_000_000, { from: 0, to: 1_000_000_001 })).toThrow('INVALID_INPUT')
    expect(selectDueFacts(envelope, '忘了', 1000, { from: 0, to: 2000 }, 0)).toEqual([])
  })
})

describe('source change intents', () => {
  it('temporarily isolates evidence and restores it when the actual chat write aborts', () => {
    const { envelope, ref, factId } = seeded()
    const epoch = envelope.memoryEpoch
    applyMutation(envelope, { type: 'prepare-source-change', changeId: 'change-1', sourceId: ref.sourceId, sourceRevision: 1, nextContentHash: 'edited-hash' }, 'prepare', 110)
    expect(envelope.sources[0].lifecycle).toBe('current')
    expect(getEffectiveFacts(envelope)).toEqual([])
    expect(envelope.sourceChanges[0].source).toEqual(ref)
    applyMutation(envelope, { type: 'finalize-source-change', changeId: 'change-1', outcome: 'aborted' }, 'abort', 115)
    expect(getEffectiveFacts(envelope).map(fact => fact.factId)).toEqual([factId])
    expect(envelope.extractionBlocks).toEqual([])
    expect(envelope.replayBlocks).toEqual([])
    expect(envelope.memoryEpoch).toBeGreaterThan(epoch)
    expect(envelope.jobs[0].status).toBe('cancelled')
  })

  it('keeps a later independent removal barrier when an earlier source edit aborts', () => {
    const { envelope, ref, factId } = seeded()
    applyMutation(envelope, { type: 'prepare-source-change', changeId: 'change-1', sourceId: ref.sourceId, sourceRevision: 1, nextContentHash: 'edited-hash' }, 'prepare', 110)
    applyMutation(envelope, { type: 'remove', factId }, 'user-remove', 112)
    applyMutation(envelope, { type: 'finalize-source-change', changeId: 'change-1', outcome: 'aborted' }, 'abort', 115)
    expect(getEffectiveFacts(envelope)).toEqual([])
    expect(envelope.replayBlocks.map(block => block.operationId)).toEqual(['user-remove'])
    expect(envelope.sources[0].lifecycle).toBe('current')
    expect(() => applyCandidates(envelope, [candidate(ref.sourceId)], [ref], 'replay', 120)).toThrow('SOURCE_SUPPRESSED')
  })

  it('marks the source changed only after host confirmation of the durable chat write', () => {
    const { envelope, ref } = seeded()
    applyMutation(envelope, { type: 'prepare-source-change', changeId: 'change-1', sourceId: ref.sourceId, sourceRevision: 1, nextContentHash: 'edited-hash' }, 'prepare', 110)
    expect(envelope.sources[0].lifecycle).toBe('current')
    applyMutation(envelope, { type: 'finalize-source-change', changeId: 'change-1', outcome: 'committed' }, 'finalize', 115)
    expect(envelope.sources[0].lifecycle).toBe('changed')
    expect(envelope.facts[0].status).toBe('invalidated')
    expect(envelope.sourceChanges[0].status).toBe('committed')
    expect(envelope.extractionBlocks.map(block => block.operationId)).toEqual(['finalize'])
  })
})
