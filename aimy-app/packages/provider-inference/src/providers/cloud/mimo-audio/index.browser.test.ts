import type { TranscriptionProvider } from '@xsai-ext/providers/utils'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { providerMimoAudioTranscription } from '.'

afterEach(() => vi.unstubAllGlobals())

describe('miMo speech recognition', () => {
  it('uses the current ASR model and sends audio without a text prompt', async () => {
    const network = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ message: { content: '语音连接测试。' } }] }))
    vi.stubGlobal('fetch', network)
    const provider = await providerMimoAudioTranscription.createProvider({ apiKey: 'synthetic-key' }) as TranscriptionProvider
    const request = provider.transcription('')
    const body = new FormData()
    body.set('file', new File(['synthetic-audio'], 'test.wav', { type: 'audio/wav' }))
    const controller = new AbortController()

    const response = await request.fetch!(new URL('audio/transcriptions', request.baseURL), { body, signal: controller.signal })

    expect(request.model).toBe('mimo-v2.5-asr')
    expect(network).toHaveBeenCalledOnce()
    const [url, init] = network.mock.calls[0]
    expect(String(url)).toBe('https://api.xiaomimimo.com/v1/chat/completions')
    expect(init?.signal).toBe(controller.signal)
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'mimo-v2.5-asr',
      messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: 'c3ludGhldGljLWF1ZGlv', format: 'wav' } }] }],
    })
    expect(await response.json()).toEqual({ text: '语音连接测试。' })
    expect((await providerMimoAudioTranscription.extraMethods!.listModels!({ apiKey: 'synthetic-key' }, provider)).map(model => model.id)).toEqual(['mimo-v2.5-asr'])
  })

  it('rejects unsupported audio before sending a cloud request', async () => {
    const network = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', network)
    const provider = await providerMimoAudioTranscription.createProvider({ apiKey: 'synthetic-key' }) as TranscriptionProvider
    const request = provider.transcription('mimo-v2.5-asr')
    const body = new FormData()
    body.set('file', new File(['audio'], 'test.webm', { type: 'audio/webm' }))
    await expect(request.fetch!(new URL('https://example.invalid'), { body })).rejects.toThrow('WAV or MP3')
    expect(network).not.toHaveBeenCalled()
  })

  it('reports malformed responses instead of treating them as successful silence', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [] })))
    const provider = await providerMimoAudioTranscription.createProvider({ apiKey: 'synthetic-key' }) as TranscriptionProvider
    const request = provider.transcription('mimo-v2.5-asr')
    const body = new FormData()
    body.set('file', new File(['audio'], 'test.wav', { type: 'audio/wav' }))
    await expect(request.fetch!(new URL('https://example.invalid'), { body })).rejects.toThrow('missing transcription text')
  })
})
