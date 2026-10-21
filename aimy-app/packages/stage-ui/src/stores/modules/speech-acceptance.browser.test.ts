import type { TtsRequest } from '@proj-airi/pipelines-audio'
import type { SpeechProviderWithExtraOptions } from '@xsai-ext/providers/utils'

import type { AcceptanceBudgetPort } from '../memory/budget'

import en from '@proj-airi/i18n/locales/en'

import { VoiceController } from '@proj-airi/core-agent'
import { Playback } from '@proj-airi/pipelines-audio'
import { generateSpeech } from '@xsai/generate-speech'
import { createPinia, disposePinia } from 'pinia'
import { expect, it, vi } from 'vitest'
import { createApp, defineComponent } from 'vue'
import { createI18n } from 'vue-i18n'

import { createStreamingTtsPipeline, streamSpeech } from '../../libs/speech/streaming-pipeline'
import { configureAcceptanceBudget } from '../memory/budget'
import { useProviderStore } from '../providers/provider'
import { useSpeechStore } from './speech'

vi.mock('@xsai/generate-speech', () => ({ generateSpeech: vi.fn(async () => new ArrayBuffer(8)) }))

it('blocks manual, deferred, automatic, and streaming TTS while preserving a text-only response', async () => {
  const pinia = createPinia()
  let speech!: ReturnType<typeof useSpeechStore>
  let providers!: ReturnType<typeof useProviderStore>
  const app = createApp(defineComponent({ setup() {
    speech = useSpeechStore()
    providers = useProviderStore()
    return () => null
  } }))
  app.use(pinia).use(createI18n({ legacy: false, locale: 'en', messages: { en } }))
  const element = document.createElement('div')
  document.body.append(element)
  app.mount(element)
  const context = new AudioContext()
  const provider: SpeechProviderWithExtraOptions<string, Record<string, unknown>> = {
    speech: vi.fn(model => ({ baseURL: 'https://synthetic.invalid/', model, apiKey: 'synthetic-only' })),
  }
  const playbackDriver = vi.fn(() => ({ done: Promise.resolve({ throughMs: 0 }), stop: async () => ({ throughMs: 0 }) }))
  const playback = new Playback({ nowMs: () => 0, play: playbackDriver })
  const selection = { provider: 'synthetic-speech', model: 'synthetic', voice_id: 'synthetic' }
  try {
    await expect(speech.speech(provider, 'synthetic', 'ordinary preview', 'synthetic')).resolves.toHaveProperty('byteLength', 8)
    expect(provider.speech).toHaveBeenCalledOnce()
    expect(generateSpeech).toHaveBeenCalledOnce()
    vi.mocked(provider.speech).mockClear()
    vi.mocked(generateSpeech).mockClear()

    const pending = Promise.withResolvers<SpeechProviderWithExtraOptions<string, Record<string, unknown>>>()
    const getProvider = vi.spyOn(providers, 'getProviderInstance').mockReturnValueOnce(pending.promise)
    const captured = speech.createOutput({ sessionId: 'synthetic', turnId: 'pending' }, selection, { playback }, context)
    if (!('synthesize' in captured))
      throw new Error('Expected generated speech output')
    const request: TtsRequest = { streamId: 'synthetic', intentId: 'synthetic', segmentId: 'synthetic', sequence: 0, text: 'deferred', special: null, reason: 'flush', priority: 0, createdAt: 0 }
    const synthesis = captured.synthesize(request, new AbortController().signal)
    const budget: AcceptanceBudgetPort = { reserve: vi.fn(), started: vi.fn(), releaseNotSent: vi.fn(), settle: vi.fn(), status: vi.fn() }
    configureAcceptanceBudget(budget)
    pending.resolve(provider)
    await expect(synthesis).resolves.toBeNull()
    getProvider.mockClear()
    await expect(speech.speech(provider, 'synthetic', 'blocked preview', 'synthetic')).rejects.toMatchObject({ code: 'paid-validation-disabled' })

    const controller = new VoiceController({ speech: turn => speech.createOutput(turn, { ...selection, model: '', voice_id: '' }, { playback }, context) })
    const response = controller.openResponse({ sessionId: 'synthetic', turnId: 'text-only' })
    const output = response.openSpeech({ purpose: 'answer' })
    await output.write('A normal text answer can finish without audio.')
    output.end()
    await expect(output.done).resolves.toMatchObject({ status: 'finished' })
    await response.finish()
    await controller.close()
    expect(getProvider).not.toHaveBeenCalled()
    expect(provider.speech).not.toHaveBeenCalled()
    expect(generateSpeech).not.toHaveBeenCalled()
    expect(playbackDriver).not.toHaveBeenCalled()

    const done = vi.fn()
    const handle = createStreamingTtsPipeline({ audioContext: context, model: 'synthetic', voice: 'synthetic', token: 'synthetic', serverUrl: 'http://127.0.0.1:1', onDone: done })
    handle.appendText('No websocket session is started')
    handle.finish()
    await Promise.resolve()
    expect(done).toHaveBeenCalledOnce()
    let textController!: ReadableStreamDefaultController<string>
    const text = new ReadableStream<string>({ start(value) {
      textController = value
    } })
    const audio = streamSpeech({ audioContext: context, model: 'synthetic', voice: 'synthetic' }, text, new AbortController().signal)
    const finished = vi.fn()
    const read = audio.getReader().read().then((result) => {
      finished()
      return result
    })
    textController.enqueue('Keep consuming the ordinary text stream')
    await Promise.resolve()
    expect(finished).not.toHaveBeenCalled()
    textController.close()
    await expect(read).resolves.toEqual({ done: true, value: undefined })
    expect(budget.reserve).not.toHaveBeenCalled()
  }
  finally {
    await context.close()
    app.unmount()
    disposePinia(pinia)
    element.remove()
    vi.restoreAllMocks()
  }
})
