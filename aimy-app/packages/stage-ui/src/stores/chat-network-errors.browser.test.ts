import type { GenerationProvider } from '@proj-airi/provider-inference'

import en from '@proj-airi/i18n/locales/en'

import { createPinia, disposePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'

import { chatSessionsRepo } from '../database/repos/chat-sessions.repo'
import { configureLocalOnly } from '../services/local-data-policy'
import { useChatStore } from './chat'
import { useChatSessionStore } from './chat/session-store'
import { configureAcceptanceBudget } from './memory/budget'
import { useModsServerChannelStore } from './mods/api/channel-server'
import { useConsciousnessStore } from './modules/consciousness'

// The local channel is an external transport. This test exercises HTTP generation, not another running desktop instance.
vi.mock('@proj-airi/server-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@proj-airi/server-sdk')>()
  return {
    ...actual,
    Client: class {
      onEvent = vi.fn()
      offEvent = vi.fn()
      send = vi.fn()
      close = vi.fn()
    },
  }
})

describe('chat network errors', () => {
  it('stores a safe model failure after a real SDK HTTP error and suppresses cancellation messages', async () => {
    configureLocalOnly()
    localStorage.clear()
    const pinia = createPinia()
    const app = createApp({
      setup() {
        useChatStore()
        return () => null
      },
    })
    app.use(pinia).use(createI18n({ legacy: false, locale: 'en', messages: { en } })).mount(document.createElement('div'))
    const chat = useChatStore(pinia)
    const sessions = useChatSessionStore(pinia)
    await sessions.initialize()
    const sessionId = sessions.activeSessionId
    const secret = 'synthetic-network-secret-canary'
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const request = vi.fn(async () => Response.json({ error: { message: `Rejected ${secret}` } }, { status: 401 }))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://synthetic.invalid/v1/', apiKey: secret, fetch: request } }) }
    const consciousness = useConsciousnessStore(pinia)
    consciousness.activeProvider = 'openai'
    consciousness.activeModel = 'synthetic-model'
    const providerLookup = vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    try {
      await expect(chat.send({ sessionId, text: 'A synthetic greeting.' })).rejects.toMatchObject({ code: 'GENERATION_AUTH_FAILED', status: 401 })
      await sessions.flushPersistence()
      expect(sessions.getSessionMessages(sessionId).at(-1)).toMatchObject({ role: 'error', content: expect.stringContaining('GENERATION_AUTH_FAILED') })
      expect(JSON.stringify(pinia.state.value)).not.toContain(secret)
      expect(JSON.stringify(await chatSessionsRepo.getSession(sessionId))).not.toContain(secret)
      expect(JSON.stringify(errors.mock.calls)).not.toContain(secret)
      expect(JSON.stringify(warnings.mock.calls)).not.toContain(secret)
      expect(request).toHaveBeenCalledTimes(1)

      const previousErrors = sessions.getSessionMessages(sessionId).filter(message => message.role === 'error').length
      providerLookup.mockRejectedValue(new DOMException('private abort detail', 'AbortError'))
      await expect(chat.send({ sessionId, text: 'A cancelled synthetic request.' })).rejects.toMatchObject({ name: 'AbortError' })
      expect(sessions.getSessionMessages(sessionId).filter(message => message.role === 'error')).toHaveLength(previousErrors)

      configureAcceptanceBudget({ reserve: vi.fn(), started: vi.fn(), releaseNotSent: vi.fn(), settle: vi.fn(), status: vi.fn() })
      providerLookup.mockResolvedValue(provider)
      request.mockClear()
      await expect(chat.send({ sessionId, text: 'Synthetic image input.', attachments: [{ type: 'image', data: 'synthetic-image-data', mimeType: 'image/png' }] })).rejects.toMatchObject({ code: 'ACCEPTANCE_TEXT_ONLY' })
      expect(request).not.toHaveBeenCalled()
    }
    finally {
      vi.restoreAllMocks()
      await chat.cancelPendingSends()
      await sessions.deleteSession(sessionId)
      useModsServerChannelStore(pinia).dispose()
      await chat.dispose()
      app.unmount()
      disposePinia(pinia)
      localStorage.clear()
    }
  })
})
