import type { WebSocketEventOf } from '@proj-airi/server-sdk'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useLLM } from '../../stores/ai/chat-llm/llm'
import { useCharacterStore } from '../../stores/character'
import { useCharacterOrchestratorStore } from '../../stores/character/orchestrator'
import { useConsciousnessStore } from '../../stores/modules/consciousness'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ locale: ref('en'), t: (key: string) => key, te: () => true }) }))
const event: WebSocketEventOf<'spark:notify'> = { type: 'spark:notify', source: 'companion', data: { id: 'followup-test', eventId: 'followup-test', kind: 'reminder', urgency: 'immediate', headline: 'Current conversation followup', destinations: ['character'] } }
beforeEach(() => {
  setActivePinia(createPinia())
  const consciousness = useConsciousnessStore()
  consciousness.activeProvider = 'fixture'
  consciousness.activeModel = 'fixture'
  vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue({ generation: model => ({ protocol: 'chat-completions', config: { model, apiKey: 'synthetic', baseURL: 'https://example.invalid/' } }) })
})
describe('guarded internal Spark generation', () => {
  it('buffers all text without presentation and carries the runtime guard into transport', async () => {
    const llm = useLLM()
    const stream = vi.spyOn(llm, 'stream').mockImplementation(async (_model, _provider, _conversation, options) => {
      expect(options?.supportsTools).toBe(false)
      expect(options?.maxOutputTokens).toBe(512)
      expect(options?.assertCurrent).toBeTypeOf('function')
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'Rest a bit.' })
      await options?.onStreamEvent?.({ type: 'finish' })
    })
    const character = useCharacterStore()
    const store = useCharacterOrchestratorStore()
    expect(await store.generateFollowup(event, { signal: new AbortController().signal, isCurrent: () => true })).toBe('Rest a bit.')
    expect(character.reactions).toEqual([])
    expect(stream).toHaveBeenCalledOnce()
  })
  it('aborts and rejects a model change during generation', async () => {
    vi.spyOn(useLLM(), 'stream').mockImplementation(async (_model, _provider, _conversation, options) => {
      useConsciousnessStore().activeModel = 'changed'
      expect(options?.abortSignal?.aborted).toBe(true)
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'stale' })
    })
    const store = useCharacterOrchestratorStore()
    await expect(store.generateFollowup(event, { signal: new AbortController().signal, isCurrent: () => true })).rejects.toThrow('Followup cancelled')
    expect(useCharacterStore().reactions).toEqual([])
  })
})
