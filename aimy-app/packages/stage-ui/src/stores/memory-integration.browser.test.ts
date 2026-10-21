import type { ChatSessionRecord } from '../types/chat-session'
import type { MemoryEnvelope } from '../types/memory'

import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'

import { chatSessionsRepo } from '../database/repos/chat-sessions.repo'
import { memoryRepository } from '../database/repos/memory.repo'
import { storage } from '../database/storage'
import { configureLocalOnly } from '../services/local-data-policy'
import { getMemorySessionPort } from '../services/memory-session'
import { useAuthStore } from './auth'
import { useChatSessionStore } from './chat/session-store'
import { useMemoryStore } from './memory'
import { parseEnvelope } from './memory/schema'
import { useConsciousnessStore } from './modules/consciousness'

const inference = vi.hoisted(() => ({ calls: 0 }))

vi.mock('./auth', async () => {
  const { defineStore } = await import('pinia')
  const { computed, ref } = await import('vue')
  return { useAuthStore: defineStore('synthetic-auth', () => {
    const user = ref<{ id: string } | null>(null)
    return { user, userId: computed(() => user.value?.id ?? 'local'), token: ref(null) }
  }) }
})
vi.mock('./modules/airi-card', async () => {
  const { defineStore } = await import('pinia')
  const { ref } = await import('vue')
  return { useAiriCardStore: defineStore('synthetic-card', () => ({ activeCardId: ref('synthetic-character'), systemPrompt: ref('Synthetic character'), getCard: () => ({}), getSystemPrompt: () => 'Synthetic character' })) }
})
vi.mock('./modules/consciousness', async () => {
  const { defineStore } = await import('pinia')
  const { ref } = await import('vue')
  return { useConsciousnessStore: defineStore('synthetic-consciousness', () => ({ activeProvider: ref('synthetic'), activeModel: ref(''), activeModelRequiresReasoning: ref(false), activeModelUsesProviderReasoningDefault: ref(false) })) }
})
vi.mock('./modules/consciousness-settings', () => ({ useConsciousnessSettingsStore: () => ({ reasoning: false }) }))
vi.mock('./providers/config', () => ({ useProviderConfigStore: () => ({ getProviderConfigRevision: () => 1 }) }))
vi.mock('./providers/provider', () => ({ useProviderStore: () => ({ findProviderDefinition: () => ({ id: 'synthetic' }), getChatProviderInstance: async () => ({
  generation: (model: string) => ({ protocol: 'chat-completions', config: { baseURL: 'https://synthetic.invalid/v1/', model, fetch: async (_url: URL, init: RequestInit) => {
    inference.calls++
    const body = JSON.parse(String(init.body))
    const data = JSON.parse(body.messages[1].content)
    const sourceId = data.allowedSources[0].ref.sourceId
    const candidates = [{ category: 'preference', subject: 'user', label: 'Synthetic preference', text: 'Likes synthetic tea', keywords: ['tea'], sourceRefIds: [sourceId] }]
    return new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: JSON.stringify({ schemaVersion: 1, candidates }) }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
  } } }),
}) }) }))
vi.mock('../libs/product-signals', () => ({ captureAnalyticsEvent: () => {} }))
vi.mock('../libs/auth-fetch', () => ({ authedFetch: () => {
  throw new Error('Synthetic test must never call account cloud')
} }))

let pinia: ReturnType<typeof createPinia>
let runtime: ReturnType<typeof createSyncedPiniaPlugin>
let app: ReturnType<typeof createApp>
let container: HTMLDivElement
let memory: ReturnType<typeof useMemoryStore>
let chats: ReturnType<typeof useChatSessionStore>
let principalId: string
let sessionId: string

async function mount() {
  pinia = createPinia()
  runtime = createSyncedPiniaPlugin({ namespace: `synthetic-memory:${principalId}`, leadership: 'leader-only' })
  pinia.use(runtime.plugin)
  container = document.createElement('div')
  document.body.append(container)
  app = createApp(defineComponent(() => () => h('div')))
  app.use(pinia).mount(container)
  setActivePinia(pinia)
  useAuthStore().user = { id: principalId, name: 'Synthetic', email: 'synthetic@example.test', emailVerified: true, createdAt: new Date(0), updatedAt: new Date(0) }
  memory = useMemoryStore()
  chats = useChatSessionStore()
  await vi.waitFor(() => expect(runtime.isLeader()).toBe(true))
  await memory.initialize(runtime)
  await chats.initialize()
  sessionId = chats.activeSessionId
}

async function unmount(allowPersistenceFailure = false) {
  try {
    await memory.dispose()
  }
  catch (error) {
    if (!allowPersistenceFailure)
      throw error
  }
  chats.dispose()
  runtime.dispose()
  app.unmount()
  container.remove()
  disposePinia(pinia)
}

async function envelope() {
  return (await storage.getItemRaw<MemoryEnvelope>(`local:memory/v1/${encodeURIComponent(principalId)}/synthetic-character`))!
}

async function send(id: string, content: string) {
  await chats.commitUserMessage(sessionId, { id, role: 'user', content })
  await getMemorySessionPort()!.drainJournal(sessionId)
}

beforeEach(async () => {
  configureLocalOnly()
  inference.calls = 0
  principalId = `memory-integration-${crypto.randomUUID()}`
  await mount()
})

afterEach(async () => {
  vi.restoreAllMocks()
  await unmount(true)
  await chatSessionsRepo.clear(principalId)
  await storage.removeItem(`local:memory/v1/${encodeURIComponent(principalId)}/synthetic-character`)
})

describe('existing chat plus durable memory owner', () => {
  it('commits chat, discoverable index and a recoverable source before enqueue acknowledgment', async () => {
    await send('new-input', 'A synthetic tea preference')
    const record = (await chatSessionsRepo.getSession(sessionId))!
    expect(record.meta.hasMemoryJournal).toBe(true)
    expect(record.memoryJournal).toHaveLength(1)
    expect(record.memoryJournal?.[0].acknowledged).toBe(true)
    expect((await envelope()).jobs).toHaveLength(1)
    await getMemorySessionPort()!.drainJournal(sessionId)
    expect((await envelope()).jobs).toHaveLength(1)
    expect(inference.calls).toBe(0)
  })

  it('does not enroll old, forked or paused history and resumes with a new activation', async () => {
    await memory.setEnabled(false)
    await send('paused-input', 'Do not backfill this input')
    expect((await chatSessionsRepo.getSession(sessionId))?.memoryJournal).toBeUndefined()
    await memory.setEnabled(true)
    await send('new-input', 'New eligible input')
    const fork = await chats.forkSession({ fromSessionId: sessionId })
    expect((await chatSessionsRepo.getSession(fork))?.memoryJournal).toBeUndefined()
    expect((await envelope()).sources.map(source => source.ref.sourceId)).toEqual([`chat:${sessionId}:new-input`])
  })

  it('restores confirmed profile facts in a new store and accepts a lost-reply retry once', async () => {
    const input = { submissionId: 'synthetic-profile', preferredName: 'Test Friend', chatPreference: 'listen-first', recentMatter: '', skipped: false }
    await memory.submitProfile(input)
    const before = memory.revision
    await memory.submitProfile(input)
    expect(memory.revision).toBe(before)
    expect(memory.facts).toHaveLength(2)
    await unmount()
    await mount()
    expect(memory.facts).toHaveLength(2)
    expect(memory.profileState).toBe('submitted')
  })

  it('routes receipt queries from a follower to the current owner scope without replaying or exposing another scope', async () => {
    await memory.submitProfile({ submissionId: 'receipt-profile', preferredName: 'Receipt Friend', chatPreference: '', recentMatter: '', skipped: false })
    const originalRevision = memory.revision
    const foreignScope = { principalId, characterId: 'different-synthetic-character' }
    const foreignLease = await memoryRepository.acquireOwner(foreignScope, { ownerId: 'foreign-owner', now: Date.now(), leaseMs: 1000, initialActivationId: 'foreign-activation' })
    await memoryRepository.mutate(foreignScope, { mutationId: 'foreign-operation', payloadDigest: 'foreign-digest', expectedRevision: 0, lease: foreignLease, now: Date.now(), command: { type: 'set-policy', enabled: false, activationId: 'foreign-paused' } })
    const followerPinia = createPinia()
    const followerRuntime = createSyncedPiniaPlugin({ namespace: `synthetic-memory:${principalId}`, leadership: 'follower-only' })
    followerPinia.use(followerRuntime.plugin)
    const followerApp = createApp(defineComponent(() => () => null))
    followerApp.use(followerPinia).mount(document.createElement('div'))
    try {
      const follower = useMemoryStore(followerPinia)
      await vi.waitFor(() => expect(followerRuntime.getLeaderId()).toBe(runtime.participantId))
      await expect(follower.getOperation('profile:receipt-profile')).resolves.toMatchObject({ receipt: { operationId: 'profile:receipt-profile', status: 'succeeded' }, revision: originalRevision })
      await expect(follower.getOperation('foreign-operation')).resolves.toEqual({ receipt: null, revision: originalRevision })
      await expect(follower.readProfile()).resolves.toMatchObject({ scope: memory.scope, completionState: 'submitted', snapshotRevision: originalRevision })
      await expect(follower.listMemory({ stateFilter: 'current' })).resolves.toMatchObject({ snapshotRevision: originalRevision, facts: [{ factId: memory.facts[0].factId }] })
      await expect(follower.diagnosticsSummary()).resolves.toMatchObject({ scope: memory.scope, state: 'ready' })
      await expect(follower.listMemory({ stateFilter: 'history', expectedScope: foreignScope })).rejects.toBeDefined()
      await expect(Reflect.apply(follower.getOperation, follower, [{ operationId: 'foreign-operation', scope: foreignScope }])).rejects.toBeDefined()
      await expect(follower.getOperation(' ')).rejects.toBeDefined()
      expect(memory.revision).toBe(originalRevision)
      expect((await envelope()).receipts.filter(receipt => receipt.operationId === 'profile:receipt-profile')).toHaveLength(1)
    }
    finally {
      followerApp.unmount()
      followerRuntime.dispose()
      disposePinia(followerPinia)
      setActivePinia(pinia)
      await storage.removeItem(`local:memory/v1/${encodeURIComponent(principalId)}/different-synthetic-character`)
    }
  })

  it('runs validated synthetic candidates through the real SDK, source resolver and memory repository', async () => {
    const end = memory.beginConversation()
    useConsciousnessStore().activeModel = 'synthetic-model'
    await send('new-input', 'A synthetic tea preference')
    expect(inference.calls).toBe(0)
    end()
    await vi.waitFor(() => expect(memory.facts).toHaveLength(1))
    expect(inference.calls).toBe(1)
    expect((await envelope()).jobs[0].status).toBe('succeeded')
    const context = await memory.resolveRequestContext(sessionId, chats.getSessionMessages(sessionId), 'tea')
    expect(context.supplement).toContain('Likes synthetic tea')
  })

  it.each(['cancel', 'model-change'] as const)('rejects candidate commit if %s occurs inside the final digest await', async (change) => {
    await send('candidate-boundary-input', 'A synthetic fact whose commit will be delayed')
    const releaseDigest = Promise.withResolvers<void>()
    let digestStarted = false
    const nativeDigest = SubtleCrypto.prototype.digest
    const delayedDigest = vi.spyOn(SubtleCrypto.prototype, 'digest').mockImplementation(async function (this: SubtleCrypto, algorithm, data) {
      const payload = new TextDecoder().decode(data)
      if (payload.includes('"snapshot":{') && payload.includes('"candidates":[')) {
        digestStarted = true
        await releaseDigest.promise
      }
      return nativeDigest.call(this, algorithm, data)
    })
    try {
      useConsciousnessStore().activeModel = 'synthetic-model'
      await vi.waitFor(() => expect(digestStarted).toBe(true))
      if (change === 'cancel')
        memory.suspendWork()
      else
        useConsciousnessStore().activeModel = ''
      releaseDigest.resolve()
      await vi.waitFor(() => expect(memory.busy).toBe(false))
      expect(memory.facts).toEqual([])
      expect((await envelope()).jobs[0].status).toBe('pending')
      expect(inference.calls).toBe(1)
      expect(memory.error).toBeNull()
      await expect(memory.flush()).resolves.toBeUndefined()
    }
    finally {
      releaseDigest.resolve()
      delayedDigest.mockRestore()
    }
  })

  it('rejects stale maintenance and removes native and portable history copies after removal', async () => {
    await memory.submitProfile({ submissionId: 'profile', preferredName: 'SYNTHETIC_CANARY', chatPreference: '', recentMatter: '', skipped: false })
    const fact = memory.facts[0]
    await memory.correctFact({ operationId: 'correction', factId: fact.factId, expectedFactRevision: fact.revision, text: 'Current permitted name' })
    await expect(memory.correctFact({ operationId: 'stale', factId: fact.factId, expectedFactRevision: fact.revision, text: 'Stale name' })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    const current = memory.facts[0]
    await memory.removeFact({ operationId: 'remove', factId: current.factId, expectedFactRevision: current.revision })
    const history: ChatSessionRecord['messages'] = [
      { id: 'system', role: 'system', content: 'Aimy' },
      { id: 'old', role: 'assistant', content: 'SYNTHETIC_CANARY', slices: [], tool_results: [], createdAt: 1, providerTranscript: [{ role: 'assistant', content: 'SYNTHETIC_CANARY' }] },
      { id: 'new', role: 'user', content: 'Hello again', createdAt: Date.now() },
    ]
    const context = await memory.resolveRequestContext(sessionId, history, 'Hello again')
    expect(JSON.stringify(context)).not.toContain('SYNTHETIC_CANARY')
    expect(memory.facts).toHaveLength(0)
  })

  it('keeps the original evidence current when the following chat transaction fails', async () => {
    const end = memory.beginConversation()
    useConsciousnessStore().activeModel = 'synthetic-model'
    await send('source-to-edit', 'A synthetic tea preference')
    end()
    await vi.waitFor(() => expect(memory.facts).toHaveLength(1))
    const fault = vi.spyOn(chatSessionsRepo, 'commitSessionSnapshotAndIndex').mockRejectedValueOnce(new Error('Synthetic storage failure'))
    try {
      await expect(chats.deleteMessage({ sessionId, messageId: 'source-to-edit' })).rejects.toThrow('Synthetic storage failure')
    }
    finally {
      fault.mockRestore()
    }
    const value = await envelope()
    expect(value.sourceChanges.at(-1)?.status).toBe('aborted')
    expect(value.sources[0].lifecycle).toBe('current')
    expect(memory.facts).toHaveLength(1)
    expect((await chatSessionsRepo.getSession(sessionId))?.messages.some(message => message.id === 'source-to-edit')).toBe(true)
    expect(chats.getSessionMessages(sessionId).some(message => message.id === 'source-to-edit')).toBe(true)
  })

  it('finalizes actual source deletion after the chat transaction completes', async () => {
    await send('source-to-delete', 'Synthetic input')
    await chats.deleteMessage({ sessionId, messageId: 'source-to-delete' })
    const value = await envelope()
    expect(value.sourceChanges.at(-1)?.status).toBe('committed')
    expect(value.sources[0].lifecycle).toBe('deleted')
    expect((await chatSessionsRepo.getSession(sessionId))?.messages.some(message => message.id === 'source-to-delete')).toBe(false)
  })
})

/** Fails at the actual browser storage boundary. Abort mode still calls the native put and aborts its real transaction. */
function failStorage(mode: 'quota' | 'abort', matches: (key: string, value: unknown) => boolean, once = true) {
  const nativePut = IDBObjectStore.prototype.put
  let injected = false
  return vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
    if ((!once || !injected) && matches(String(key), value)) {
      injected = true
      if (mode === 'quota')
        throw new DOMException('Synthetic quota failure', 'QuotaExceededError')
      const request = nativePut.call(this, value, key)
      this.transaction.abort()
      return request
    }
    return nativePut.call(this, value, key)
  })
}

function failJournalAcknowledgment() {
  return failStorage('quota', (key, value) => {
    if (key !== `airi-local:chat:sessions:${sessionId}` || !value || typeof value !== 'object' || !('memoryJournal' in value))
      return false
    return Array.isArray(value.memoryJournal) && value.memoryJournal.some(entry => entry && typeof entry === 'object' && 'acknowledged' in entry && entry.acknowledged === true)
  }, false)
}

describe('persistence failure and lease recovery', () => {
  it('rejects shutdown flush after a memory transaction abort until that profile really persists', async () => {
    const input = { submissionId: 'aborted-profile', preferredName: 'Pending Friend', chatPreference: '', recentMatter: '', skipped: false }
    const fault = failStorage('abort', key => key.includes(`memory:v1:${principalId}:`))
    await expect(memory.submitProfile(input)).rejects.toMatchObject({ code: 'STORAGE_FAILED' })
    fault.mockRestore()
    expect((await envelope()).facts).toEqual([])
    await expect(memory.flush()).rejects.toMatchObject({ code: 'STORAGE_FAILED' })
    await memory.setModelPolicy({ mode: 'follow-chat' })
    await expect(memory.flush()).rejects.toMatchObject({ code: 'STORAGE_FAILED' })
    await memory.submitProfile(input)
    await expect(memory.flush()).resolves.toBeUndefined()
    expect((await envelope()).facts[0].text).toContain('Pending Friend')
  })

  it('does not turn invalid input or stale fact revisions into unresolved storage failures', async () => {
    await expect(memory.submitProfile({ submissionId: 'invalid', preferredName: 'x'.repeat(81), chatPreference: '', recentMatter: '', skipped: false })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await memory.submitProfile({ submissionId: 'valid', preferredName: 'Current Friend', chatPreference: '', recentMatter: '', skipped: false })
    const fact = memory.facts[0]
    await expect(memory.correctFact({ operationId: 'stale', factId: fact.factId, expectedFactRevision: fact.revision + 5, text: 'Wrong revision' })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    await expect(memory.flush()).resolves.toBeUndefined()
  })

  it('keeps a failed chat save visible to flush despite an unrelated successful session write', async () => {
    const originalSession = sessionId
    const messages = chats.getSessionMessages(originalSession)
    messages.push({ id: 'pending-reply', role: 'assistant', content: 'Unsaved synthetic reply', slices: [], tool_results: [] })
    const fault = failStorage('abort', key => key === `airi-local:chat:sessions:${originalSession}`)
    await expect(chats.persistSessionMessages(originalSession)).rejects.toBeDefined()
    fault.mockRestore()
    await expect(chats.flushPersistence()).rejects.toThrow('unresolved failures')
    await chats.createSession('synthetic-character', { setActive: false })
    await expect(chats.flushPersistence()).rejects.toThrow('unresolved failures')
    await chats.persistSessionMessages(originalSession)
    await expect(chats.flushPersistence()).resolves.toBeUndefined()
    expect((await chatSessionsRepo.getSession(originalSession))?.messages.some(message => message.id === 'pending-reply')).toBe(true)
  })

  it('clears a rejected chat operation only after verifying that its original record was restored', async () => {
    const fault = failStorage('quota', key => key === `airi-local:chat:sessions:${sessionId}`)
    await expect(chats.commitUserMessage(sessionId, { id: 'quota-input', role: 'user', content: 'This write fails' })).rejects.toMatchObject({ name: 'QuotaExceededError' })
    fault.mockRestore()
    expect((await chatSessionsRepo.getSession(sessionId))?.messages.some(message => message.id === 'quota-input')).toBe(false)
    expect(chats.getSessionMessages(sessionId).some(message => message.id === 'quota-input')).toBe(false)
    await expect(chats.flushPersistence()).resolves.toBeUndefined()
  })

  it('preserves an already committed chat when journal acknowledgment fails and retries that acknowledgment', async () => {
    const fault = failStorage('quota', (key, value) => {
      if (key !== `airi-local:chat:sessions:${sessionId}` || !value || typeof value !== 'object' || !('memoryJournal' in value))
        return false
      const journal = value.memoryJournal
      return Array.isArray(journal) && journal.some(entry => entry && typeof entry === 'object' && 'acknowledged' in entry && entry.acknowledged === true)
    }, false)
    await expect(chats.commitUserMessage(sessionId, { id: 'journal-input', role: 'user', content: 'A recoverable journal input' })).resolves.toMatchObject({ status: 'inserted' })
    await expect(getMemorySessionPort()!.drainJournal(sessionId)).rejects.toMatchObject({ code: 'STORAGE_FAILED' })
    expect((await chatSessionsRepo.getSession(sessionId))?.messages.some(message => message.id === 'journal-input')).toBe(true)
    await expect(memory.flush()).rejects.toMatchObject({ code: 'STORAGE_FAILED' })
    fault.mockRestore()
    await getMemorySessionPort()!.drainJournal(sessionId)
    await expect(memory.flush()).resolves.toBeUndefined()
    expect((await envelope()).jobs).toHaveLength(1)
    expect((await chatSessionsRepo.getSession(sessionId))?.memoryJournal?.[0].acknowledged).toBe(true)
  })

  it.each([
    ['delete', false],
    ['edit', false],
    ['delete', true],
    ['edit', true],
  ] as const)('settles an unacknowledged %s source without blocking later input (restart=%s)', async (change, restart) => {
    const fault = failJournalAcknowledgment()
    await chats.commitUserMessage(sessionId, { id: 'old-input', role: 'user', content: 'Old synthetic evidence' })
    await expect(getMemorySessionPort()!.drainJournal(sessionId)).rejects.toMatchObject({ code: 'STORAGE_FAILED' })
    if (change === 'delete') {
      await chats.deleteMessage({ sessionId, messageId: 'old-input' })
    }
    else {
      chats.setSessionMessages(sessionId, chats.getSessionMessages(sessionId).map(message => message.id === 'old-input' ? { ...message, content: 'Corrected synthetic evidence' } : message))
      await chats.flushPersistence()
    }
    await chats.commitUserMessage(sessionId, { id: 'later-input', role: 'user', content: 'Independent later evidence' })
    await expect(getMemorySessionPort()!.drainJournal(sessionId)).rejects.toBeDefined()
    if (restart)
      await unmount(true)
    fault.mockRestore()
    if (restart)
      await mount()
    else
      await getMemorySessionPort()!.drainJournal(sessionId)

    await expect(memory.flush()).resolves.toBeUndefined()
    const record = (await chatSessionsRepo.getSession(sessionId))!
    expect(record.memoryJournal?.every(entry => entry.acknowledged)).toBe(true)
    const value = await envelope()
    expect(value.sources.find(source => source.ref.sourceId.endsWith(':old-input') && source.ref.sourceRevision === 1)?.lifecycle).toBe(change === 'delete' ? 'deleted' : 'changed')
    expect(value.jobs.filter(job => job.status === 'pending')).toHaveLength(change === 'delete' ? 1 : 2)
    useConsciousnessStore().activeModel = 'synthetic-model'
    await vi.waitFor(() => expect(inference.calls).toBe(change === 'delete' ? 1 : 2))
    await vi.waitFor(() => expect(memory.busy).toBe(false))
    expect(memory.facts.every(fact => fact.sourceVersions.every(source => !source.sourceId.endsWith(':old-input') || source.sourceRevision > 1))).toBe(true)
  })

  it('clears only the acknowledgment debt for a durably deleted session', async () => {
    const deletedSession = sessionId
    const fault = failJournalAcknowledgment()
    await chats.commitUserMessage(sessionId, { id: 'removed-session-input', role: 'user', content: 'Evidence in a removed session' })
    await expect(getMemorySessionPort()!.drainJournal(sessionId)).rejects.toMatchObject({ code: 'STORAGE_FAILED' })
    await chats.deleteSession(deletedSession)
    fault.mockRestore()
    await expect(memory.flush()).resolves.toBeUndefined()
    expect(await chatSessionsRepo.getSession(deletedSession)).toBeNull()
    expect((await envelope()).sources[0].lifecycle).toBe('deleted')
  })

  it('does not consume an unacknowledged source when the actual IDB read fails', async () => {
    const fault = failJournalAcknowledgment()
    await chats.commitUserMessage(sessionId, { id: 'read-failure-input', role: 'user', content: 'Keep this pending evidence' })
    await expect(getMemorySessionPort()!.drainJournal(sessionId)).rejects.toMatchObject({ code: 'STORAGE_FAILED' })
    fault.mockRestore()
    const get = IDBObjectStore.prototype.get
    const readFault = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, key) {
      if (key === `airi-local:chat:sessions:${sessionId}`)
        throw new DOMException('Synthetic read failure', 'AbortError')
      return get.call(this, key)
    })
    await expect(getMemorySessionPort()!.drainJournal(sessionId)).rejects.toBeDefined()
    readFault.mockRestore()
    expect((await chatSessionsRepo.getSession(sessionId))?.memoryJournal?.[0].acknowledged).toBe(false)
    expect((await envelope()).sources[0].lifecycle).toBe('current')
    await getMemorySessionPort()!.drainJournal(sessionId)
    await expect(memory.flush()).resolves.toBeUndefined()
  })

  it('does not roll back a successful chat deletion when memory finalization remains pending', async () => {
    await send('delete-then-finalize', 'A source for a separate finalization')
    const fault = failStorage('quota', (key, value) => key.includes(`memory:v1:${principalId}:`)
      && parseEnvelope(value).sourceChanges.some(change => change.status === 'committed'), false)
    await expect(chats.deleteMessage({ sessionId, messageId: 'delete-then-finalize' })).resolves.toBeUndefined()
    expect((await chatSessionsRepo.getSession(sessionId))?.messages.some(message => message.id === 'delete-then-finalize')).toBe(false)
    expect(chats.getSessionMessages(sessionId).some(message => message.id === 'delete-then-finalize')).toBe(false)
    expect((await envelope()).sourceChanges.at(-1)?.status).toBe('pending')
    await expect(chats.flushPersistence()).resolves.toBeUndefined()
    await expect(memory.flush()).rejects.toMatchObject({ code: 'STORAGE_FAILED' })
    fault.mockRestore()
    await getMemorySessionPort()!.completeHistoryChange(sessionId)
    await expect(memory.flush()).resolves.toBeUndefined()
    expect((await envelope()).sourceChanges.at(-1)?.status).toBe('committed')
  })

  it('releases its durable lease during normal shutdown', async () => {
    await memory.dispose()
    expect((await envelope()).lease).toBeNull()
  })

  it('waits for an unexpired crashed-owner lease and automatically resumes after its durable expiry', async () => {
    await memory.submitProfile({ submissionId: 'before-crash', preferredName: 'Recovered Friend', chatPreference: '', recentMatter: '', skipped: false })
    await unmount()
    const target = { principalId, characterId: 'synthetic-character' }
    const oldLease = await memoryRepository.acquireOwner(target, { ownerId: 'crashed-owner', now: Date.now(), leaseMs: 1500, initialActivationId: 'unused' })
    await mount()
    expect(memory.ready).toBe(false)
    expect(memory.recovering).toBe(true)
    expect(memory.recoveryUntil).toBe(oldLease.expiresAt)
    expect((await envelope()).lease?.ownerId).toBe('crashed-owner')
    const diagnostics = await memory.diagnosticsSummary()
    expect(diagnostics.state).toBe('recovering')
    expect(diagnostics.counts?.facts.current).toBe(1)
    expect((await envelope()).lease?.ownerId).toBe('crashed-owner')
    await vi.waitFor(() => expect(memory.ready).toBe(true), { timeout: 5000 })
    expect(memory.recovering).toBe(false)
    expect(memory.facts[0].text).toContain('Recovered Friend')
    expect((await envelope()).lease!.token).toBeGreaterThan(oldLease.token)
  })
})

describe('api-close snapshot and receipt contracts', () => {
  it('returns saved profile and route results without borrowing later state, and marks older receipts honestly', async () => {
    const input = { submissionId: 'result-profile', preferredName: 'Result Friend', chatPreference: '', recentMatter: '', skipped: false }
    const profile = await memory.submitProfile(input)
    expect(profile.result).toMatchObject({ kind: 'profile.submit', savedFields: ['preferredName'], pendingExtraction: false })
    expect(JSON.stringify(profile.result)).not.toContain('Result Friend')
    const options = { operationId: 'route-once', expectedRevision: memory.revision }
    const first = await memory.setModelPolicy({ mode: 'follow-chat' }, options)
    await memory.setModelPolicy({ mode: 'override', providerId: 'another', modelId: 'other' })
    expect(await memory.setModelPolicy({ mode: 'follow-chat' }, options)).toEqual(first)
    expect(memory.modelPolicy.mode).toBe('override')
    const stored = await envelope()
    const old = stored.receipts.find(receipt => receipt.operationId === profile.operationId)!
    delete old.result
    await storage.setItemRaw(`local:memory/v1/${encodeURIComponent(principalId)}/synthetic-character`, stored)
    const retried = await memory.submitProfile(input)
    expect(retried.resultStatus).toBe('not-recorded')
    expect(retried.result).toBeUndefined()
  })

  it('accepts only one of two UI policy commands from the same revision', async () => {
    const expectedRevision = memory.revision
    const results = await Promise.allSettled([
      memory.setEnabled(false, { operationId: 'parallel-first', expectedRevision }),
      memory.setEnabled(false, { operationId: 'parallel-second', expectedRevision }),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect((await envelope()).receipts.filter(receipt => receipt.operationId.startsWith('parallel-'))).toHaveLength(1)
    await expect(memory.flush()).resolves.toBeUndefined()
  })

  it('rejects a profile read whose scope changes while the durable read is pending', async () => {
    await memory.submitProfile({ submissionId: 'late-profile', preferredName: 'PRIVATE_OLD_SCOPE', chatPreference: '', recentMatter: '', skipped: false })
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const read = memoryRepository.read.bind(memoryRepository)
    const delayed = vi.spyOn(memoryRepository, 'read').mockImplementationOnce(async (target) => {
      entered.resolve()
      await release.promise
      return read(target)
    })
    const original = useAuthStore().user!
    const otherPrincipal = `${principalId}-other`
    try {
      const result = memory.readProfile()
      const rejection = expect(result).rejects.toMatchObject({ code: 'STALE_OWNER' })
      await entered.promise
      useAuthStore().user = { ...original, id: otherPrincipal }
      release.resolve()
      await rejection
      await vi.waitFor(() => expect(memory.scope?.principalId).toBe(otherPrincipal))
      await vi.waitFor(() => expect(memory.ready).toBe(true))
      expect(memory.facts).toEqual([])
    }
    finally {
      release.resolve()
      delayed.mockRestore()
      useAuthStore().user = original
      await vi.waitFor(() => expect(memory.scope?.principalId).toBe(principalId))
      await vi.waitFor(() => expect(memory.ready).toBe(true))
      await chatSessionsRepo.clear(otherPrincipal)
      await storage.removeItem(`local:memory/v1/${encodeURIComponent(otherPrincipal)}/synthetic-character`)
    }
  })

  it('rejects late source bytes after revocation and does not turn a native read failure into missing evidence', async () => {
    await send('late-source', 'Private source text')
    const source = (await envelope()).sources[0].ref
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const read = chatSessionsRepo.getSession.bind(chatSessionsRepo)
    const delayed = vi.spyOn(chatSessionsRepo, 'getSession').mockImplementationOnce(async (id) => {
      entered.resolve()
      await release.promise
      return read(id)
    })
    const result = memory.readSourceSnapshot({ sourceId: source.sourceId, sourceRevision: 1 })
    const rejection = expect(result).rejects.toMatchObject({ code: 'STALE_RESULT' })
    await entered.promise
    memory.revoke()
    release.resolve()
    await rejection
    delayed.mockRestore()
    const get = IDBObjectStore.prototype.get
    const fault = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, key) {
      if (key === `airi-local:chat:sessions:${sessionId}`)
        throw new DOMException('Synthetic read fault', 'AbortError')
      return get.call(this, key)
    })
    await expect(memory.readSourceSnapshot({ sourceId: source.sourceId, sourceRevision: 1 })).rejects.toMatchObject({ code: 'STORAGE_FAILED' })
    fault.mockRestore()
  })

  it('reads saved initial fields without reconstructing them from later corrected facts', async () => {
    await memory.submitProfile({ submissionId: 'initial-fields', preferredName: 'Original Friend', chatPreference: 'listen-first', recentMatter: 'Synthetic upcoming interview', skipped: false })
    const fact = memory.facts.find(item => item.category === 'identity')!
    await memory.correctFact({ operationId: 'correct-name', factId: fact.factId, expectedFactRevision: fact.revision, text: 'Current Friend' })
    const profile = await memory.readProfile()
    expect(profile.completionState).toBe('submitted')
    expect(profile.snapshotRevision).toBe(memory.revision)
    expect(profile.initialProfile?.fields.find(field => field.fieldId === 'preferredName')?.value).toBe('Original Friend')
    expect(profile.initialProfile?.fields.find(field => field.fieldId === 'chatPreference')?.value).toContain('先听我说')
    await expect(memory.readProfile({ expectedScope: { principalId: 'foreign', characterId: 'synthetic-character' } })).rejects.toMatchObject({ code: 'SCOPE_MISMATCH' })
  })

  it('returns bounded pages and refuses a cursor from another snapshot or scope', async () => {
    for (let index = 0; index < 52; index++)
      await memory.submitProfile({ submissionId: `page-${index}`, preferredName: '', chatPreference: 'listen-first', recentMatter: '', skipped: false })
    const first = await memory.listMemory({ stateFilter: 'current' })
    expect(first.facts).toHaveLength(50)
    expect(first.nextCursor).toBeDefined()
    const second = await memory.listMemory({ stateFilter: 'current', cursor: first.nextCursor })
    expect(second.facts).toHaveLength(2)
    expect(new Set([...first.facts, ...second.facts].map(fact => `${fact.factId}:${fact.revision}`)).size).toBe(52)
    await expect(memory.listMemory({ stateFilter: 'history', cursor: first.nextCursor })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(memory.listMemory({ stateFilter: 'current', cursor: first.nextCursor, expectedScope: { principalId: 'foreign', characterId: 'synthetic-character' } })).rejects.toMatchObject({ code: 'SCOPE_MISMATCH' })
    await memory.setEnabled(false)
    await expect(memory.listMemory({ stateFilter: 'current', cursor: first.nextCursor })).rejects.toMatchObject({ code: 'CURSOR_EXPIRED' })
  })

  it('returns the original policy receipt and rejects a new stale command without changing policy', async () => {
    const command = { operationId: 'pause-once', expectedRevision: memory.revision }
    const first = await memory.setEnabled(false, command)
    expect(first).toMatchObject({ status: 'succeeded', resultStatus: 'recorded', result: { kind: 'memory.setPolicy', enabled: false } })
    await memory.setEnabled(true, { operationId: 'resume-once', expectedRevision: memory.revision })
    expect(await memory.setEnabled(false, command)).toEqual(first)
    expect(memory.enabled).toBe(true)
    await expect(memory.setEnabled(false, { operationId: 'new-stale-pause', expectedRevision: command.expectedRevision })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    expect(memory.enabled).toBe(true)
  })

  it('returns source versions and historical lineage without substituting changed chat text', async () => {
    const end = memory.beginConversation()
    useConsciousnessStore().activeModel = 'synthetic-model'
    await send('lineage-input', 'Original synthetic evidence')
    end()
    await vi.waitFor(() => expect(memory.facts).toHaveLength(1))
    const fact = memory.facts[0]
    const before = await memory.readSourceSnapshot({ factId: fact.factId, factRevision: fact.revision })
    expect(before.sources[0]).toMatchObject({ status: 'available', text: 'Original synthetic evidence' })
    expect(before.lineage[0]).toMatchObject({ factId: fact.factId, factRevision: fact.revision, sourceVersions: fact.sourceVersions })
    await chats.deleteMessage({ sessionId, messageId: 'lineage-input' })
    const after = await memory.readSourceSnapshot({ factId: fact.factId, factRevision: fact.revision })
    expect(after.sources[0]).toMatchObject({ status: 'deleted' })
    expect(after.sources[0].text).toBeUndefined()
    const history = await memory.listMemory({ stateFilter: 'history' })
    expect(history.facts.some(item => item.factId === fact.factId && item.revision === fact.revision)).toBe(true)
  })

  it('returns diagnostics metadata without copying evidence, prompts or provider secrets', async () => {
    await memory.submitProfile({ submissionId: 'diagnostic-profile', preferredName: 'PRIVATE_NAME_CANARY', chatPreference: '', recentMatter: 'PRIVATE_EVENT_CANARY', skipped: false })
    const diagnostics = await memory.diagnosticsSummary()
    expect(diagnostics.snapshotRevision).toBe(memory.revision)
    expect(diagnostics.counts?.facts.current).toBe(1)
    expect(diagnostics.operations.some(item => item.operationId === 'profile:diagnostic-profile')).toBe(true)
    expect(JSON.stringify(diagnostics)).not.toContain('PRIVATE_NAME_CANARY')
    expect(JSON.stringify(diagnostics)).not.toContain('PRIVATE_EVENT_CANARY')
    expect(JSON.stringify(diagnostics)).not.toContain('apiKey')
    expect(inference.calls).toBe(0)
  })

  it('reports unreadable diagnostics without leaking raw errors or rewriting unsupported data', async () => {
    const original = await envelope()
    const key = `local:memory/v1/${encodeURIComponent(principalId)}/synthetic-character`
    await storage.setItemRaw(key, { ...original, schemaVersion: 9 })
    try {
      const diagnostics = await memory.diagnosticsSummary()
      expect(diagnostics).toMatchObject({ state: 'unavailable', errorCode: 'SCHEMA_UNSUPPORTED', counts: null })
      expect(diagnostics.operations).toEqual([])
      expect(diagnostics.sources).toEqual([])
      expect((await storage.getItemRaw<{ schemaVersion: number }>(key))?.schemaVersion).toBe(9)
    }
    finally {
      await storage.setItemRaw(key, original)
    }
  })
})
