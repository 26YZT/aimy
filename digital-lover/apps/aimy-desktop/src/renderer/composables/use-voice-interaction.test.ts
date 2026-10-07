import type { AimyBridge, MediaState } from '../../shared/contracts'
import type { useLocalConversation } from './use-local-conversation'

import { effectScope } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useVoiceInteraction } from './use-voice-interaction'
import { wav } from './wav-fixture'

const fake = vi.hoisted(() => ({ listeners: {} as Record<string, (payload?: any) => void>, dispose: vi.fn(async () => {}), graphDispose: vi.fn() }))
vi.mock('../airi-voice/workers/vad/vad', () => ({ VAD: class {
  on(event: string, listener: (payload?: any) => void) { fake.listeners[event] = listener }
  async initialize() {}
  dispose = fake.dispose
} }))
vi.mock('../airi-voice/libs/audio/vad', () => ({ createVADStates: () => ({ initialize: async () => {}, start: async () => {}, dispose: fake.graphDispose }) }))

function harness(getUserMedia: () => Promise<MediaStream>, getInitialState?: () => Promise<MediaState>) {
  const scope = effectScope()
  let state: MediaState = { revision: 0, mic: { enabled: false }, screen: { enabled: false }, speech: { enabled: false } }
  let changed: (value: MediaState) => void = () => {}
  const send = vi.fn(async () => true)
  const cancel = vi.fn(async () => {})
  const transcribe = vi.fn(async (input: { requestId: string }) => ({ requestId: input.requestId, status: 'complete', text: '今天很好', receiptId: 'receipt-one' }))
  const encodedAudio = btoa(String.fromCharCode(...wav(0.1)))
  const bridge = {
    getMediaState: getInitialState || (async () => state),
    onMediaState: (listener: typeof changed) => { changed = listener; return () => {} },
    setMediaState: vi.fn(async (input: { kind: 'mic' | 'screen' | 'speech', enabled: boolean }) => {
      state = { ...state, revision: state.revision + 1, [input.kind]: { enabled: input.enabled, token: input.enabled ? 'grant-one' : undefined } }
      changed(state)
      return { ok: true, state }
    }),
    cancelMedia: vi.fn(async () => {}), cancel: vi.fn(async () => {}), transcribe,
    synthesize: vi.fn(async () => ({ status: 'complete', audioBase64: encodedAudio })),
  } as unknown as AimyBridge
  let turns: any
  const conversation = { onTurn: (handlers: any) => { turns = handlers; return () => {} }, waitForSend: async () => true, send, cancel } as unknown as ReturnType<typeof useLocalConversation>
  const startAudio = vi.fn()
  const stopAudio = vi.fn()
  const createdContexts = { count: 0 }
  const decode = vi.fn(async (input: ArrayBuffer) => {
    structuredClone(input, { transfer: [input] })
    expect(input.byteLength).toBe(0)
    return { length: 4800, numberOfChannels: 1, duration: 0.1 } as AudioBuffer
  })
  vi.stubGlobal('AudioContext', class {
    constructor() { createdContexts.count++ }
    state = 'running'
    sampleRate = 48000
    destination = {}
    decodeAudioData = decode
    async resume() {}
    async close() { this.state = 'closed' }
    createBufferSource() { return { connect() {}, disconnect() {}, start: startAudio, stop: stopAudio, onended: undefined, buffer: undefined } }
  })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  const voice = scope.run(() => useVoiceInteraction(bridge, conversation))!
  return { voice, bridge, scope, send, cancel, transcribe, startAudio, stopAudio, decode, createdContexts, turns: () => turns, changed: (next: MediaState) => changed(next) }
}

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); fake.listeners = {} })

describe('voice capture lifecycle', () => {
  it('does not let a late speech-on snapshot stop a newer live microphone', async () => {
    const stop = vi.fn()
    const test = harness(async () => ({ getTracks: () => [{ stop }] }) as unknown as MediaStream)
    const first: MediaState = { revision: 1, mic: { enabled: false }, screen: { enabled: false }, speech: { enabled: true, token: 'speech' } }
    const latest: MediaState = { ...first, revision: 2, mic: { enabled: true, token: 'microphone' } }
    let release!: (reply: any) => void
    vi.mocked(test.bridge.setMediaState).mockImplementation(async (input) => {
      if (input.kind === 'speech') {
        test.changed(first)
        return new Promise(resolve => { release = resolve })
      }
      test.changed(latest)
      return { ok: true, state: latest }
    })
    await Promise.resolve()
    const speech = test.voice.toggleSpeech(true)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    await test.voice.toggleMic(true)
    release({ ok: true, state: first })
    await speech
    expect(test.voice.state.value.revision).toBe(2)
    expect(test.voice.state.value.mic.enabled).toBe(true)
    expect(test.voice.listening.value).toBe(true)
    expect(stop).not.toHaveBeenCalled()
    test.scope.stop()
  })

  it('starts an acknowledged mic token when only another channel changed at a newer revision', async () => {
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop() {} }] }) as unknown as MediaStream)
    const test = harness(getUserMedia)
    const granted: MediaState = { revision: 1, mic: { enabled: true, token: 'microphone' }, screen: { enabled: false }, speech: { enabled: false } }
    let release!: (reply: any) => void
    vi.mocked(test.bridge.setMediaState).mockImplementation(() => new Promise(resolve => { release = resolve; test.changed(granted) }))
    await Promise.resolve()
    const starting = test.voice.toggleMic(true)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    test.changed({ ...granted, revision: 2, speech: { enabled: true, token: 'speech' } })
    release({ ok: true, state: granted })
    await starting
    expect(getUserMedia).toHaveBeenCalledOnce()
    expect(test.voice.listening.value).toBe(true)
    expect(test.voice.state.value.revision).toBe(2)
    test.scope.stop()
  })

  it('rejects stale mic and speech enable replies after newer revocations without opening devices', async () => {
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [] }) as unknown as MediaStream)
    const test = harness(getUserMedia)
    let release!: (reply: any) => void
    let revision = 0
    vi.mocked(test.bridge.setMediaState).mockImplementation((input) => new Promise(resolve => {
      revision++
      const granted: MediaState = { revision, mic: { enabled: false }, screen: { enabled: false }, speech: { enabled: false }, [input.kind]: { enabled: true, token: 'stale-token' } }
      test.changed(granted)
      revision++
      test.changed({ ...granted, revision, [input.kind]: { enabled: false } })
      release = () => resolve({ ok: true, state: granted })
    }))
    await Promise.resolve()
    const mic = test.voice.toggleMic(true)
    release({})
    await mic
    const speech = test.voice.toggleSpeech(true)
    release({})
    await speech
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(test.createdContexts.count).toBe(0)
    expect(test.voice.state.value.mic.enabled).toBe(false)
    expect(test.voice.state.value.speech.enabled).toBe(false)
    test.scope.stop()
  })

  it('ignores late initial get and out-of-order change events after a microphone grant', async () => {
    let releaseInitial!: (state: MediaState) => void
    const stop = vi.fn()
    const test = harness(async () => ({ getTracks: () => [{ stop }] }) as unknown as MediaStream, () => new Promise(resolve => { releaseInitial = resolve }))
    await test.voice.toggleMic(true)
    const current = JSON.parse(JSON.stringify(test.voice.state.value)) as MediaState
    const initial: MediaState = { revision: 0, mic: { enabled: false }, screen: { enabled: false }, speech: { enabled: false } }
    releaseInitial(initial)
    await Promise.resolve()
    test.changed(initial)
    test.changed(current)
    expect(test.voice.state.value.revision).toBe(current.revision)
    expect(test.voice.listening.value).toBe(true)
    expect(stop).not.toHaveBeenCalled()
    test.scope.stop()
  })

  it('keeps disableAll at the latest revision when its three replies finish out of order', async () => {
    const test = harness(async () => ({ getTracks: () => [{ stop() {} }] }) as unknown as MediaStream)
    await Promise.resolve()
    await test.voice.toggleMic(true)
    await test.voice.toggleSpeech(true)
    let authority = JSON.parse(JSON.stringify(test.voice.state.value)) as MediaState
    const replies: Array<() => void> = []
    vi.mocked(test.bridge.setMediaState).mockImplementation(input => new Promise(resolve => {
      authority = { ...authority, revision: authority.revision + 1, [input.kind]: { enabled: false } }
      const snapshot = authority
      test.changed(snapshot)
      replies.push(() => resolve({ ok: true, state: snapshot }))
    }))
    const disabling = test.voice.disableAll()
    expect(replies).toHaveLength(3)
    replies[2]()
    replies[0]()
    replies[1]()
    await disabling
    expect(test.voice.state.value.revision).toBe(authority.revision)
    expect(test.voice.state.value.mic.enabled).toBe(false)
    expect(test.voice.state.value.speech.enabled).toBe(false)
    test.scope.stop()
  })
  it('keeps native decode concurrency at two through several cancelled turns', async () => {
    const test = harness(async () => ({ getTracks: () => [] }) as unknown as MediaStream)
    const releases: Array<(audio: AudioBuffer) => void> = []
    let active = 0
    let maximum = 0
    test.decode.mockImplementation(async (input) => {
      structuredClone(input, { transfer: [input] })
      active++
      maximum = Math.max(maximum, active)
      try { return await new Promise<AudioBuffer>((resolve) => { releases.push(resolve) }) }
      finally { active-- }
    })
    await Promise.resolve()
    await test.voice.toggleSpeech(true)
    for (let turn = 0; turn < 2; turn++) {
      test.turns().start(`slow-${turn}`)
      test.turns().end(`slow-${turn}`, '你好。', true)
      await vi.waitFor(() => expect(releases).toHaveLength(turn + 1))
    }
    for (let turn = 2; turn < 5; turn++) {
      test.turns().start(`slow-${turn}`)
      test.turns().end(`slow-${turn}`, '你好。', true)
      await vi.waitFor(() => expect(test.bridge.synthesize).toHaveBeenCalledTimes(turn + 1))
      await vi.waitFor(() => expect(test.voice.error.value).toContain('已停止朗读'))
      expect(test.decode).toHaveBeenCalledTimes(2)
      expect(active).toBe(2)
    }
    const audio = () => ({ length: 4800, numberOfChannels: 1, duration: 0.1 }) as AudioBuffer
    releases[0](audio())
    await vi.waitFor(() => expect(active).toBe(1))
    test.turns().start('after-old-decode')
    test.turns().end('after-old-decode', '你好。', true)
    await vi.waitFor(() => expect(releases).toHaveLength(3))
    expect(active).toBe(2)
    releases[2](audio())
    await vi.waitFor(() => expect(test.startAudio).toHaveBeenCalledOnce())
    releases[1](audio())
    await vi.waitFor(() => expect(active).toBe(0))
    expect(test.startAudio).toHaveBeenCalledOnce()
    expect(maximum).toBe(2)
    test.scope.stop()
  })

  it('stops only readout when fast large WAV replies exceed a slow playback queue and accepts the next turn', async () => {
    const test = harness(async () => ({ getTracks: () => [] }) as unknown as MediaStream)
    const large = wav(4, 8)
    let binary = ''
    for (let offset = 0; offset < large.length; offset += 0x8000)
      binary += String.fromCharCode(...large.subarray(offset, offset + 0x8000))
    vi.mocked(test.bridge.synthesize).mockResolvedValue({ requestId: '', status: 'complete', audioBase64: btoa(binary) })
    test.decode.mockImplementation(async (input) => {
      structuredClone(input, { transfer: [input] })
      return { length: 192000, numberOfChannels: 8, duration: 4 } as AudioBuffer
    })
    await Promise.resolve()
    await test.voice.toggleSpeech(true)
    test.turns().start('large-turn')
    test.turns().end('large-turn', '你好世界。'.repeat(15), true)
    await vi.waitFor(() => expect(test.voice.error.value).toContain('已停止朗读'))
    expect(test.decode.mock.calls.length).toBeLessThanOrEqual(4)
    expect(test.startAudio.mock.calls.length).toBeLessThanOrEqual(1)
    expect(test.voice.speaking.value).toBe(false)
    expect(test.cancel).not.toHaveBeenCalled()
    const small = btoa(String.fromCharCode(...wav(0.1)))
    vi.mocked(test.bridge.synthesize).mockResolvedValue({ requestId: '', status: 'complete', audioBase64: small })
    test.decode.mockImplementation(async (input) => {
      structuredClone(input, { transfer: [input] })
      return { length: 4800, numberOfChannels: 1, duration: 0.1 } as AudioBuffer
    })
    const starts = test.startAudio.mock.calls.length
    test.turns().start('after-budget-turn')
    test.turns().end('after-budget-turn', '新的回复。', true)
    await vi.waitFor(() => expect(test.startAudio.mock.calls.length).toBe(starts + 1))
    test.scope.stop()
  })

  it('plays successful decoding even when decodeAudioData transfers and detaches its input', async () => {
    const test = harness(async () => ({ getTracks: () => [] }) as unknown as MediaStream)
    await Promise.resolve()
    await test.voice.toggleSpeech(true)
    test.turns().start('detach-turn')
    test.turns().end('detach-turn', '你好。', true)
    await vi.waitFor(() => expect(test.startAudio).toHaveBeenCalledOnce())
    expect(test.decode).toHaveBeenCalledOnce()
    expect(test.voice.error.value).toBe('')
    test.scope.stop()
  })

  it('drops cancelled decoding and permits audio from the newer turn', async () => {
    const test = harness(async () => ({ getTracks: () => [] }) as unknown as MediaStream)
    let release!: (audio: AudioBuffer) => void
    test.decode.mockImplementationOnce((input) => {
      structuredClone(input, { transfer: [input] })
      return new Promise(resolve => { release = resolve })
    })
    await Promise.resolve()
    await test.voice.toggleSpeech(true)
    test.turns().start('old-turn')
    test.turns().end('old-turn', '旧的回复。', true)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    test.voice.stopOutput()
    test.turns().start('new-turn')
    test.turns().end('new-turn', '新的回复。', true)
    await vi.waitFor(() => expect(test.startAudio).toHaveBeenCalledOnce())
    release({ length: 4800, numberOfChannels: 1, duration: 0.1 } as AudioBuffer)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(test.startAudio).toHaveBeenCalledOnce()
    test.scope.stop()
  })
  it('stops tracks synchronously before asynchronous suspend cleanup', async () => {
    const stop = vi.fn()
    const test = harness(async () => ({ getTracks: () => [{ stop }] }) as unknown as MediaStream)
    await Promise.resolve()
    await test.voice.toggleMic(true)
    expect(test.voice.listening.value).toBe(true)
    const suspending = test.voice.suspend()
    expect(stop).toHaveBeenCalledOnce()
    expect(test.voice.listening.value).toBe(false)
    expect(await suspending).toBe(true)
    test.scope.stop()
  })

  it('drops a late microphone acquisition after the grant is closed', async () => {
    let release!: (value: MediaStream) => void
    const stop = vi.fn()
    const test = harness(() => new Promise(resolve => { release = resolve }))
    await Promise.resolve()
    const starting = test.voice.toggleMic(true)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    await test.voice.toggleMic(false)
    release({ getTracks: () => [{ stop }] } as unknown as MediaStream)
    await starting
    expect(stop).toHaveBeenCalledOnce()
    expect(test.voice.listening.value).toBe(false)
    test.scope.stop()
  })

  it('forwards an ASR receipt and stops the old turn on confirmed speech', async () => {
    const test = harness(async () => ({ getTracks: () => [{ stop() {} }] }) as unknown as MediaStream)
    await Promise.resolve()
    await test.voice.toggleMic(true)
    fake.listeners['speech-confirmed']()
    expect(test.cancel).toHaveBeenCalledOnce()
    expect(test.bridge.cancel).toHaveBeenCalledOnce()
    fake.listeners['speech-ready']({ buffer: new Float32Array(1600) })
    await vi.waitFor(() => expect(test.send).toHaveBeenCalledWith('今天很好', undefined, undefined, { source: 'voice', captureToken: 'grant-one', receiptId: 'receipt-one' }))
    expect(test.transcribe.mock.calls[0][0]).toHaveProperty('audioBase64')
    test.scope.stop()
  })

  it('drops an old ASR result after a newer confirmed utterance and keeps current ASR busy', async () => {
    const test = harness(async () => ({ getTracks: () => [{ stop() {} }] }) as unknown as MediaStream)
    let oldResult!: (value: any) => void
    let newResult!: (value: any) => void
    test.transcribe.mockImplementationOnce(() => new Promise(resolve => { oldResult = resolve }))
    test.transcribe.mockImplementationOnce(() => new Promise(resolve => { newResult = resolve }))
    expect(test.voice.transcribing.value).toBe(false)
    await Promise.resolve()
    await test.voice.toggleMic(true)
    fake.listeners['speech-confirmed']()
    fake.listeners['speech-ready']({ buffer: new Float32Array(1600) })
    await vi.waitFor(() => expect(oldResult).toBeTypeOf('function'))
    expect(test.voice.transcribing.value).toBe(true)
    fake.listeners['speech-confirmed']()
    fake.listeners['speech-ready']({ buffer: new Float32Array(1600) })
    await vi.waitFor(() => expect(newResult).toBeTypeOf('function'))
    oldResult({ status: 'complete', text: '旧的语音', receiptId: 'old-receipt' })
    await Promise.resolve()
    expect(test.send).not.toHaveBeenCalled()
    expect(test.voice.transcribing.value).toBe(true)
    newResult({ status: 'complete', text: '新的语音', receiptId: 'new-receipt' })
    await vi.waitFor(() => expect(test.send).toHaveBeenCalledWith('新的语音', undefined, undefined, { source: 'voice', captureToken: 'grant-one', receiptId: 'new-receipt' }))
    expect(test.bridge.cancelMedia).toHaveBeenCalled()
    test.scope.stop()
  })
})
