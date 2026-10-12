import type { PreTrainedModel } from '@huggingface/transformers'

import { AutoModel } from '@huggingface/transformers'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { VAD } from './vad'

vi.mock('@huggingface/transformers', async (original) => ({
  ...await original<typeof import('@huggingface/transformers')>(),
  AutoModel: { from_pretrained: vi.fn() },
}))

function model(infer: (state: unknown) => Promise<{ stateN: unknown, output: { data: Float32Array } }>) {
  return Object.assign(vi.fn((input: { state: unknown }) => infer(input.state)), { dispose: vi.fn(async () => {}) }) as unknown as PreTrainedModel
}

describe('Aimy VAD privacy and barge-in', () => {
  beforeEach(() => { vi.mocked(AutoModel.from_pretrained).mockReset() })

  it('confirms once after 250 ms of sustained speech, never on the first frame', async () => {
    vi.mocked(AutoModel.from_pretrained).mockResolvedValue(model(async state => ({ stateN: state, output: { data: new Float32Array([0.95]) } })))
    const detector = new VAD()
    const confirmed = vi.fn()
    detector.on('speech-confirmed', confirmed)
    await detector.initialize()
    for (let index = 0; index < 7; index++)
      await detector.processAudio(new Float32Array(512))
    expect(confirmed).not.toHaveBeenCalled()
    for (let index = 0; index < 8; index++)
      await detector.processAudio(new Float32Array(512))
    expect(confirmed).toHaveBeenCalledOnce()
    await detector.dispose()
  })

  it('bounds the product instance queue at eight frames and reports overflow', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const inference = model(async state => { await gate; return { stateN: state, output: { data: new Float32Array([0]) } } })
    vi.mocked(AutoModel.from_pretrained).mockResolvedValue(inference)
    const detector = new VAD({ maxPendingFrames: 8 })
    const status = vi.fn()
    detector.on('status', status)
    await detector.initialize()
    const pending = Array.from({ length: 20 }, () => detector.processAudio(new Float32Array(512)))
    expect(status).toHaveBeenCalledWith({ type: 'error', message: 'VAD input queue is overloaded.' })
    release()
    await Promise.all(pending)
    expect(inference).toHaveBeenCalledTimes(8)
    await detector.dispose()
  })

  it('disposes a model that finishes loading after capture was revoked', async () => {
    let release!: (value: PreTrainedModel) => void
    vi.mocked(AutoModel.from_pretrained).mockReturnValue(new Promise(resolve => { release = resolve }))
    const inference = model(async state => ({ stateN: state, output: { data: new Float32Array([0.9]) } }))
    const detector = new VAD()
    const initializing = detector.initialize()
    await detector.dispose()
    release(inference)
    await initializing
    expect(inference.dispose).toHaveBeenCalledOnce()
  })
})
