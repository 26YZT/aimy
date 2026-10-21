import en from '@proj-airi/i18n/locales/en'

import { VoiceController } from '@proj-airi/core-agent'
import { Playback } from '@proj-airi/pipelines-audio'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'

import { applyCompanionPreferences } from '../../services/companion/preferences'
import { configureLocalOnly } from '../../services/local-data-policy'
import { configureProviderSecretStorage } from '../../services/provider-secret-storage'
import { DEFAULT_COMPANION_PREFERENCES } from '../../types/companion'
import { useProviderConfigStore } from '../providers/config'
import { useSpeechStore } from './speech'

const records = new Map<string, Record<string, string>>()
configureProviderSecretStorage({
  async write(input) {
    const reference = { secretRef: crypto.randomUUID(), revision: (input.previous?.revision ?? 0) + 1 }
    records.set(reference.secretRef, { ...input.secrets })
    return reference
  },
  async read(input) { return records.get(input.reference.secretRef)! },
  async remove(input) { records.delete(input.reference.secretRef) },
})

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0))
    await close()
  localStorage.clear()
  records.clear()
  applyCompanionPreferences(DEFAULT_COMPANION_PREFERENCES)
  vi.unstubAllGlobals()
})

function audioEvent(value: number) {
  return `data: ${JSON.stringify({ choices: [{ delta: { audio: { data: btoa(String.fromCharCode(value & 255, (value >> 8) & 255)) } } }] })}\n\n`
}

async function mount() {
  configureLocalOnly()
  const sources: ReadableStreamDefaultController<Uint8Array>[] = []
  const networkCancelled = vi.fn()
  const network = vi.fn<typeof fetch>(async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { sources.push(controller) },
    cancel: networkCancelled,
  }), { headers: { 'content-type': 'text/event-stream' } }))
  vi.stubGlobal('fetch', network)
  const pinia = createPinia()
  let speech!: ReturnType<typeof useSpeechStore>
  const app = createApp({ setup() {
    speech = useSpeechStore()
    return () => null
  } })
  app.use(createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false })).use(pinia).mount(document.createElement('div'))
  await useProviderConfigStore(pinia).ensureProvider('fixture-mimo', 'mimo-audio-speech', { baseUrl: 'https://synthetic.invalid/v1/', stylePrompt: 'Speak naturally.' })
  await useProviderConfigStore(pinia).patchProviderConfig('fixture-mimo', { apiKey: 'synthetic-voice-key' })
  const samples: number[] = []
  const rates: number[] = []
  const captions: string[] = []
  const playback = new Playback({ nowMs: () => 0, play: (clip) => {
    if (!(clip.audio instanceof ReadableStream))
      throw new Error('Expected PCM streaming playback')
    const reader = clip.audio.getReader()
    const done = (async () => {
      let started = false
      try {
        while (true) {
          const next = await reader.read()
          if (next.done)
            break
          if (!started) {
            clip.onStart?.()
            started = true
          }
          samples.push(...next.value.channels[0])
          rates.push(next.value.sampleRate)
        }
        return { throughMs: samples.length / 24 }
      }
      finally { reader.releaseLock() }
    })()
    return { done, stop: async () => {
      await reader.cancel().catch(() => {})
      return { throughMs: samples.length / 24 }
    } }
  } })
  const audio = new AudioContext()
  const selection = { provider: 'fixture-mimo', model: 'mimo-v2.5-tts', voice_id: '冰糖' }
  const createOutput = (model = selection.model) => speech.createOutput({ sessionId: 'fixture-session', turnId: 'fixture-turn' }, { ...selection, model }, { playback, onPlaybackStart: clip => captions.push(clip.text) }, audio)
  const voice = new VoiceController({ transcriber: vi.fn(), submit: vi.fn(), speech: () => createOutput() })
  cleanup.push(async () => {
    await voice.close()
    app.unmount()
    disposePinia(pinia)
    await audio.close()
  })
  return { voice, network, sources, networkCancelled, samples, rates, captions, createOutput }
}

it('routes a custom MiMo instance through real VoiceController and ordered PCM playback before HTTP completion', async () => {
  applyCompanionPreferences({ ...DEFAULT_COMPANION_PREFERENCES, speech: { ...DEFAULT_COMPANION_PREFERENCES.speech, directorEnabled: true } })
  const { voice, network, sources, samples, rates, captions } = await mount()
  const response = voice.openResponse({ sessionId: 'fixture-session', turnId: 'fixture-turn' })
  const producer = response.openSpeech({ purpose: 'answer' })
  await producer.write('你好。欢迎回来。')
  producer.end()
  await expect.poll(() => network.mock.calls.length).toBe(1)
  sources[0].enqueue(new TextEncoder().encode(audioEvent(8192)))
  await expect.poll(() => samples).toEqual([0.25])
  expect(rates).toEqual([24000])
  expect(network).toHaveBeenCalledOnce()
  sources[0].enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
  await expect.poll(() => network.mock.calls.length).toBe(2)
  sources[1].enqueue(new TextEncoder().encode(`${audioEvent(16384)}data: [DONE]\n\n`))
  expect(await response.finish()).toBe('finished')
  expect(samples).toEqual([0.25, 0.5])
  expect(captions).toEqual(['你好。', '欢迎回来。'])
  expect(network.mock.calls.map(call => JSON.parse(String(call[1]?.body)).messages)).toEqual([
    [{ role: 'user', content: 'Speak naturally.' }, { role: 'assistant', content: '你好。' }],
    [{ role: 'user', content: 'Speak naturally.' }, { role: 'assistant', content: '欢迎回来。' }],
  ])
})

it('cancels the in-flight MiMo request before any PCM and schedules no later sentence', async () => {
  const { voice, network, samples, networkCancelled } = await mount()
  const response = voice.openResponse({ sessionId: 'fixture-session', turnId: 'fixture-turn' })
  const producer = response.openSpeech({ purpose: 'answer' })
  await producer.write('你好。欢迎回来。')
  producer.end()
  await expect.poll(() => network.mock.calls.length).toBe(1)
  producer.cancel('User interrupted')
  await producer.done
  await expect.poll(() => networkCancelled.mock.calls.length).toBe(1)
  expect(network.mock.calls[0][1]?.signal?.aborted).toBe(true)
  expect(network).toHaveBeenCalledOnce()
  expect(samples).toEqual([])
})

it('retains sentence synthesis for translation, voice design and voice cloning', async () => {
  const { createOutput, network } = await mount()
  expect('synthesize' in createOutput('mimo-v2.5-tts-voicedesign')).toBe(true)
  expect('synthesize' in createOutput('mimo-v2.5-tts-voiceclone')).toBe(true)
  applyCompanionPreferences({ ...DEFAULT_COMPANION_PREFERENCES, speech: { ...DEFAULT_COMPANION_PREFERENCES.speech, translationEnabled: true } })
  expect('synthesize' in createOutput()).toBe(true)
  expect(network).not.toHaveBeenCalled()
})

it('stops played PCM and the pending sentence when the user interrupts mid-response', async () => {
  const { voice, network, sources, samples, networkCancelled } = await mount()
  const response = voice.openResponse({ sessionId: 'fixture-session', turnId: 'fixture-turn' })
  const producer = response.openSpeech({ purpose: 'answer' })
  await producer.write('你好。欢迎回来。')
  producer.end()
  await expect.poll(() => network.mock.calls.length).toBe(1)
  sources[0].enqueue(new TextEncoder().encode(audioEvent(8192)))
  await expect.poll(() => samples).toEqual([0.25])
  producer.cancel('User interrupted')
  await producer.done
  await expect.poll(() => networkCancelled.mock.calls.length).toBe(1)
  expect(network.mock.calls[0][1]?.signal?.aborted).toBe(true)
  expect(network).toHaveBeenCalledOnce()
  expect(samples).toEqual([0.25])
})

it('fails the actual response on a truncated PCM stream without starting the next sentence', async () => {
  const { voice, network, sources, samples } = await mount()
  const response = voice.openResponse({ sessionId: 'fixture-session', turnId: 'fixture-turn' })
  const producer = response.openSpeech({ purpose: 'answer' })
  await producer.write('你好。欢迎回来。')
  producer.end()
  await expect.poll(() => network.mock.calls.length).toBe(1)
  sources[0].enqueue(new TextEncoder().encode(audioEvent(8192)))
  sources[0].close()
  expect((await producer.done).status).toBe('failed')
  expect(network).toHaveBeenCalledOnce()
  expect(samples).toEqual([0.25])
})
