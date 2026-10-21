import type { TtsRequest } from '@proj-airi/pipelines-audio'
import type { GenerationProvider } from '@proj-airi/provider-inference'
import type { SpeechProviderWithExtraOptions } from '@xsai-ext/providers/utils'

import en from '@proj-airi/i18n/locales/en'

import { Playback } from '@proj-airi/pipelines-audio'
import { generateSpeech } from '@xsai/generate-speech'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent } from 'vue'
import { createI18n } from 'vue-i18n'

import { applyCompanionPreferences } from '../../services/companion/preferences'
import { getCompanionSpeechStatus } from '../../services/companion/speech-transform'
import { recentSpeechEcho } from '../../services/companion/voice-policy'
import { DEFAULT_COMPANION_PREFERENCES } from '../../types/companion'
import { useProviderConfigStore } from '../providers/config'
import { useProviderStore } from '../providers/provider'
import { useConsciousnessStore } from './consciousness'
import { useSpeechStore } from './speech'

vi.mock('@xsai/generate-speech', () => ({ generateSpeech: vi.fn(async () => new ArrayBuffer(8)) }))

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0))
    await close()
  applyCompanionPreferences(DEFAULT_COMPANION_PREFERENCES)
  recentSpeechEcho.reset()
  localStorage.clear()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

async function mount(generate: (body: Record<string, unknown>, signal: AbortSignal | null | undefined) => Promise<string>, directed: boolean | 'custom-microsoft' = false, providerConfig?: Record<string, unknown>) {
  // Every HTTP boundary is synthetic, including background provider catalog requests.
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ data: [] })))
  const pinia = createPinia()
  let speech!: ReturnType<typeof useSpeechStore>
  let providers!: ReturnType<typeof useProviderStore>
  let consciousness!: ReturnType<typeof useConsciousnessStore>
  const app = createApp(defineComponent({ setup() {
    speech = useSpeechStore()
    providers = useProviderStore()
    consciousness = useConsciousnessStore()
    return () => null
  } }))
  app.use(pinia).use(createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false }))
  const element = document.createElement('div')
  document.body.append(element)
  app.mount(element)
  const audio = new AudioContext()
  cleanup.push(async () => {
    app.unmount()
    disposePinia(pinia)
    element.remove()
    await audio.close()
  })
  consciousness.activeProvider = 'synthetic-chat'
  consciousness.activeModel = 'synthetic-model'
  const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: {
    baseURL: 'https://synthetic.invalid/v1/',
    model,
    fetch: async (_url: URL, request: RequestInit) => {
      const text = await generate(JSON.parse(String(request.body)), request.signal)
      return new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
    },
  } }) }
  vi.spyOn(providers, 'getChatProviderInstance').mockResolvedValue(provider)
  const tts: SpeechProviderWithExtraOptions<string, Record<string, unknown>> = { speech: model => ({ baseURL: 'https://synthetic.invalid/v1/', model }) }
  vi.spyOn(providers, 'getProviderInstance').mockResolvedValue(tts)
  const directedProvider = typeof directed === 'string' ? directed : 'microsoft-speech'
  if (directed) {
    await useProviderConfigStore(pinia).ensureProvider(directedProvider, 'microsoft-speech', { baseUrl: 'https://synthetic.invalid/', ...providerConfig })
    vi.spyOn(providers, 'listProviderVoices').mockResolvedValue([{ id: 'voice', name: 'Fixture voice', provider: directedProvider, languages: [{ code: 'zh-CN', title: 'Chinese' }] }])
    await speech.loadVoicesForProvider(directedProvider, 'tts')
    speech.ssmlEnabled = true
  }
  const playback = new Playback({ nowMs: () => 0, play: () => ({ done: Promise.resolve({ throughMs: 0 }), stop: async () => ({ throughMs: 0 }) }) })
  const caption = vi.fn()
  const output = speech.createOutput({ sessionId: 'synthetic-session', turnId: 'synthetic-turn' }, { provider: directed ? directedProvider : 'synthetic-tts', model: 'tts', voice_id: 'voice' }, { playback, onPlaybackStart: caption }, audio)
  if (!('synthesize' in output))
    throw new Error('Expected a sentence speech output')
  const request: TtsRequest = { streamId: 'stream', intentId: 'intent', segmentId: 'segment', sequence: 0, text: '今天辛苦了，先歇一会儿。', special: null, reason: 'flush', priority: 0, createdAt: 0 }
  return { output, request, caption, consciousness, pinia, speech, audio, playback }
}

it('runs the real chat adapter before TTS while retaining original captions and recording only played translated text', async () => {
  applyCompanionPreferences({ ...DEFAULT_COMPANION_PREFERENCES, speech: { ...DEFAULT_COMPANION_PREFERENCES.speech, translationEnabled: true, echoFilterEnabled: true } })
  const generate = vi.fn<(body: Record<string, unknown>, signal: AbortSignal | null | undefined) => Promise<string>>(async () => 'Today was hard. Please take a rest.')
  const { output, request, caption } = await mount(generate)
  await output.synthesize(request, new AbortController().signal)
  expect(generate).toHaveBeenCalledOnce()
  expect(generate.mock.calls[0][0]).toMatchObject({ max_tokens: 1024, model: 'synthetic-model' })
  expect(generateSpeech).toHaveBeenCalledWith(expect.objectContaining({ input: 'Today was hard. Please take a rest.' }))
  expect(recentSpeechEcho.matches('synthetic-session', 'Today was hard. Please take a rest.')).toBe(false)
  output.onPlaybackStart?.({ id: request.segmentId, text: request.text })
  expect(caption).toHaveBeenCalledWith({ id: request.segmentId, text: request.text })
  expect(recentSpeechEcho.matches('synthetic-session', 'Today was hard. Please take a rest.')).toBe(true)
})

it('does not synthesize late translation after the model or feature changes', async () => {
  applyCompanionPreferences({ ...DEFAULT_COMPANION_PREFERENCES, speech: { ...DEFAULT_COMPANION_PREFERENCES.speech, translationEnabled: true } })
  const pending = Promise.withResolvers<string>()
  const generate = vi.fn(() => pending.promise)
  const { output, request, consciousness } = await mount(generate)
  const result = output.synthesize(request, new AbortController().signal)
  const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' })
  await expect.poll(() => generate).toHaveBeenCalledOnce()
  consciousness.activeModel = 'changed-model'
  pending.resolve('late result')
  await assertion
  expect(generateSpeech).not.toHaveBeenCalled()
})

it('preserves the existing TTS call with no transform request when disabled', async () => {
  const generate = vi.fn()
  const { output, request } = await mount(generate)
  await output.synthesize(request, new AbortController().signal)
  expect(generate).not.toHaveBeenCalled()
  expect(generateSpeech).toHaveBeenCalledWith(expect.objectContaining({ input: request.text }))
})

it('sends validated delivery as existing SSML prosody without speaking control tags', async () => {
  applyCompanionPreferences({ ...DEFAULT_COMPANION_PREFERENCES, speech: { ...DEFAULT_COMPANION_PREFERENCES.speech, directorEnabled: true } })
  const generate = vi.fn(async () => '[softly] 今天辛苦了……先歇一会儿。')
  const { output, request } = await mount(generate, true)
  await output.synthesize(request, new AbortController().signal)
  expect(generate).toHaveBeenCalledOnce()
  expect(generateSpeech).toHaveBeenCalledWith(expect.objectContaining({ input: expect.stringContaining('rate="0.95"') }))
  expect(generateSpeech).toHaveBeenCalledWith(expect.objectContaining({ input: expect.stringContaining('今天辛苦了……先歇一会儿。') }))
  expect(vi.mocked(generateSpeech).mock.calls[0][0].input).not.toContain('[softly]')
})

it('cancels synthesis when an enabled speech transform is switched off', async () => {
  applyCompanionPreferences({ ...DEFAULT_COMPANION_PREFERENCES, speech: { ...DEFAULT_COMPANION_PREFERENCES.speech, translationEnabled: true } })
  const pending = Promise.withResolvers<ArrayBuffer>()
  vi.mocked(generateSpeech).mockReturnValueOnce(pending.promise)
  const { output, request } = await mount(async () => 'translated sentence')
  const synthesis = output.synthesize(request, new AbortController().signal)
  const assertion = expect(synthesis).rejects.toMatchObject({ name: 'AbortError' })
  await expect.poll(() => generateSpeech).toHaveBeenCalledOnce()
  applyCompanionPreferences(DEFAULT_COMPANION_PREFERENCES)
  expect(vi.mocked(generateSpeech).mock.calls[0][0].abortSignal?.aborted).toBe(true)
  pending.resolve(new ArrayBuffer(8))
  await assertion
})

it('retains explicit zero-valued provider prosody instead of replacing it with delivery defaults', async () => {
  applyCompanionPreferences({ ...DEFAULT_COMPANION_PREFERENCES, speech: { ...DEFAULT_COMPANION_PREFERENCES.speech, directorEnabled: true } })
  const { output, request } = await mount(async () => '[softly] 今天辛苦了，先歇一会儿。', true, { speed: 0, volume: 0 })
  await output.synthesize(request, new AbortController().signal)
  expect(generateSpeech).toHaveBeenCalledWith(expect.objectContaining({ input: expect.stringContaining('rate="0"') }))
  expect(generateSpeech).toHaveBeenCalledWith(expect.objectContaining({ input: expect.stringContaining('volume="0%"') }))
})

it('stops oversized model output and still sends the original sentence to TTS', async () => {
  applyCompanionPreferences({ ...DEFAULT_COMPANION_PREFERENCES, speech: { ...DEFAULT_COMPANION_PREFERENCES.speech, translationEnabled: true } })
  const { output, request } = await mount(async () => 'x'.repeat(4001))
  await output.synthesize(request, new AbortController().signal)
  expect(generateSpeech).toHaveBeenCalledWith(expect.objectContaining({ input: request.text }))
})

it('applies the same SSML support to a custom Microsoft provider instance', async () => {
  applyCompanionPreferences({ ...DEFAULT_COMPANION_PREFERENCES, speech: { ...DEFAULT_COMPANION_PREFERENCES.speech, directorEnabled: true } })
  const { output, request } = await mount(async () => '[softly] 今天辛苦了，先歇一会儿。', 'custom-microsoft')
  await output.synthesize(request, new AbortController().signal)
  expect(generateSpeech).toHaveBeenCalledWith(expect.objectContaining({ input: expect.stringContaining('rate="0.95"') }))
})

it('keeps an aliased bidirectional provider on its existing stream without starting a transform', async () => {
  applyCompanionPreferences({ ...DEFAULT_COMPANION_PREFERENCES, speech: { ...DEFAULT_COMPANION_PREFERENCES.speech, translationEnabled: true, directorEnabled: true } })
  const generate = vi.fn()
  const { pinia, speech, audio, playback } = await mount(generate)
  await useProviderConfigStore(pinia).ensureProvider('custom-stream', 'official-provider-speech-streaming', {})
  const output = speech.createOutput({ sessionId: 'synthetic-session', turnId: 'stream-turn' }, { provider: 'custom-stream', model: 'fixture/seed-tts-2.0', voice_id: 'voice' }, { playback }, audio)
  expect(output).toHaveProperty('stream')
  expect(output).not.toHaveProperty('synthesize')
  expect(getCompanionSpeechStatus()).toEqual({ translation: 'unsupported-stream', director: 'unsupported-stream' })
  expect(generate).not.toHaveBeenCalled()
  expect(generateSpeech).not.toHaveBeenCalled()
})
