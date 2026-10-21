import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'

import type { ChatHistoryItem } from '../types/chat'
import type { ChatMemoryEligibility, ChatSessionRecord } from '../types/chat-session'
import type { InitialMemoryProfile, MemoryActionReceipt, MemoryCandidate, MemoryDiagnosticsSummary, MemoryEnvelope, MemoryFact, MemoryListRequest, MemoryListSnapshot, MemoryModelPolicy, MemoryModelRoute, MemoryMutation, MemoryOwnerLease, MemoryProfileSnapshot, MemoryReadRequest, MemoryReceipt, MemoryScope, MemorySourceRef, MemorySourceRequest, MemorySourceSnapshot, MemoryWriteOptions } from '../types/memory'

import { streamFrom } from '@proj-airi/core-agent'
import { nanoid } from 'nanoid'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { chatSessionsRepo } from '../database/repos/chat-sessions.repo'
import { memoryRepository } from '../database/repos/memory.repo'
import { acceptanceAttemptGate } from '../services/acceptance-generation'
import { conversationClock } from '../services/conversation-clock'
import { configureMemorySessionPort, memoryContentHash } from '../services/memory-session'
import { getResourcePolicy } from '../services/resource-policy'
import { useAuthStore } from './auth'
import { assertOwner, getEffectiveFacts, listMemorySnapshot, memoryDiagnosticSnapshot, packMemoryEvidence, profileSnapshot, selectCoreFacts, selectDueFacts, selectMemoryLineage, selectRelatedFacts } from './memory/policy'
import { AIMY_COMPANION_PROMPT, MEMORY_EVIDENCE_PROMPT, MEMORY_EXTRACTION_PROMPT, MEMORY_OUTPUT_SCHEMA } from './memory/prompts'
import { MemoryOperationError, parseCandidates, parseInitialMemoryProfile, parseMemoryListRequest, parseMemoryModelPolicy, parseMemoryReadRequest, parseMemorySourceRequest, parseMemoryWriteOptions } from './memory/schema'
import { useAiriCardStore } from './modules/airi-card'
import { useConsciousnessStore } from './modules/consciousness'
import { useConsciousnessSettingsStore } from './modules/consciousness-settings'
import { useProviderConfigStore } from './providers/config'
import { useProviderStore } from './providers/provider'

export type { InitialMemoryProfile } from '../types/memory'

const emptyReadRequest: MemoryReadRequest = Object.freeze({})

function actionReceipt(receipt: MemoryReceipt): MemoryActionReceipt {
  return { ...structuredClone(receipt), resultStatus: receipt.result === undefined ? 'not-recorded' : 'recorded' }
}

const chatPreferences: Record<string, string> = {
  'listen-first': '聊天时希望先听我说，先理解心情，不急着给建议。',
  'talk-it-through': '聊天时喜欢一起梳理问题、想办法。',
  'lighthearted': '聊天时通常喜欢轻松自然的交流，也要尊重当下情绪。',
}

function sameScope(left: MemoryScope | null, right: MemoryScope | null) {
  return !!left && !!right && left.principalId === right.principalId && left.characterId === right.characterId
}

/** Audio enters memory only through its final transcript; images, tools and assistant text are not evidence. */
export function memorySourceText(message: ChatHistoryItem | undefined) {
  if (message?.role !== 'user')
    return ''
  if (Array.isArray(message.content) && message.content.some(part => part.type === 'input_audio'))
    return (message.audioTranscripts ?? []).filter(Boolean).join('\n').trim()
  if (typeof message.content === 'string')
    return message.content.trim()
  return message.content.filter(part => part.type === 'text').map(part => part.text).join('\n').trim()
}

/** One elected AIRI renderer owns writes. Other windows receive only the small UI projection and routed actions. */
export const useMemoryStore = defineStore('aimy-memory', () => {
  const auth = useAuthStore()
  const cards = useAiriCardStore()
  const consciousness = useConsciousnessStore()
  const consciousnessSettings = useConsciousnessSettingsStore()
  const providers = useProviderStore()
  const providerConfig = useProviderConfigStore()
  const ready = ref(false)
  const busy = ref(false)
  const error = ref<string | null>(null)
  const scope = ref<MemoryScope | null>(null)
  const facts = ref<MemoryFact[]>([])
  const enabled = ref(true)
  const modelPolicy = ref<MemoryModelPolicy>({ mode: 'follow-chat' })
  const profileState = ref<'unanswered' | 'submitted' | 'skipped'>('unanswered')
  const revision = ref(0)
  const failedJobCount = ref(0)
  const pendingJobCount = ref(0)
  const memoryEpoch = ref(0)
  const recovering = ref(false)
  const recoveryUntil = ref<number | null>(null)

  let envelope: MemoryEnvelope | null = null
  let lease: MemoryOwnerLease | undefined
  let runtime: SyncedPiniaRuntime | undefined
  let initialized = false
  let stopped = false
  let ownerEpoch = 0
  let contextEpoch = 0
  let queue: Promise<unknown> = Promise.resolve()
  let worker: Promise<void> | undefined
  let workerAbort: AbortController | undefined
  let conversationCount = 0
  let workRequested = false
  let renewTimer: ReturnType<typeof setInterval> | undefined
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined
  let stopLeadership: (() => void) | undefined
  let stopIdentityWatch: (() => void) | undefined
  let stopRouteWatch: (() => void) | undefined
  let promptHash = ''
  const ownerId = nanoid()
  const invalidationListeners = new Set<() => void>()
  const pendingLocalWrites = new Set<string>()
  const persistenceFailures = new Set<string>()
  const persistenceTargets = new Map<string, { scope: MemoryScope, target: string }>()
  const operationTargets = new Map<string, string>()

  const canWork = computed(() => ready.value && enabled.value)

  function currentScope(): MemoryScope {
    if (!initialized)
      throw new MemoryOperationError('NOT_READY')
    return { principalId: auth.userId || 'local', characterId: cards.activeCardId || 'default' }
  }

  function persistenceKey(targetScope: MemoryScope, target: string) {
    const key = JSON.stringify([targetScope.principalId, targetScope.characterId, target])
    persistenceTargets.set(key, { scope: { ...targetScope }, target })
    return key
  }

  function hasStorageEffect(error: unknown) {
    return !(error instanceof MemoryOperationError)
      || ['STORAGE_FAILED', 'STORAGE_CORRUPT', 'SCHEMA_UNSUPPORTED'].includes(error.code)
  }

  function clearReportedError() {
    error.value = persistenceFailures.size ? 'MEMORY_PERSISTENCE_UNRESOLVED' : null
  }

  async function persist<T>(key: string, task: () => Promise<T>): Promise<T> {
    try {
      const result = await task()
      persistenceFailures.delete(key)
      return result
    }
    catch (caught) {
      if (hasStorageEffect(caught)) {
        persistenceFailures.add(key)
        error.value = 'MEMORY_PERSISTENCE_UNRESOLVED'
        if (!(caught instanceof MemoryOperationError))
          throw new MemoryOperationError('STORAGE_FAILED')
      }
      throw caught
    }
  }

  function mutationTarget(command: MemoryMutation, operationId: string) {
    switch (command.type) {
      case 'set-policy': return 'policy'
      case 'set-model-policy': return 'model-policy'
      case 'submit-profile': return `profile:${command.submissionId}`
      case 'correct':
      case 'remove': return `fact:${command.factId}`
      case 'enqueue-source': return `source:${command.source.sourceId}:${command.source.sourceRevision}`
      case 'invalidate-source':
      case 'prepare-source-change': return `source-change:${command.sourceId}:${command.sourceRevision}`
      case 'finalize-source-change': {
        const change = envelope?.sourceChanges.find(item => item.changeId === command.changeId)
        return change ? `source-change:${change.source.sourceId}:${change.source.sourceRevision}` : `operation:${operationId}`
      }
      case 'derive-fact': return `operation:${operationId}`
    }
  }

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = queue.then(task, task)
    queue = next.catch(() => {})
    return next
  }

  function suspendWork() {
    workerAbort?.abort(new DOMException('Memory work deferred', 'AbortError'))
  }

  /** Revocation is synchronous; persistence can safely follow without releasing stale results. */
  function revoke() {
    contextEpoch++
    suspendWork()
    for (const listener of invalidationListeners)
      listener()
  }

  function onInvalidated(listener: () => void) {
    invalidationListeners.add(listener)
    return () => invalidationListeners.delete(listener)
  }

  function checkOwner() {
    if (stopped || !runtime?.isLeader() || !lease || !envelope || !sameScope(envelope.scope, currentScope()))
      throw new MemoryOperationError('NOT_READY')
    assertOwner(envelope, lease, Date.now())
    return { scope: envelope.scope, lease }
  }

  function publish(value: MemoryEnvelope) {
    if (!sameScope(value.scope, currentScope()))
      throw new MemoryOperationError('SCOPE_MISMATCH')
    envelope = value
    scope.value = { ...value.scope }
    facts.value = getEffectiveFacts(value)
    enabled.value = value.policy.enabled
    modelPolicy.value = { ...value.modelPolicy }
    profileState.value = value.profile.state
    revision.value = value.revision
    memoryEpoch.value = value.memoryEpoch
    failedJobCount.value = value.jobs.filter(job => job.status === 'failed').length
    pendingJobCount.value = value.jobs.filter(job => job.status === 'pending' || job.status === 'running').length
    ready.value = true
  }

  async function readOwned() {
    const owned = checkOwner()
    const epoch = ownerEpoch
    const value = await memoryRepository.read(owned.scope)
    if (epoch !== ownerEpoch || !sameScope(owned.scope, currentScope()))
      throw new MemoryOperationError('STALE_OWNER')
    if (!value)
      throw new MemoryOperationError('NOT_READY')
    assertOwner(value, owned.lease, Date.now())
    publish(value)
    return value
  }

  async function previousOperation(operationId: string, input: unknown) {
    const owned = checkOwner()
    const payloadDigest = await memoryContentHash(JSON.stringify(input))
    const receipt = await memoryRepository.getOperation(owned.scope, operationId)
    if (receipt && receipt.payloadDigest !== payloadDigest)
      throw new MemoryOperationError('IDEMPOTENCY_MISMATCH')
    if (receipt) {
      await readOwned()
      const target = operationTargets.get(persistenceKey(owned.scope, operationId))
      if (target)
        persistenceFailures.delete(target)
    }
    return receipt
  }

  async function commit(command: MemoryMutation, operationId = nanoid(), input: unknown = command) {
    const value = await readOwned()
    const owned = checkOwner()
    const payloadDigest = await memoryContentHash(JSON.stringify(input))
    checkOwner()
    const target = persistenceKey(owned.scope, mutationTarget(command, operationId))
    operationTargets.set(persistenceKey(owned.scope, operationId), target)
    const receipt = await persist(target, () => memoryRepository.mutate(owned.scope, {
      mutationId: operationId,
      payloadDigest,
      expectedRevision: value.revision,
      lease: owned.lease,
      now: Date.now(),
      command,
    }))
    await readOwned()
    return receipt
  }

  function rememberFailure(caught: unknown) {
    error.value = caught instanceof MemoryOperationError ? caught.code : 'MEMORY_UNAVAILABLE'
  }

  async function sourceText(ref: MemorySourceRef) {
    if (ref.kind !== 'chat-message') {
      const saved = envelope?.sources.find(source => source.ref.sourceId === ref.sourceId && source.ref.sourceRevision === ref.sourceRevision)
      if (!saved || saved.lifecycle !== 'current')
        throw new MemoryOperationError('SOURCE_MISSING')
      return saved.text ?? ''
    }
    const record = await chatSessionsRepo.getSession(ref.sessionId)
    checkOwner()
    if (!record || record.meta.userId !== ref.principalId || record.meta.characterId !== ref.characterId)
      throw new MemoryOperationError('SOURCE_MISSING')
    const text = memorySourceText(record.messages.find(message => message.id === ref.messageId))
    if (!text || await memoryContentHash(text) !== ref.contentHash)
      throw new MemoryOperationError('SOURCE_CHANGED')
    return text
  }

  async function makeChatSource(record: ChatSessionRecord, input: ChatMemoryEligibility, sourceRevision = 1): Promise<MemorySourceRef | undefined> {
    const message = record.messages.find(item => item.id === input.messageId)
    const text = memorySourceText(message)
    if (!text)
      return
    return {
      ...currentScope(),
      kind: 'chat-message',
      author: 'user',
      sourceId: `chat:${record.meta.sessionId}:${input.messageId}`,
      sourceRevision,
      contentHash: await memoryContentHash(text),
      authoredAt: input.authoredAt,
      committedAt: Date.now(),
      sessionId: record.meta.sessionId,
      messageId: input.messageId,
      activationId: input.activationId,
      channel: Array.isArray(message?.content) && message.content.some(part => part.type === 'input_audio') ? 'voice-final' : 'text',
    }
  }

  function assertRecordScope(record: ChatSessionRecord) {
    checkOwner()
    if (record.meta.userId !== scope.value?.principalId || record.meta.characterId !== scope.value.characterId)
      throw new MemoryOperationError('SCOPE_MISMATCH')
  }

  async function prepareInput(record: ChatSessionRecord, messageId: string) {
    return enqueue(async () => {
      assertRecordScope(record)
      const value = await readOwned()
      if (!value.policy.enabled)
        return null
      const message = record.messages.find(item => item.id === messageId && item.role === 'user')
      if (!message)
        return null
      const eligibility = { messageId, activationId: value.policy.activationId, authoredAt: message.createdAt ?? Date.now() }
      const source = await makeChatSource(record, eligibility)
      checkOwner()
      return { eligibility, ...(source ? { source } : {}) }
    })
  }

  async function prepareSourceChange(ref: MemorySourceRef, nextText: string) {
    const value = await readOwned()
    if (!value.sources.some(source => source.ref.sourceId === ref.sourceId && source.ref.sourceRevision === ref.sourceRevision && source.lifecycle === 'current'))
      return
    await commit({ type: 'prepare-source-change', changeId: nanoid(), sourceId: ref.sourceId, sourceRevision: ref.sourceRevision, ...(nextText ? { nextContentHash: await memoryContentHash(nextText) } : {}) })
  }

  function journalAcknowledgmentKey(ref: Extract<MemorySourceRef, { kind: 'chat-message' }>) {
    return persistenceKey(ref, `journal:${ref.sessionId}:${ref.sourceId}:${ref.sourceRevision}`)
  }

  async function acknowledgeJournalSource(ref: Extract<MemorySourceRef, { kind: 'chat-message' }>) {
    await persist(journalAcknowledgmentKey(ref), () => chatSessionsRepo.acknowledgeMemorySource(ref.sessionId, ref))
  }

  /** Settles an intent from actual durable chat bytes, including after a process restart. */
  async function settleSourceChanges(sessionId: string) {
    if (pendingLocalWrites.has(sessionId))
      return
    const value = await readOwned()
    const pending = value.sourceChanges.filter(change => change.status === 'pending' && change.source.kind === 'chat-message' && change.source.sessionId === sessionId)
    const acknowledgmentDebts = value.sources.flatMap(({ ref }) => ref.kind === 'chat-message' && ref.sessionId === sessionId
      && persistenceFailures.has(journalAcknowledgmentKey(ref))
      ? [ref]
      : [])
    if (!pending.length && !acknowledgmentDebts.length)
      return
    const record = await chatSessionsRepo.getSession(sessionId)
    if (record)
      assertRecordScope(record)
    for (const change of pending) {
      const ref = change.source
      if (ref.kind !== 'chat-message')
        continue
      const text = memorySourceText(record?.messages.find(message => message.id === ref.messageId))
      const hash = text ? await memoryContentHash(text) : undefined
      await commit({ type: 'finalize-source-change', changeId: change.changeId, outcome: hash === ref.contentHash ? 'aborted' : 'committed' })
    }
    // The deleted record cannot be acknowledged later. Confirm its absence first,
    // then clear only receipts for its exact source versions through the atomic repository boundary.
    if (!record) {
      for (const ref of acknowledgmentDebts)
        await acknowledgeJournalSource(ref)
    }
  }

  async function completeHistoryChange(sessionId: string) {
    pendingLocalWrites.delete(sessionId)
    return enqueue(() => settleSourceChanges(sessionId))
  }

  async function reconcileSources(previous: ChatSessionRecord, next: ChatHistoryItem[]) {
    return enqueue(async () => {
      assertRecordScope(previous)
      pendingLocalWrites.add(previous.meta.sessionId)
      const sources: MemorySourceRef[] = []
      for (const input of previous.memoryEligibility ?? []) {
        const before = previous.messages.find(message => message.id === input.messageId)
        const after = next.find(message => message.id === input.messageId)
        if (memorySourceText(before) === memorySourceText(after))
          continue
        const prior = (previous.memoryJournal ?? []).filter(entry => entry.source.kind === 'chat-message' && entry.source.messageId === input.messageId)
        if (prior.length)
          revoke()
        for (const entry of prior)
          await prepareSourceChange(entry.source, memorySourceText(after))
        const value = await readOwned()
        if (!value.policy.enabled || value.policy.activationId !== input.activationId)
          continue
        const ref = await makeChatSource({ ...previous, messages: next }, input, Math.max(0, ...prior.map(entry => entry.source.sourceRevision)) + 1)
        if (ref)
          sources.push(ref)
      }
      return sources
    })
  }

  async function drainJournal(sessionId: string) {
    return enqueue(async () => {
      try {
        await settleSourceChanges(sessionId)
        if (pendingLocalWrites.has(sessionId))
          return
        const record = await chatSessionsRepo.getSession(sessionId)
        if (!record)
          return
        assertRecordScope(record)
        for (const entry of record.memoryJournal ?? []) {
          if (entry.acknowledged)
            continue
          const value = await readOwned()
          const ref = entry.source
          if (ref.kind !== 'chat-message')
            continue
          if (ref.principalId !== record.meta.userId || ref.characterId !== record.meta.characterId || ref.sessionId !== sessionId)
            throw new MemoryOperationError('SCOPE_MISMATCH')
          const text = memorySourceText(record.messages.find(message => message.id === ref.messageId))
          const contentHash = text ? await memoryContentHash(text) : undefined
          assertRecordScope(record)
          const source = value.sources.find(item => item.ref.sourceId === ref.sourceId && item.ref.sourceRevision === ref.sourceRevision)
          if (contentHash !== ref.contentHash || (source && source.lifecycle !== 'current')) {
            // A durable replacement or deletion ends this version. It is not a retryable read failure.
            if (source?.lifecycle === 'current') {
              revoke()
              await commit({ type: 'invalidate-source', sourceId: ref.sourceId, sourceRevision: ref.sourceRevision, lifecycle: text ? 'changed' : 'deleted' })
            }
            await acknowledgeJournalSource(ref)
            continue
          }
          if (!value.policy.enabled || ref.activationId !== value.policy.activationId) {
            await acknowledgeJournalSource(ref)
            continue
          }
          const identity = await memoryContentHash(`${ref.sourceId}:${ref.sourceRevision}`)
          await commit({ type: 'enqueue-source', source: ref, jobId: `job:${identity}` }, `enroll:${identity}`)
          await acknowledgeJournalSource(ref)
        }
      }
      catch (caught) {
        rememberFailure(caught)
        throw caught
      }
    })
  }

  async function removeSessionSources(record: ChatSessionRecord) {
    revoke()
    return enqueue(async () => {
      assertRecordScope(record)
      pendingLocalWrites.add(record.meta.sessionId)
      for (const entry of record.memoryJournal ?? [])
        await prepareSourceChange(entry.source, '')
    })
  }

  async function recoverJournal() {
    const owned = checkOwner()
    const pendingSessions = new Set(envelope?.sourceChanges.filter(change => change.status === 'pending' && change.source.kind === 'chat-message')
      .flatMap(change => change.source.kind === 'chat-message' ? [change.source.sessionId] : []))
    for (const id of pendingSessions)
      await enqueue(() => settleSourceChanges(id))
    const index = await chatSessionsRepo.getIndex(owned.scope.principalId)
    checkOwner()
    for (const meta of Object.values(index?.characters[owned.scope.characterId]?.sessions ?? {})) {
      if (meta.hasMemoryJournal)
        await drainJournal(meta.sessionId)
    }
  }

  function cancelRecovery() {
    if (recoveryTimer)
      clearTimeout(recoveryTimer)
    recoveryTimer = undefined
    if (runtime?.isLeader()) {
      recovering.value = false
      recoveryUntil.value = null
    }
  }

  async function retryAfterLease(target: MemoryScope, epoch: number) {
    const saved = await memoryRepository.read(target)
    if (stopped || !runtime?.isLeader() || epoch !== ownerEpoch || !sameScope(target, currentScope()))
      return
    const expiresAt = saved?.lease?.expiresAt ?? Date.now()
    recovering.value = true
    recoveryUntil.value = expiresAt
    clearReportedError()
    // Recheck long leases periodically. No attempt can take ownership before the durable lease expires.
    const delay = Math.min(30_000, Math.max(50, expiresAt - Date.now() + 20))
    recoveryTimer = setTimeout(() => {
      recoveryTimer = undefined
      if (stopped || !runtime?.isLeader() || epoch !== ownerEpoch || !sameScope(target, currentScope()))
        return
      void activate().catch(rememberFailure)
    }, delay)
  }

  async function activate() {
    revoke()
    cancelRecovery()
    const epoch = ++ownerEpoch
    const target = currentScope()
    if (runtime?.isLeader()) {
      ready.value = false
      facts.value = []
      if (!sameScope(scope.value, target)) {
        scope.value = { ...target }
        profileState.value = 'unanswered'
        pendingJobCount.value = 0
        failedJobCount.value = 0
      }
    }
    try {
      await enqueue(async () => {
        if (lease && envelope) {
          const previousScope = envelope.scope
          const previousLease = lease
          await persist(persistenceKey(previousScope, 'owner-lease'), () => memoryRepository.releaseOwner(previousScope, previousLease, Date.now())).catch(rememberFailure)
        }
        lease = undefined
        envelope = null
        if (stopped || !runtime?.isLeader() || epoch !== ownerEpoch || !sameScope(target, currentScope()))
          return
        const acquired = await persist(persistenceKey(target, 'owner-lease'), () => memoryRepository.acquireOwner(target, { ownerId, now: Date.now(), leaseMs: 90_000, initialActivationId: nanoid() }))
        if (stopped || !runtime.isLeader() || epoch !== ownerEpoch || !sameScope(target, currentScope())) {
          await persist(persistenceKey(target, 'owner-lease'), () => memoryRepository.releaseOwner(target, acquired, Date.now()))
          return
        }
        lease = acquired
        const value = await memoryRepository.read(target)
        if (!value)
          throw new MemoryOperationError('NOT_READY')
        publish(value)
        clearReportedError()
      })
    }
    catch (caught) {
      if (caught instanceof MemoryOperationError && caught.code === 'STALE_OWNER') {
        await retryAfterLease(target, epoch)
        return
      }
      throw caught
    }
    if (ready.value && runtime?.isLeader()) {
      await recoverJournal()
      scheduleWork()
    }
  }

  /** Called only after the existing auth and character stores have initialized. */
  async function initialize(synced: SyncedPiniaRuntime) {
    if (initialized)
      return
    initialized = true
    runtime = synced
    promptHash = await memoryContentHash(MEMORY_EXTRACTION_PROMPT + JSON.stringify(MEMORY_OUTPUT_SCHEMA))
    stopLeadership = synced.onLeadershipChange(() => {
      void activate().catch(rememberFailure)
    })
    stopIdentityWatch = watch(() => [auth.userId, cards.activeCardId], () => {
      void activate().catch(rememberFailure)
    }, { flush: 'sync' })
    stopRouteWatch = watch(() => JSON.stringify([consciousness.activeProvider, consciousness.activeModel, consciousnessSettings.reasoning, providerConfig.getProviderConfigRevision(modelPolicy.value.mode === 'override' ? modelPolicy.value.providerId : consciousness.activeProvider), modelPolicy.value]), () => {
      suspendWork()
      scheduleWork()
    }, { flush: 'sync' })
    configureMemorySessionPort({ prepareInput, beforeHistoryChange: revoke, reconcileSources, completeHistoryChange, drainJournal, removeSessionSources })
    renewTimer = setInterval(() => {
      if (!ready.value || !synced.isLeader() || stopped)
        return
      void enqueue(async () => {
        const owned = checkOwner()
        lease = await persist(persistenceKey(owned.scope, 'owner-lease'), () => memoryRepository.renewOwner(owned.scope, owned.lease, Date.now(), 90_000))
        await readOwned()
      }).catch((caught) => {
        revoke()
        ready.value = false
        rememberFailure(caught)
        if (caught instanceof MemoryOperationError && caught.code === 'STALE_OWNER')
          void activate().catch(rememberFailure)
      })
    }, 30_000)
    await activate()
  }

  async function refresh() {
    if (!ready.value)
      return activate()
    return enqueue(async () => {
      await readOwned()
      clearReportedError()
    })
  }

  /** Reads a durable receipt only in the host's current scope. Missing receipts remain unknown, not failed. */
  async function getOperation(operationId: string): Promise<{ receipt: MemoryActionReceipt | null, revision: number }> {
    if (typeof operationId !== 'string' || !operationId.length || operationId.length > 128 || operationId.trim() !== operationId)
      throw new MemoryOperationError('INVALID_INPUT')
    return enqueue(async () => {
      const value = await readOwned()
      const epoch = ownerEpoch
      const receipt = await memoryRepository.getOperation(value.scope, operationId)
      const current = await readOwned()
      if (epoch !== ownerEpoch || !sameScope(value.scope, current.scope))
        throw new MemoryOperationError('STALE_OWNER')
      return { receipt: receipt ? actionReceipt(receipt) : null, revision: current.revision }
    })
  }

  function assertExpectedScope(expectedScope?: MemoryScope) {
    if (expectedScope && !sameScope(expectedScope, currentScope()))
      throw new MemoryOperationError('SCOPE_MISMATCH')
  }

  function assertReadSnapshot(value: MemoryEnvelope, epoch: number, contextVersion?: number) {
    checkOwner()
    if (ownerEpoch !== epoch || !sameScope(value.scope, currentScope())
      || value.memoryEpoch !== envelope?.memoryEpoch || (contextVersion !== undefined && contextVersion !== contextEpoch)) {
      throw new MemoryOperationError('STALE_RESULT')
    }
  }

  /** Reads saved first-use fields without adding them back to current facts. */
  async function readProfile(rawRequest: MemoryReadRequest = emptyReadRequest): Promise<MemoryProfileSnapshot> {
    const request = parseMemoryReadRequest(rawRequest)
    return enqueue(async () => {
      assertExpectedScope(request.expectedScope)
      const epoch = ownerEpoch
      const value = await readOwned()
      assertReadSnapshot(value, epoch)
      return profileSnapshot(value)
    })
  }

  /** Reads one bounded page from the authorized owner, with revision-bound continuation. */
  async function listMemory(rawRequest: MemoryListRequest): Promise<MemoryListSnapshot> {
    const request = parseMemoryListRequest(rawRequest)
    return enqueue(async () => {
      assertExpectedScope(request.expectedScope)
      const epoch = ownerEpoch
      const value = await readOwned()
      assertReadSnapshot(value, epoch)
      return listMemorySnapshot(value, request)
    })
  }

  /** Resolves exact evidence on demand. Stored lineage remains visible when original chat bytes no longer exist. */
  async function readSourceSnapshot(rawRequest: MemorySourceRequest): Promise<MemorySourceSnapshot> {
    const request = parseMemorySourceRequest(rawRequest)
    return enqueue(async () => {
      assertExpectedScope(request.expectedScope)
      const epoch = ownerEpoch
      const contextVersion = contextEpoch
      const value = await readOwned()
      assertReadSnapshot(value, epoch, contextVersion)
      const selected = selectMemoryLineage(value, request)
      const sources: MemorySourceSnapshot['sources'] = []
      for (const source of selected.sources) {
        const { ref, lifecycle } = source
        if (lifecycle !== 'current') {
          sources.push({ ref, lifecycle, status: lifecycle })
          continue
        }
        try {
          const text = await sourceText(ref)
          assertReadSnapshot(value, epoch, contextVersion)
          sources.push(text ? { ref, lifecycle, status: 'available', text } : { ref, lifecycle, status: 'missing' })
        }
        catch (caught) {
          assertReadSnapshot(value, epoch, contextVersion)
          if (caught instanceof MemoryOperationError && ['SOURCE_MISSING', 'SOURCE_CHANGED'].includes(caught.code)) {
            sources.push({ ref, lifecycle, status: caught.code === 'SOURCE_CHANGED' ? 'changed' : 'missing' })
            continue
          }
          throw caught instanceof MemoryOperationError ? caught : new MemoryOperationError('STORAGE_FAILED')
        }
      }
      assertReadSnapshot(value, epoch, contextVersion)
      return { scope: { ...value.scope }, snapshotRevision: value.revision, sources, lineage: selected.lineage }
    })
  }

  /** Reads metadata without publishing source text or changing ownership during recovery. */
  async function diagnosticsSummary(rawRequest: MemoryReadRequest = emptyReadRequest): Promise<MemoryDiagnosticsSummary> {
    const request = parseMemoryReadRequest(rawRequest)
    return enqueue(async () => {
      const summary: MemoryDiagnosticsSummary = {
        scope: null,
        snapshotRevision: null,
        memoryEpoch: null,
        state: 'not-ready',
        busy: busy.value,
        enabled: null,
        recoveryUntil: recoveryUntil.value,
        errorCode: null,
        counts: null,
        operations: [],
        sources: [],
        truncated: { operations: false, sources: false },
      }
      if (!initialized) {
        if (request.expectedScope)
          throw new MemoryOperationError('NOT_READY')
        return summary
      }
      assertExpectedScope(request.expectedScope)
      if (!runtime?.isLeader() || stopped)
        throw new MemoryOperationError('NOT_READY')
      const target = currentScope()
      const epoch = ownerEpoch
      summary.scope = { ...target }
      try {
        const value = await memoryRepository.read(target)
        if (epoch !== ownerEpoch || !sameScope(target, currentScope()) || !runtime.isLeader())
          throw new MemoryOperationError('STALE_OWNER')
        if (value) {
          Object.assign(summary, memoryDiagnosticSnapshot(value))
          summary.enabled = value.policy.enabled
          if (summary.counts)
            summary.counts.persistenceFailures = [...persistenceFailures].filter(key => sameScope(persistenceTargets.get(key)?.scope ?? null, target)).length
        }
        summary.state = recovering.value ? 'recovering' : ready.value ? 'ready' : 'not-ready'
        const knownErrors: NonNullable<MemoryDiagnosticsSummary['errorCode']>[] = ['INVALID_INPUT', 'NOT_READY', 'SCOPE_MISMATCH', 'REVISION_CONFLICT', 'STALE_OWNER', 'STALE_RESULT', 'SOURCE_MISSING', 'SOURCE_CHANGED', 'SOURCE_SUPPRESSED', 'IDEMPOTENCY_MISMATCH', 'STORAGE_FAILED', 'SCHEMA_UNSUPPORTED', 'STORAGE_CORRUPT', 'FACT_MISSING', 'CURSOR_EXPIRED', 'MEMORY_UNAVAILABLE', 'MEMORY_PERSISTENCE_UNRESOLVED']
        summary.errorCode = error.value ? knownErrors.find(code => code === error.value) ?? 'MEMORY_UNAVAILABLE' : null
        return summary
      }
      catch (caught) {
        if (epoch !== ownerEpoch || !sameScope(target, currentScope()) || !runtime?.isLeader())
          throw new MemoryOperationError('STALE_OWNER')
        return { ...summary, state: 'unavailable', errorCode: caught instanceof MemoryOperationError ? caught.code : 'STORAGE_FAILED' }
      }
    })
  }

  /** Saves a new activation. Callers can preserve a command identity, while existing calls use owner-assigned identities. */
  async function setEnabled(value: boolean, rawOptions?: MemoryWriteOptions): Promise<MemoryActionReceipt> {
    if (typeof value !== 'boolean')
      throw new MemoryOperationError('INVALID_INPUT')
    const options = rawOptions === undefined ? undefined : parseMemoryWriteOptions(rawOptions)
    const operationId = options?.operationId ?? nanoid()
    const input = { enabled: value, ...options }
    revoke()
    return enqueue(async () => {
      assertExpectedScope(options?.expectedScope)
      const previous = await previousOperation(operationId, input)
      if (previous)
        return actionReceipt(previous)
      const current = await readOwned()
      if (options && options.expectedRevision !== current.revision)
        throw new MemoryOperationError('REVISION_CONFLICT')
      const receipt = await commit({ type: 'set-policy', enabled: value, activationId: current.policy.enabled === value ? current.policy.activationId : nanoid() }, operationId, input)
      clearReportedError()
      return actionReceipt(receipt)
    })
  }

  /** Saves the selected route and returns the original result when a command is retried. */
  async function setModelPolicy(rawPolicy: MemoryModelPolicy, rawOptions?: MemoryWriteOptions): Promise<MemoryActionReceipt> {
    const policy = parseMemoryModelPolicy(rawPolicy)
    const options = rawOptions === undefined ? undefined : parseMemoryWriteOptions(rawOptions)
    const operationId = options?.operationId ?? nanoid()
    const input = { policy, ...options }
    revoke()
    const receipt = await enqueue(async () => {
      assertExpectedScope(options?.expectedScope)
      const previous = await previousOperation(operationId, input)
      if (previous)
        return previous
      const current = await readOwned()
      if (options && options.expectedRevision !== current.revision)
        throw new MemoryOperationError('REVISION_CONFLICT')
      const result = await commit({ type: 'set-model-policy', policy }, operationId, input)
      clearReportedError()
      return result
    })
    scheduleWork()
    return actionReceipt(receipt)
  }

  async function submitProfile(rawInput: InitialMemoryProfile): Promise<MemoryActionReceipt> {
    const input = parseInitialMemoryProfile(rawInput)
    const operationId = input.operationId ?? `profile:${input.submissionId}`
    const receipt = await enqueue(async () => {
      assertExpectedScope(input.expectedScope)
      const existing = await previousOperation(operationId, rawInput)
      if (existing)
        return existing
      const value = await readOwned()
      if (input.expectedRevision !== undefined && input.expectedRevision !== value.revision)
        throw new MemoryOperationError('REVISION_CONFLICT')
      const sources: Array<{ ref: MemorySourceRef, text: string }> = []
      const candidates: MemoryCandidate[] = []
      const now = Date.now()
      const fields = input.skipped
        ? []
        : [
            ['preferredName', input.preferredName.trim()],
            ['chatPreference', chatPreferences[input.chatPreference] ?? ''],
            ['recentMatter', input.recentMatter.trim()],
          ]
      for (const [fieldId, text] of fields) {
        if (!text)
          continue
        const ref: MemorySourceRef = {
          ...value.scope,
          kind: 'onboarding-answer',
          author: 'user',
          sourceId: `profile:${input.submissionId}:${fieldId}`,
          sourceRevision: 1,
          contentHash: await memoryContentHash(text),
          authoredAt: now,
          committedAt: now,
          submissionId: input.submissionId,
          fieldId,
          initializationRevision: 1,
        }
        sources.push({ ref, text })
        if (fieldId === 'preferredName')
          candidates.push({ category: 'identity', subject: 'user', slot: 'preferred-name', label: '称呼', text: `用户希望被称为${text}。`, keywords: [text], sourceRefIds: [ref.sourceId] })
        if (fieldId === 'chatPreference')
          candidates.push({ category: 'boundary', subject: 'user', label: '聊天偏好', text, keywords: ['聊天'], sourceRefIds: [ref.sourceId] })
      }
      const result = await commit({ type: 'submit-profile', submissionId: input.submissionId, skipped: input.skipped, sources, candidates, ...(sources.some(source => source.ref.kind === 'onboarding-answer' && source.ref.fieldId === 'recentMatter') ? { jobId: `profile-job:${input.submissionId}` } : {}) }, operationId, rawInput)
      clearReportedError()
      return result
    })
    scheduleWork()
    return actionReceipt(receipt)
  }

  async function correctFact(input: { operationId: string, factId: string, expectedFactRevision: number, text: string }) {
    revoke()
    return enqueue(async () => {
      const existing = await previousOperation(input.operationId, input)
      if (existing)
        return actionReceipt(existing)
      const value = await readOwned()
      const fact = getEffectiveFacts(value).find(item => item.factId === input.factId)
      if (!fact)
        throw new MemoryOperationError('FACT_MISSING')
      if (fact.revision !== input.expectedFactRevision)
        throw new MemoryOperationError('REVISION_CONFLICT')
      const text = input.text.trim()
      const now = Date.now()
      const ref: MemorySourceRef = { ...value.scope, kind: 'profile-correction', author: 'user', sourceId: `correction:${input.operationId}`, sourceRevision: 1, contentHash: await memoryContentHash(text), authoredAt: now, committedAt: now, correctionId: input.operationId, factId: fact.factId }
      const candidate: MemoryCandidate = { category: fact.category, subject: fact.subject, label: fact.label, text, keywords: [...new Set([...fact.keywords, ...(text.length <= 64 ? [text] : [])])].slice(0, 16), sourceRefIds: [ref.sourceId], targetFactId: fact.factId, ...(fact.factKey === 'slot:preferred-name' ? { slot: 'preferred-name' } : {}) }
      const result = await commit({ type: 'correct', factId: fact.factId, source: ref, candidate }, input.operationId, input)
      clearReportedError()
      return actionReceipt(result)
    })
  }

  async function removeFact(input: { operationId: string, factId: string, expectedFactRevision: number }) {
    revoke()
    return enqueue(async () => {
      const existing = await previousOperation(input.operationId, input)
      if (existing)
        return actionReceipt(existing)
      const value = await readOwned()
      const fact = getEffectiveFacts(value).find(item => item.factId === input.factId)
      if (!fact || fact.revision !== input.expectedFactRevision)
        throw new MemoryOperationError('REVISION_CONFLICT')
      const result = await commit({ type: 'remove', factId: input.factId }, input.operationId, input)
      clearReportedError()
      return actionReceipt(result)
    })
  }

  async function readSource(factId: string) {
    const snapshot = await readSourceSnapshot({ factId })
    return snapshot.sources.map((source) => {
      if (source.status !== 'available')
        throw new MemoryOperationError(source.status === 'changed' ? 'SOURCE_CHANGED' : 'SOURCE_MISSING')
      return { sourceId: source.ref.sourceId, kind: source.ref.kind, text: source.text, authoredAt: source.ref.authoredAt }
    })
  }

  function resolveRoute(): MemoryModelRoute {
    const policy = envelope?.modelPolicy ?? modelPolicy.value
    const providerId = policy.mode === 'override' ? policy.providerId : consciousness.activeProvider
    const modelId = policy.mode === 'override' ? policy.modelId : consciousness.activeModel
    if (!providerId || !modelId)
      throw new MemoryOperationError('NOT_READY')
    const reasoningMode = policy.mode === 'override'
      ? policy.reasoningMode
      : consciousness.activeModelRequiresReasoning || consciousness.activeModelUsesProviderReasoningDefault
        ? 'provider-default'
        : consciousnessSettings.reasoning ? 'enabled' : 'disabled'
    return { providerId, modelId, providerConfigRevision: providerConfig.getProviderConfigRevision(providerId), promptHash, ...(reasoningMode === undefined ? {} : { reasoningMode }) }
  }

  async function pump() {
    while (true) {
      if (stopped || !runtime?.isLeader() || !ready.value || conversationCount > 0)
        return
      if (getResourcePolicy() && !getResourcePolicy()!.state.active)
        return
      const prepared = await enqueue(async () => {
        const value = await readOwned()
        const job = value.jobs.find(item => item.status === 'pending')
        if (!job)
          return
        let route: MemoryModelRoute
        try {
          route = resolveRoute()
        }
        catch {
          return
        }
        const owned = checkOwner()
        const snapshot = await persist(persistenceKey(owned.scope, `job:${job.jobId}`), () => memoryRepository.beginJob(owned.scope, { jobId: job.jobId, lease: owned.lease, route, now: Date.now() }))
        await readOwned()
        return { snapshot, epoch: contextEpoch, ownerEpoch, route }
      })
      if (!prepared)
        return
      const { snapshot, route } = prepared
      const controller = new AbortController()
      workerAbort = controller
      busy.value = true
      const appEpoch = getResourcePolicy()?.state.appEpoch
      const assertCurrent = () => {
        controller.signal.throwIfAborted()
        checkOwner()
        if (prepared.epoch !== contextEpoch || prepared.ownerEpoch !== ownerEpoch
          || snapshot.memoryEpoch !== envelope?.memoryEpoch || conversationCount > 0
          || appEpoch !== getResourcePolicy()?.state.appEpoch || (getResourcePolicy() && !getResourcePolicy()!.state.active)
          || JSON.stringify(resolveRoute()) !== JSON.stringify(route)) {
          throw new DOMException('Memory input changed', 'AbortError')
        }
      }
      try {
        const value = envelope!
        const allowedSources = []
        for (const version of snapshot.sourceVersions) {
          const ref = value.sources.find(item => item.ref.sourceId === version.sourceId && item.ref.sourceRevision === version.sourceRevision)?.ref
          if (!ref)
            throw new MemoryOperationError('SOURCE_MISSING')
          allowedSources.push({ ref, text: await sourceText(ref) })
          assertCurrent()
        }
        const provider = await providers.getChatProviderInstance(route.providerId, route.reasoningMode === 'enabled' || route.reasoningMode === 'disabled' ? { reasoning: route.reasoningMode } : undefined)
        assertCurrent()
        if (!provider)
          throw new MemoryOperationError('NOT_READY')
        const clock = conversationClock()
        const data = JSON.stringify({ timezone: clock.timeZone, now: clock.now, allowedSources, existingCurrentFacts: getEffectiveFacts(value).map(({ factId, category, subject, text, qualifier, dueAt, planStatus }) => ({ factId, category, subject, text, qualifier, dueAt, planStatus })), outputSchema: MEMORY_OUTPUT_SCHEMA })
        if (new TextEncoder().encode(data + MEMORY_EXTRACTION_PROMPT).length > 24_000)
          throw new MemoryOperationError('INVALID_INPUT')
        let output = ''
        await streamFrom({ model: route.modelId, chatProvider: provider, conversation: { turns: [
          { id: 'memory-task', type: 'system', authority: 'system', content: [{ type: 'text', text: `${MEMORY_EXTRACTION_PROMPT}\n只输出对象 {"schemaVersion":1,"candidates":[]}。描述中的可选字段可以省略，时间字段为数字。category等枚举只能取一个值，禁止Markdown代码围栏。` }] },
          { id: 'memory-evidence', type: 'user', content: [{ type: 'text', text: data }] },
        ] }, options: { providerId: route.providerId, abortSignal: controller.signal, assertCurrent, attemptGate: acceptanceAttemptGate(providers.findProviderDefinition(route.providerId), 'memory', snapshot.jobId), contextRevision: String(snapshot.memoryEpoch), supportsTools: false, maxOutputTokens: 2048, maxInputTokens: 64_000, outputTokenLimitField: ['openai', 'azure-openai'].includes(providers.findProviderDefinition(route.providerId)?.id ?? '') ? 'max_completion_tokens' : undefined, temperature: value.modelPolicy.mode === 'override' ? value.modelPolicy.temperature ?? 0 : 0, onStreamEvent(event) {
          assertCurrent()
          if (event.type === 'text-delta')
            output += event.text
          if (output.length > 32_000)
            throw new MemoryOperationError('INVALID_INPUT')
        } } })
        assertCurrent()
        const parsed: unknown = JSON.parse(output)
        if (!parsed || typeof parsed !== 'object' || !('schemaVersion' in parsed) || parsed.schemaVersion !== 1
          || !('candidates' in parsed) || Object.keys(parsed).some(key => key !== 'schemaVersion' && key !== 'candidates')) {
          throw new MemoryOperationError('INVALID_INPUT')
        }
        const candidates = parseCandidates(parsed.candidates)
        await enqueue(async () => {
          assertCurrent()
          for (const version of snapshot.sourceVersions) {
            const ref = envelope?.sources.find(source => source.ref.sourceId === version.sourceId && source.ref.sourceRevision === version.sourceRevision)?.ref
            if (!ref)
              throw new MemoryOperationError('SOURCE_MISSING')
            await sourceText(ref)
            assertCurrent()
          }
          const digest = await memoryContentHash(JSON.stringify(candidates))
          assertCurrent()
          await persist(persistenceKey(snapshot.scope, `job:${snapshot.jobId}`), () => memoryRepository.commitCandidates(snapshot.scope, { snapshot, currentRoute: resolveRoute(), lease: checkOwner().lease, now: Date.now(), mutationId: `extract:${snapshot.jobId}:${snapshot.attempt}`, payloadDigest: digest, candidates }, assertCurrent))
          await readOwned()
        })
      }
      catch (caught) {
        const revoked = (caught instanceof DOMException && caught.name === 'AbortError')
          || (caught instanceof MemoryOperationError && caught.code === 'STALE_RESULT')
        await enqueue(async () => {
          if (!lease || !envelope || !sameScope(snapshot.scope, currentScope()))
            return
          if (revoked)
            await persist(persistenceKey(snapshot.scope, `job:${snapshot.jobId}`), () => memoryRepository.deferJob(snapshot.scope, { snapshot, lease: checkOwner().lease, now: Date.now() }))
          else
            await persist(persistenceKey(snapshot.scope, `job:${snapshot.jobId}`), () => memoryRepository.failJob(snapshot.scope, { snapshot, lease: checkOwner().lease, now: Date.now(), reason: caught instanceof SyntaxError || (caught instanceof MemoryOperationError && caught.code === 'INVALID_INPUT') ? 'INVALID_INPUT' : 'MODEL_UNAVAILABLE' }))
          await readOwned()
        }).catch(rememberFailure)
        if (!revoked)
          rememberFailure(caught)
        return
      }
      finally {
        if (workerAbort === controller)
          workerAbort = undefined
        busy.value = false
      }
    }
  }

  function scheduleWork() {
    if (worker) {
      workRequested = true
      return
    }
    if (conversationCount > 0 || stopped || !runtime?.isLeader() || !ready.value)
      return
    workRequested = false
    worker = pump().catch(rememberFailure).finally(() => {
      worker = undefined
      if (workRequested)
        scheduleWork()
    })
  }

  function beginConversation() {
    conversationCount++
    suspendWork()
    let ended = false
    return () => {
      if (ended)
        return
      ended = true
      conversationCount = Math.max(0, conversationCount - 1)
      scheduleWork()
    }
  }

  async function retryFailedJobs() {
    await enqueue(async () => {
      const value = await readOwned()
      for (const job of value.jobs.filter(item => item.status === 'failed'))
        await persist(persistenceKey(value.scope, `job:${job.jobId}`), () => memoryRepository.retryJob(value.scope, { jobId: job.jobId, lease: checkOwner().lease, now: Date.now() }))
      await readOwned()
      clearReportedError()
    })
    scheduleWork()
  }

  /** Called at the real Conversation construction, not the diagnostic composed-message hook. */
  async function resolveRequestContext(sessionId: string, history: ChatHistoryItem[], query: string) {
    if (!initialized)
      return { history, supplement: '', contextRevision: undefined, assertCurrent: () => {} }
    const value = await enqueue(readOwned)
    const meta = await chatSessionsRepo.getSession(sessionId)
    if (!meta || meta.meta.userId !== value.scope.principalId || meta.meta.characterId !== value.scope.characterId)
      throw new MemoryOperationError('SCOPE_MISMATCH')
    const captured = { contextEpoch, ownerEpoch, memoryEpoch: value.memoryEpoch }
    const appEpoch = getResourcePolicy()?.state.appEpoch
    const assertCurrent = () => {
      checkOwner()
      if (captured.contextEpoch !== contextEpoch || captured.ownerEpoch !== ownerEpoch || captured.memoryEpoch !== envelope?.memoryEpoch
        || appEpoch !== getResourcePolicy()?.state.appEpoch || (getResourcePolicy() && !getResourcePolicy()!.state.active)) {
        throw new DOMException('Conversation evidence changed', 'AbortError')
      }
    }
    assertCurrent()
    // Unknown derived copies cannot safely be removed by string replacement. Start a fresh model history
    // after a correction/removal, keeping the original visible chat and independent stored facts intact.
    const cutoff = Math.max(0, ...value.replayBlocks.map(block => block.createdAt))
    const safeHistory = cutoff
      ? history
          .filter(message => message.role === 'system' || message === history.at(-1) || (message.createdAt ?? 0) > cutoff)
          .map((message) => {
            const copy = { ...message }
            if (copy.role === 'assistant') {
              delete copy.providerTranscript
              delete copy.generationTranscript
            }
            return copy
          })
      : history
    const now = conversationClock().now
    const items = [...selectCoreFacts(value, now), ...selectRelatedFacts(value, query, now), ...selectDueFacts(value, query, now, { from: now - 86_400_000, to: now + 172_800_000 })]
    const reserved = new TextEncoder().encode(JSON.stringify(safeHistory) + AIMY_COMPANION_PROMPT + MEMORY_EVIDENCE_PROMPT).length + 2048
    const packed = packMemoryEvidence(items, Math.max(0, Math.min(2400, 64_000 - reserved)))
    return { history: safeHistory, supplement: [AIMY_COMPANION_PROMPT, packed.text ? MEMORY_EVIDENCE_PROMPT : '', packed.text].filter(Boolean).join('\n\n'), contextRevision: `${value.scope.principalId}:${value.scope.characterId}:${value.memoryEpoch}`, assertCurrent }
  }

  /** Shutdown waits for accepted work and rejects unresolved storage failures, not input validation errors. */
  async function flush() {
    let observed: Promise<unknown>
    do {
      observed = queue
      await observed
    } while (queue !== observed)
    for (const key of persistenceFailures) {
      const target = persistenceTargets.get(key)
      if (target?.target !== 'owner-lease')
        continue
      const saved = await memoryRepository.read(target.scope)
      if (!saved?.lease || saved.lease.ownerId !== ownerId || saved.lease.expiresAt <= Date.now())
        persistenceFailures.delete(key)
    }
    if (persistenceFailures.size)
      throw new MemoryOperationError('STORAGE_FAILED')
    if (lease && envelope && runtime?.isLeader()) {
      const saved = await memoryRepository.read(envelope.scope)
      if (saved?.sourceChanges.some(change => change.status === 'pending'))
        throw new MemoryOperationError('STORAGE_FAILED')
    }
  }

  /** Releases ownership after pending work settles. A failed release remains a failed shutdown receipt. */
  async function dispose() {
    stopped = true
    revoke()
    cancelRecovery()
    if (renewTimer)
      clearInterval(renewTimer)
    stopLeadership?.()
    stopIdentityWatch?.()
    stopRouteWatch?.()
    configureMemorySessionPort(undefined)
    try {
      if (worker)
        await worker
      await flush()
    }
    finally {
      try {
        if (lease && envelope) {
          const target = envelope.scope
          const ownedLease = lease
          await persist(persistenceKey(target, 'owner-lease'), () => memoryRepository.releaseOwner(target, ownedLease, Date.now()))
          lease = undefined
        }
      }
      finally {
        if (runtime?.isLeader())
          ready.value = false
      }
    }
  }

  return { ready, busy, error, scope, facts, enabled, modelPolicy, profileState, revision, failedJobCount, pendingJobCount, memoryEpoch, recovering, recoveryUntil, canWork, initialize, refresh, getOperation, readProfile, listMemory, readSourceSnapshot, diagnosticsSummary, setEnabled, setModelPolicy, submitProfile, correctFact, removeFact, readSource, retryFailedJobs, suspendWork, revoke, onInvalidated, beginConversation, resolveRequestContext, flush, dispose }
}, {
  synced: {
    state: true,
    actions: ['refresh', 'getOperation', 'readProfile', 'listMemory', 'readSourceSnapshot', 'diagnosticsSummary', 'setEnabled', 'setModelPolicy', 'submitProfile', 'correctFact', 'removeFact', 'readSource', 'retryFailedJobs', 'flush'],
  },
})
