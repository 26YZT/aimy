import type { ChatStreamEventContext } from '../../types/chat'
import type { MemoryEnvelope, MemoryFact } from '../../types/memory'

import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'

import { chatSessionsRepo } from '../../database/repos/chat-sessions.repo'
import { memoryRepository } from '../../database/repos/memory.repo'
import { storage } from '../../database/storage'
import { useAuthStore } from '../../stores/auth'
import { useChatStore } from '../../stores/chat'
import { useChatSessionStore } from '../../stores/chat/session-store'
import { useCompanionStore } from '../../stores/companion'
import { useCompanionSettingsStore } from '../../stores/companion-settings'
import { useMemoryStore } from '../../stores/memory'
import { parseEnvelope } from '../../stores/memory/schema'
import { useAiriCardStore } from '../../stores/modules/airi-card'
import { DEFAULT_COMPANION_PREFERENCES } from '../../types/companion'
import { configureLocalOnly } from '../local-data-policy'
import { getResourcePolicy, installResourcePolicy, ResourcePolicy } from '../resource-policy'
import { FollowupRepository } from './followup'
import { ReviewRepository } from './review'
import { CompanionSettingsRepository } from './settings'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ locale: ref('en'), t: (key: string) => key, te: () => true }) }))
vi.mock('../../libs/auth-fetch', () => ({ authedFetch: () => {
  throw new Error('No account cloud in runtime fixture')
} }))

let pinia: ReturnType<typeof createPinia>
let runtime: ReturnType<typeof createSyncedPiniaPlugin>
let app: ReturnType<typeof createApp>
let companion: ReturnType<typeof useCompanionStore>
let settings: ReturnType<typeof useCompanionSettingsStore>
let sessions: ReturnType<typeof useChatSessionStore>
let memory: ReturnType<typeof useMemoryStore>
let chat: ReturnType<typeof useChatStore>
let principal: string
let sessionId: string
let character: string
let resourceRevision = 0
const ownedKeys = new Set<string>()
function currentScope() {
  return { principalId: principal, characterId: character, sessionId }
}
function memoryKey() {
  return `local:memory/v1/${principal}/${character}`
}
function hookContext(text = 'I have an interview'): ChatStreamEventContext {
  return { sessionId, turnId: 'synthetic-turn', message: { id: 'user-1', role: 'user', content: text }, contexts: {}, composedMessage: [],
  }
}
async function completeTurn(text = 'I have an interview') {
  await chat.emitChatTurnCompleteHooks({ output: { role: 'assistant', content: 'I hear you.', slices: [], tool_results: [] }, outputText: 'I hear you.', toolCalls: [] }, hookContext(text))
}
async function enableFollowup() {
  const preferences = structuredClone(DEFAULT_COMPANION_PREFERENCES)
  preferences.followup.enabled = true
  await settings.save(preferences, [{ id: 'interview', name: 'Interview followup', enabled: true, priority: 1, mode: 'all', conditions: [{ field: 'source', operator: 'equals', value: 'chat-complete' }, { field: 'text', operator: 'contains', value: 'interview' }], action: { type: 'followup', delayMinutes: 2 } }], settings.snapshot.revision)
  await nextTick()
}
async function storedPlans() {
  return new FollowupRepository().read(currentScope())
}

beforeEach(async () => {
  configureLocalOnly()
  await storage.removeItem('local:companion/settings/v1')
  principal = `companion-runtime-${crypto.randomUUID()}`
  pinia = createPinia()
  runtime = createSyncedPiniaPlugin({ namespace: principal, leadership: 'leader-only', callTimeout: 3000,
  })
  pinia.use(runtime.plugin)
  app = createApp(defineComponent(() => () => h('div')))
  app.use(pinia).mount(document.createElement('div'))
  setActivePinia(pinia)
  useAuthStore().user = { id: principal, name: 'Synthetic', email: 'synthetic@example.test', emailVerified: true, createdAt: new Date(0), updatedAt: new Date(0),
  }
  character = useAiriCardStore().activeCardId
  sessions = useChatSessionStore()
  memory = useMemoryStore()
  await vi.waitFor(() => expect(runtime.isLeader()).toBe(true))
  await memory.initialize(runtime)
  await sessions.initialize()
  sessionId = sessions.activeSessionId
  await memory.setEnabled(false)
  await sessions.commitUserMessage(sessionId, { id: 'user-1', role: 'user', content: 'I have an interview',
  })
  if (!getResourcePolicy()) {
    installResourcePolicy(new ResourcePolicy({ setEnabled: async () => {
      throw new Error('No capture in runtime fixture')
    } }))
  }
  getResourcePolicy()!.apply({ revision: ++resourceRevision, appEpoch: resourceRevision, active: true, reason: 'synthetic-visible', microphone: { enabled: false, epoch: 0 }, screen: { enabled: false, epoch: 0 },
  })
  chat = useChatStore()
  settings = useCompanionSettingsStore()
  companion = useCompanionStore()
  ownedKeys.add(memoryKey())
  ownedKeys.add(`local:companion/followup/v1/${principal}/${character}`)
  ownedKeys.add(`local:companion/review/v1/${principal}/${character}`)
})
afterEach(async () => {
  vi.restoreAllMocks()
  await companion?.dispose().catch(() => {})
  await memory?.dispose().catch(() => {})
  sessions?.dispose()
  runtime?.dispose()
  app?.unmount()
  disposePinia(pinia)
  await chatSessionsRepo.clear(principal)
  for (const key of ownedKeys) await storage.removeItem(key)
  ownedKeys.clear()
  await storage.removeItem('local:companion/settings/v1')
})

describe('companion runtime with actual Pinia, sync ownership and IndexedDB', () => {
  beforeEach(async () => {
    await companion.initialize(runtime)
  })
  it('default-off completion schedules nothing and optional storage failure cannot reject base send hooks', async () => {
    expect(settings.snapshot.preferences.followup.enabled).toBe(false)
    await completeTurn()
    expect(await storedPlans()).toEqual([])
    vi.spyOn(FollowupRepository.prototype, 'cancel').mockRejectedValue(new Error('Synthetic IDB write failure'))
    await expect(chat.emitBeforeSendHooks('next message', hookContext('next message'))).resolves.toBeUndefined()
  })
  it('matches a completion rule, persists one plan and adds no fake user message', async () => {
    await enableFollowup()
    const before = sessions.getSessionMessages(sessionId).filter(item => item.role === 'user').length
    await completeTurn()
    const plans = await storedPlans()
    expect(plans.filter(plan => plan.state === 'scheduled')).toHaveLength(1)
    expect(plans[0].dueAt - plans[0].createdAt).toBe(120_000)
    expect(companion.lastRule).toBe('interview')
    expect(sessions.getSessionMessages(sessionId).filter(item => item.role === 'user')).toHaveLength(before)
  })
  it('cancels a pending plan on a real source edit and before a new input', async () => {
    await enableFollowup()
    await completeTurn()
    const messages = sessions.getSessionMessages(sessionId)
    const user = messages.find(item => item.id === 'user-1')
    if (!user)
      throw new Error('Missing synthetic source')
    user.content = 'The interview was cancelled'
    await nextTick()
    await expect.poll(async () => (await storedPlans()).some(plan => plan.state === 'scheduled')).toBe(false)
    await completeTurn('The interview was cancelled')
    expect((await storedPlans()).some(plan => plan.state === 'scheduled')).toBe(true)
    await chat.emitBeforeSendHooks('New topic', hookContext('New topic'))
    expect((await storedPlans()).some(plan => plan.state === 'scheduled')).toBe(false)
  })
  it('reads all memory pages before deciding an older review lost its dependencies', async () => {
    const raw = await storage.getItemRaw<MemoryEnvelope>(memoryKey())
    if (!raw)
      throw new Error('Missing synthetic memory')
    const timestamp = Date.now()
    raw.facts = []
    raw.sources = []
    for (let index = 0; index < 60; index++) {
      const sourceId = `source-${index}`
      const version = { sourceId, sourceRevision: 1, contentHash: `hash-${index}`,
      }
      raw.sources.push({ ref: { ...version, principalId: principal, characterId: character, kind: 'chat-message', sessionId, messageId: sourceId, activationId: raw.policy.activationId, author: 'user', authoredAt: timestamp - index, committedAt: timestamp - index, channel: 'text' }, lifecycle: 'current', text: `Synthetic preference ${index}`,
      })
      raw.facts.push({ factId: `fact-${index}`, factKey: `key-${index}`, revision: 1, category: 'preference', subject: 'user', label: `Preference ${index}`, text: `Synthetic preference ${index}`, keywords: [], status: 'current', kind: 'direct', sourceVersions: [version], dependsOnFactIds: [], confirmationAt: timestamp - index, committedAt: timestamp - index } satisfies MemoryFact)
    }
    raw.revision++
    await storage.setItemRaw(memoryKey(), parseEnvelope(raw))
    await new ReviewRepository().create(currentScope(), [raw.facts[59]], 'day', 1, timestamp)
    await companion.refresh()
    expect(companion.reviews[0].status).toBe('current')
    expect(companion.reviews[0].entries[0].factId).toBe('fact-59')
  })
  it('does not write old-scope reviews after scope changes during a repository read', async () => {
    const read = memoryRepository.read.bind(memoryRepository)
    const paused = Promise.withResolvers<void>()
    let entered = false
    vi.spyOn(memoryRepository, 'read').mockImplementation(async (scope) => {
      if (!entered) {
        entered = true
        await paused.promise
      }
      return read(scope)
    })
    const reviewRead = vi.spyOn(ReviewRepository.prototype, 'read')
    const pending = companion.refresh().catch(() => {})
    await expect.poll(() => entered).toBe(true)
    useAiriCardStore().activeCardId = `other-${crypto.randomUUID()}`
    await nextTick()
    paused.resolve()
    await pending
    expect(reviewRead.mock.calls.every(([scope]) => scope.characterId !== character)).toBe(true)
    ownedKeys.add(`local:memory/v1/${principal}/${useAiriCardStore().activeCardId}`)
    ownedKeys.add(`local:companion/followup/v1/${principal}/${useAiriCardStore().activeCardId}`)
    ownedKeys.add(`local:companion/review/v1/${principal}/${useAiriCardStore().activeCardId}`)
  })
})

describe('retryable companion initialization', () => {
  it('finishes disposal during settings loading without acquiring ownership or registering late chat hooks', async () => {
    const read = CompanionSettingsRepository.prototype.read
    const loaded = Promise.withResolvers<void>()
    const reading = vi.spyOn(CompanionSettingsRepository.prototype, 'read').mockImplementationOnce(async function (this: CompanionSettingsRepository) {
      await loaded.promise
      return read.call(this)
    })
    const recovering = vi.spyOn(FollowupRepository.prototype, 'recover')
    const initialization = companion.initialize(runtime)
    await expect.poll(() => reading.mock.calls.length).toBe(1)
    let disposed = false
    const disposal = companion.dispose().then(() => {
      disposed = true
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(disposed).toBe(false)
    loaded.resolve()
    await Promise.all([initialization, disposal])
    expect(disposed).toBe(true)
    expect(recovering).not.toHaveBeenCalled()
    await enableFollowup()
    await completeTurn()
    expect(await storedPlans()).toEqual([])
  })

  it('waits for the same pending ownership recovery before repeated initialization resolves', async () => {
    const recover = FollowupRepository.prototype.recover
    const recovered = Promise.withResolvers<void>()
    const recovering = vi.spyOn(FollowupRepository.prototype, 'recover').mockImplementationOnce(async function (this: FollowupRepository, scope) {
      await recovered.promise
      return recover.call(this, scope)
    })
    const first = companion.initialize(runtime)
    await expect.poll(() => recovering.mock.calls.length).toBe(1)
    let secondSettled = false
    const second = companion.initialize(runtime).then(() => {
      secondSettled = true
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(secondSettled).toBe(false)
    recovered.resolve()
    await Promise.all([first, second])
    expect(secondSettled).toBe(true)
    expect(recovering).toHaveBeenCalledOnce()
    await enableFollowup()
    await completeTurn()
    expect(await storedPlans()).toHaveLength(1)
  })

  it('retries a settings read failure and registers a single completion consumer across repeated initialization', async () => {
    const read = CompanionSettingsRepository.prototype.read
    const retryReady = Promise.withResolvers<void>()
    const reading = vi.spyOn(CompanionSettingsRepository.prototype, 'read')
      .mockRejectedValueOnce(new Error('Synthetic initial settings read failure'))
      .mockImplementationOnce(async function (this: CompanionSettingsRepository) {
        await retryReady.promise
        return read.call(this)
      })
    await expect(companion.initialize(runtime)).rejects.toThrow('COMPANION_SETTINGS_LOAD_FAILED')
    expect(settings.ready).toBe(false)
    const first = companion.initialize(runtime)
    const concurrent = companion.initialize(runtime)
    await expect.poll(() => reading.mock.calls.length).toBe(2)
    retryReady.resolve()
    await Promise.all([first, concurrent])
    expect(settings.ready).toBe(true)
    await companion.initialize(runtime)
    expect(reading).toHaveBeenCalledTimes(2)
    await enableFollowup()
    await completeTurn()
    const plans = await storedPlans()
    expect(plans).toHaveLength(1)
    expect(plans[0].state).toBe('scheduled')
    expect(plans[0].dueAt - plans[0].createdAt).toBe(120_000)
  })
})
