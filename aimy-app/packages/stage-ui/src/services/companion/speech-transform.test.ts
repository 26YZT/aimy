import type { SpeechTextGenerator } from './speech-transform'

import { afterEach, expect, it, vi } from 'vitest'

import { DEFAULT_COMPANION_PREFERENCES } from '../../types/companion'
import { applyCompanionPreferences } from './preferences'
import { getCompanionSpeechStatus, reportCompanionStreamingSupport, transformCompanionSpeech, validateDirectedSpeech } from './speech-transform'

afterEach(() => applyCompanionPreferences(DEFAULT_COMPANION_PREFERENCES))

function enable(speech: Partial<typeof DEFAULT_COMPANION_PREFERENCES.speech>) {
  applyCompanionPreferences({ ...DEFAULT_COMPANION_PREFERENCES, speech: { ...DEFAULT_COMPANION_PREFERENCES.speech, ...speech } })
}

it('keeps the original text without extra model calls when disabled', async () => {
  const generate = vi.fn()
  await expect(transformCompanionSpeech({ text: '今天辛苦了。', generate, signal: new AbortController().signal, supportsDirectedProsody: true })).resolves.toEqual({ text: '今天辛苦了。' })
  expect(generate).not.toHaveBeenCalled()
})

it('translates only the returned speech value and sends data separately from instructions', async () => {
  enable({ translationEnabled: true, targetLanguage: 'ja' })
  const generate = vi.fn(async () => 'お疲れ様です。')
  const original = '今天辛苦了。'
  await expect(transformCompanionSpeech({ text: original, generate, signal: new AbortController().signal, supportsDirectedProsody: false })).resolves.toEqual({ text: 'お疲れ様です。' })
  expect(original).toBe('今天辛苦了。')
  expect(generate).toHaveBeenCalledWith(expect.stringContaining('language ja'), JSON.stringify({ text: original }), expect.any(AbortSignal))
  expect(getCompanionSpeechStatus().translation).toBe('ready')
})

it('retains original speech after a network failure without retrying', async () => {
  enable({ translationEnabled: true })
  const generate = vi.fn(async () => {
    throw new Error('fixture provider failure')
  })
  await expect(transformCompanionSpeech({ text: '原文', generate, signal: new AbortController().signal, supportsDirectedProsody: false })).resolves.toEqual({ text: '原文' })
  expect(generate).toHaveBeenCalledOnce()
  expect(getCompanionSpeechStatus().translation).toBe('failed')
})

it('rejects late translation when preferences change', async () => {
  enable({ translationEnabled: true })
  const pending = Promise.withResolvers<string>()
  const generate = vi.fn<SpeechTextGenerator>(() => pending.promise)
  const result = transformCompanionSpeech({ text: '原文', generate, signal: new AbortController().signal, supportsDirectedProsody: false })
  const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' })
  enable({ translationEnabled: false })
  pending.resolve('late')
  await assertion
  expect(generate.mock.calls[0][2].aborted).toBe(true)
})

it('rejects canceled translation instead of falling back and speaking after interruption', async () => {
  enable({ translationEnabled: true })
  const controller = new AbortController()
  const pending = Promise.withResolvers<string>()
  const result = transformCompanionSpeech({ text: '原文', generate: () => pending.promise, signal: controller.signal, supportsDirectedProsody: false })
  const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' })
  controller.abort()
  pending.resolve('late')
  await assertion
})

it('rejects empty and oversized translations while preserving the original', async () => {
  enable({ translationEnabled: true })
  for (const result of ['', 'x'.repeat(4001)]) {
    await expect(transformCompanionSpeech({ text: '原文', generate: async () => result, signal: new AbortController().signal, supportsDirectedProsody: false })).resolves.toEqual({ text: '原文' })
  }
})

it('does not request a director when the TTS provider cannot express its result', async () => {
  enable({ directorEnabled: true })
  const generate = vi.fn()
  await expect(transformCompanionSpeech({ text: '原文', generate, signal: new AbortController().signal, supportsDirectedProsody: false })).resolves.toEqual({ text: '原文' })
  expect(generate).not.toHaveBeenCalled()
  expect(getCompanionSpeechStatus().director).toBe('unsupported-provider')
})

it('keeps exact words while removing delivery tags and producing bounded SSML prosody', async () => {
  enable({ directorEnabled: true, style: 'gentle' })
  await expect(transformCompanionSpeech({ text: '今天辛苦了。先歇一会儿。', generate: async () => '[softly] 今天辛苦了……先歇一会儿。', signal: new AbortController().signal, supportsDirectedProsody: true })).resolves.toEqual({ text: '今天辛苦了……先歇一会儿。', prosody: { speed: 0.95, volume: -5 } })
})

it.each(['已经买了围巾。', '[angry]还没买围巾。', '[softly 还没买围巾。', '[softly][unknown]还没买围巾。'])('rejects changed facts or unsupported tags: %s', (candidate) => {
  expect(() => validateDirectedSpeech(candidate, '还没买围巾。', 'gentle')).toThrow('DIRECTED_SPEECH_REJECTED')
})

it('reports unsupported streaming transforms without requesting a model', () => {
  enable({ translationEnabled: true, directorEnabled: true })
  reportCompanionStreamingSupport()
  expect(getCompanionSpeechStatus()).toEqual({ translation: 'unsupported-stream', director: 'unsupported-stream' })
})

it.each([
  ['价格15元。', '价格1.5元。'],
  ['温度5度。', '温度-5度。'],
  ['It is nowhere.', 'It is now here.'],
])('rejects punctuation or spacing changes that alter numbers or word boundaries', (candidate, original) => {
  expect(() => validateDirectedSpeech(candidate, original, 'gentle')).toThrow('DIRECTED_SPEECH_REJECTED')
})

it('falls back to the original sentence after a transform deadline and clears the working status', async () => {
  enable({ translationEnabled: true })
  let deadline: AbortSignal | undefined
  const result = await transformCompanionSpeech({
    text: '原文仍然可以朗读',
    signal: new AbortController().signal,
    supportsDirectedProsody: false,
    generate: async (_instructions, _input, signal) => {
      deadline = signal
      return new Promise<string>(() => {})
    },
  })
  expect(result).toEqual({ text: '原文仍然可以朗读' })
  expect(deadline?.aborted).toBe(true)
  expect(getCompanionSpeechStatus().translation).toBe('failed')
}, 18_000)
