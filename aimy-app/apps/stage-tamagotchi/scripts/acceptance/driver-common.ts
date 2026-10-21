import type { ScenarioInput } from './dataset'
import type { AcceptanceRunInfo } from './entry-events'

import { defineInvoke } from '@moeru/eventa'
import { getElectronEventaContext } from '@proj-airi/electron-vueuse'
import { chatSessionsRepo } from '@proj-airi/stage-ui/database/repos/chat-sessions.repo'
import { injectKeyPiniaSynced } from '@proj-airi/stage-ui/libs/pinia'
import { useChatStore } from '@proj-airi/stage-ui/stores/chat'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useConsciousnessSettingsStore } from '@proj-airi/stage-ui/stores/modules/consciousness-settings'
import { getActivePinia } from 'pinia'

import { offlineFlush, offlineInfo } from './offline-events'

// Restoring an existing session can normalize timestamps during application startup.
// Each scenario replaces this boot clock before creating its case session or sending an input.
Reflect.set(globalThis, '__aimyAcceptanceClock', { now: Date.now(), timeZone: 'Asia/Shanghai' })

interface Hooks {
  arm: 'airi' | 'aimy'
  ready: () => boolean
  configure: (info: AcceptanceRunInfo, restoring: boolean) => Promise<void>
  idle: () => Promise<void>
  memory: () => Promise<unknown>
}

function requireLeader() {
  const element = document.querySelector('#app') as Element & { __vue_app__?: { _context: { provides: Record<symbol, unknown> } } }
  const runtime = element?.__vue_app__?._context.provides[injectKeyPiniaSynced] as { isLeader?: () => boolean } | undefined
  if (!getActivePinia() || !runtime?.isLeader?.())
    throw new Error('ACCEPTANCE_MAIN_LEADER_REQUIRED')
}

async function waitForIdle(probe: () => boolean, code: string) {
  const started = performance.now()
  while (!probe()) {
    if (performance.now() - started > 60_000)
      throw new Error(code)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

/** Imported only into explicitly prepared builds, never ordinary product entrypoints. */
export function installAcceptanceDriver(hooks: Hooks) {
  let info: AcceptanceRunInfo | undefined
  let sessionId: string | undefined
  let busy = false
  const context = () => getElectronEventaContext()
  async function snapshot() {
    requireLeader()
    const sessions = useChatSessionStore()
    if (!sessionId)
      throw new Error('ACCEPTANCE_SESSION_REQUIRED')
    const disk = await chatSessionsRepo.getSession(sessionId)
    if (!disk || disk.meta.sessionId !== sessionId)
      throw new Error('ACCEPTANCE_DISK_SESSION_MISSING')
    const live = sessions.getSessionMessages(sessionId)
    if (Object.values(localStorage).some(value => typeof value === 'string' && /fixture-only-[a-f\d-]{36}/.test(value)))
      throw new Error('ACCEPTANCE_PLAINTEXT_CREDENTIAL_EXPOSURE')
    // Only this task's fictional profile is permitted by the host bootstrap.
    return {
      arm: hooks.arm,
      sessionId,
      characterId: disk.meta.characterId,
      diskMessages: disk.messages,
      liveMessageCount: live.length,
      memory: await hooks.memory(),
      plaintextSyntheticCredentialInLocalStorage: false,
    }
  }
  async function flush() {
    await hooks.idle()
    if (sessionId)
      await useChatSessionStore().persistSessionMessages(sessionId)
    const result = await defineInvoke(context(), offlineFlush)()
    if (!result.ok)
      throw new Error(result.code)
    if (result.value.budget.paused || result.value.budget.reservedMicroYuan !== 0)
      throw new Error('ACCEPTANCE_ACCOUNTING_NOT_SETTLED')
    return result.value
  }
  Reflect.set(globalThis, '__aimyAcceptanceDriver', {
    ready() {
      try {
        requireLeader()
        return useChatSessionStore().isReady && !!useAiriCardStore().activeCard && hooks.ready()
      }
      catch { return false }
    },
    async configure(input: { clock: ScenarioInput['clock'], restoreSessionId?: string }) {
      requireLeader()
      if (info || busy)
        throw new Error('ACCEPTANCE_ALREADY_CONFIGURED')
      Reflect.set(globalThis, '__aimyAcceptanceClock', input.clock)
      const result = await defineInvoke(context(), offlineInfo)()
      if (!result.ok || result.value.arm !== hooks.arm || result.value.phase !== 'run'
        || !['offline-fixture', 'official-model', 'qualification'].includes(result.value.mode)) {
        throw new Error('ACCEPTANCE_HOST_MISMATCH')
      }
      info = result.value
      const restoring = !!input.restoreSessionId
      await hooks.configure(info, restoring)
      const policies = useConsciousnessSettingsStore()
      if (restoring) {
        if (policies.reasoning || policies.temperatureEnabled || policies.topPEnabled)
          throw new Error('ACCEPTANCE_POLICIES_NOT_RESTORED')
      }
      else {
        await policies.setReasoning(false)
        await policies.setTemperatureEnabled(false)
        await policies.setTopPEnabled(false)
      }
      const cards = useAiriCardStore()
      if (!input.restoreSessionId) {
        if (!await cards.updateActiveCardConsciousness({ provider: info.providerInstanceId, model: info.modelId }))
          throw new Error('ACCEPTANCE_CARD_NOT_READY')
        const sessions = useChatSessionStore()
        sessionId = await sessions.createSession(cards.activeCardId, { setActive: true })
      }
      else {
        // Restart evidence must come from the existing persisted selection and session.
        const consciousness = useConsciousnessStore()
        if (consciousness.activeProvider !== info.providerInstanceId || consciousness.activeModel !== info.modelId)
          throw new Error('ACCEPTANCE_MODEL_NOT_RESTORED')
        const sessions = useChatSessionStore()
        if (!await sessions.loadSession(input.restoreSessionId))
          throw new Error('ACCEPTANCE_SESSION_NOT_RESTORED')
        await sessions.setActiveSession(input.restoreSessionId)
        sessionId = input.restoreSessionId
      }
      await flush()
      return snapshot()
    },
    async newSession(input: { clock: ScenarioInput['clock'] }) {
      requireLeader()
      if (!info || busy)
        throw new Error('ACCEPTANCE_NOT_IDLE')
      Reflect.set(globalThis, '__aimyAcceptanceClock', input.clock)
      sessionId = await useChatSessionStore().createSession(useAiriCardStore().activeCardId, { setActive: true })
      const result = await snapshot()
      if (result.diskMessages.some(message => message.role !== 'system'))
        throw new Error('ACCEPTANCE_NEW_SESSION_NOT_EMPTY')
      return result
    },
    async send(input: ScenarioInput) {
      requireLeader()
      if (!info || !sessionId || busy || typeof input.text !== 'string' || input.text.length > 8000)
        throw new Error('ACCEPTANCE_INVALID_SEND')
      busy = true
      try {
        Reflect.set(globalThis, '__aimyAcceptanceClock', input.clock)
        const chat = useChatStore()
        await chat.send({ sessionId, messageId: crypto.randomUUID(), text: input.text, tools: [] })
        await waitForIdle(() => !chat.sending, 'ACCEPTANCE_CHAT_TIMEOUT')
        const accounting = await flush()
        return { ...await snapshot(), accounting }
      }
      finally { busy = false }
    },
    snapshot,
    flush,
    cancel() {
      requireLeader()
      if (sessionId)
        useChatStore().cancelPendingSends(sessionId)
    },
  })
}

export { requireLeader, waitForIdle }
