import type { VoiceMessageCommand } from '../../../../services/speech/bus'

import { defineInvokeHandler } from '@moeru/eventa'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'

import { getSpeechBusContext, voiceInputCommand, voiceMessageCommand, voiceMessagesChanged, voiceRequestSnapshot, voiceSnapshotChanged } from '../../../../services/speech/bus'
import { useVoiceComposer } from './use-voice-composer'

const cleanup: Array<() => void> = []
afterEach(() => cleanup.splice(0).reverse().forEach(close => close()))

function mount(handler: (command: VoiceMessageCommand) => Promise<{ status: 'closed' | 'accepted' }> | { status: 'closed' | 'accepted' }) {
  const bus = getSpeechBusContext()
  cleanup.push(bus.on(voiceRequestSnapshot, () => bus.emit(voiceSnapshotChanged, { connected: true, drafts: [] })))
  cleanup.push(defineInvokeHandler(bus, voiceMessageCommand, handler))
  cleanup.push(defineInvokeHandler(bus, voiceInputCommand, () => ({ status: 'closed' })))
  const pinia = createPinia()
  const error = vi.fn()
  let composer!: ReturnType<typeof useVoiceComposer>
  const app = createApp({ setup() {
    composer = useVoiceComposer({ sessionId: () => 'fixture', onTranscript: vi.fn(), onError: error })
    return () => null
  } })
  app.use(pinia).use(createI18n({ legacy: false, locale: 'en', messages: { en: {} }, missingWarn: false, fallbackWarn: false })).mount(document.createElement('div'))
  cleanup.push(() => {
    app.unmount()
    disposePinia(pinia)
  })
  return { composer, error, bus }
}

it.each(['audio', 'transcription'] as const)('returns to idle when the shared host declines %s instead of staying in starting', async (mode) => {
  const { composer, error } = mount(() => ({ status: 'closed' }))
  await composer.start(mode)
  expect(composer.phase.value).toBe('idle')
  expect(error).not.toHaveBeenCalled()
})

it('does not erase a newer recording or show a failure when an older cancelled start rejects', async () => {
  const late = Promise.withResolvers<{ status: 'accepted' }>()
  let starts = 0
  const { composer, error, bus } = mount((command) => {
    if (command.type === 'record') {
      if (starts++ === 0)
        return late.promise
      bus.emit(voiceMessagesChanged, [{ id: command.id, sessionId: command.sessionId, phase: 'capturing' }])
    }
    return { status: 'accepted' }
  })
  const first = composer.start('audio')
  await expect.poll(() => starts).toBe(1)
  await composer.cancel()
  await composer.start('audio')
  expect(composer.phase.value).toBe('recording')
  late.reject(new DOMException('Cancelled', 'AbortError'))
  await first
  expect(composer.phase.value).toBe('recording')
  expect(error).not.toHaveBeenCalled()
})
