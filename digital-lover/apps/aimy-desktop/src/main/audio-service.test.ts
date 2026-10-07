import type { AudioServiceKind, MediaReply, PrivateAudioSettings } from '../shared/contracts'
import type { OperationLease } from './audio-service'

import { format } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAudioService } from './audio-service'

const asrKey = 'ASR_FAKE_TEST_CREDENTIAL'
const ttsKey = 'TTS_FAKE_TEST_CREDENTIAL'
const privateDetail = 'PRIVATE_AUDIO_PROVIDER_DETAIL'
const utterance = '你好，今天怎么样？'
const speechText = '你好，我是 Aimy。'
const configurations: Record<AudioServiceKind, PrivateAudioSettings> = {
  asr: { apiKey: asrKey, baseUrl: 'https://asr-fixture.invalid/v1/', model: 'asr-model', voice: '' },
  tts: { apiKey: ttsKey, baseUrl: 'https://tts-fixture.invalid/v1/', model: 'tts-model', voice: 'fixture-voice' },
}

function wav(sampleBytes = 4) {
  const bytes = Buffer.alloc(44 + sampleBytes)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(16_000, 24)
  bytes.writeUInt32LE(32_000, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(sampleBytes, 40)
  return bytes
}

function setup() {
  const grants = {
    mic: { enabled: true, token: 'mic-grant', controller: new AbortController() },
    speech: { enabled: true, token: 'speech-grant', controller: new AbortController() },
  }
  const finishes = vi.fn()
  const allowedTurns = new Map([['turn-current', speechText]])
  const getConfiguration = vi.fn((kind: AudioServiceKind) => ({ ...configurations[kind] }))
  const service = createAudioService({
    getConfiguration,
    acquire(kind, token): OperationLease | undefined {
      const grant = grants[kind]
      if (!grant.enabled || grant.token !== token)
        return
      let finished = false
      return {
        signal: grant.controller.signal,
        current: () => !finished && grant.enabled && grant.token === token && !grant.controller.signal.aborted,
        finish: () => { finished = true; finishes(kind) },
      }
    },
    isSpeechTextAllowed: (turnId, text) => allowedTurns.get(turnId) === text,
  })
  return {
    service, getConfiguration, grants, allowedTurns, finishes,
    revoke(kind: 'mic' | 'speech') {
      grants[kind].enabled = false
      grants[kind].controller.abort()
    },
    renew(kind: 'mic' | 'speech') {
      grants[kind] = { enabled: true, token: `${kind}-new-grant`, controller: new AbortController() }
    },
  }
}

function asrRequest(requestId = 'asr-request', token = 'mic-grant', bytes = wav()) {
  return { requestId, token, audioBase64: bytes.toString('base64') }
}

function ttsRequest(requestId = 'tts-request', token = 'speech-grant', text = speechText, turnId = 'turn-current') {
  return { requestId, token, text, turnId }
}

function inspect(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) {
  const url = new URL(String(input))
  const kind: AudioServiceKind = url.pathname.endsWith('/audio/transcriptions') ? 'asr' : 'tts'
  const config = configurations[kind]
  expect(url.hostname).toBe(`${kind}-fixture.invalid`)
  expect(init?.method).toBe('POST')
  expect(init?.redirect).toBe('error')
  expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${config.apiKey}`)
  expect(init?.signal).toBeTruthy()
  if (kind === 'asr') {
    expect(init?.body).toBeInstanceOf(FormData)
    const body = init!.body as FormData
    expect(body.get('model')).toBe('asr-model')
    expect(body.get('response_format')).toBe('json')
    const file = body.get('file') as File
    expect(file.name).toBe('recording.wav')
    expect(file.type).toBe('audio/wav')
    expect(file.size).toBe(48)
  }
  else {
    expect(url.pathname.endsWith('/audio/speech')).toBe(true)
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    expect(body.model).toBe('tts-model')
    expect(body.input).toBe(speechText)
    expect(body.voice).toBe('fixture-voice')
    expect(body.response_format).toBe('wav')
    expect(body.tools).toBeUndefined()
  }
  return { kind, signal: init!.signal! }
}

function successful(kind: AudioServiceKind) {
  return kind === 'asr'
    ? new Response(JSON.stringify({ text: utterance }), { headers: { 'Content-Type': 'application/json' } })
    : new Response(new Uint8Array(wav()), { headers: { 'Content-Type': 'audio/wav' } })
}

function installSuccess() {
  const transport = vi.fn<typeof fetch>(async (input, init) => successful(inspect(input, init).kind))
  vi.stubGlobal('fetch', transport)
  return transport
}

function pendingTransport() {
  let reached!: (signal: AbortSignal) => void
  const requested = new Promise<AbortSignal>((resolve) => { reached = resolve })
  let respond!: (response: Response) => void
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    reached(inspect(input, init).signal)
    // Ignore abort deliberately. The service must settle and gate late SDK work itself.
    return new Promise<Response>((resolve) => { respond = resolve })
  })
  vi.stubGlobal('fetch', transport)
  return { transport, requested, respond: (response: Response) => respond(response) }
}

let diagnostics: ReturnType<typeof vi.spyOn>[]
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  diagnostics = (['log', 'info', 'warn', 'error'] as const).map(level => vi.spyOn(console, level).mockImplementation(() => {}))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function expectSafe(reply: MediaReply) {
  const output = JSON.stringify(reply) + diagnostics.flatMap(spy => spy.mock.calls).map(args => format(...args)).join('\n')
  expect(output).not.toContain(asrKey)
  expect(output).not.toContain(ttsKey)
  expect(output).not.toContain(privateDetail)
  expect(output).not.toMatch(/\n\s+at /)
}

describe('main audio service through actual AIRI and xsAI factories', () => {
  it('uses distinct ASR/TTS endpoints and credentials, with one SDK call per request', async () => {
    const { service, finishes } = setup()
    const transport = installSuccess()
    const transcript = await service.transcribe(asrRequest())
    const speech = await service.synthesize(ttsRequest())
    expect(transcript.status).toBe('complete')
    expect(transcript.text).toBe(utterance)
    expect(transcript.receiptId).toMatch(/^[a-f0-9-]{36}$/)
    expect(speech.status).toBe('complete')
    expect(Buffer.from(speech.audioBase64!, 'base64')).toEqual(wav())
    expect(transport).toHaveBeenCalledTimes(2)
    expect(finishes.mock.calls).toEqual([['mic'], ['speech']])
    expectSafe(transcript)
    expectSafe(speech)
  })

  it('requires the exact receipt, token and transcript and permits consumption only once', async () => {
    const { service } = setup()
    installSuccess()
    const result = await service.transcribe(asrRequest())
    expect(service.consumeTranscript('unknown', 'mic-grant', utterance)).toBe(false)
    expect(service.consumeTranscript(result.receiptId!, 'wrong-grant', utterance)).toBe(false)
    expect(service.consumeTranscript(result.receiptId!, 'mic-grant', 'changed text')).toBe(false)
    expect(service.consumeTranscript(result.receiptId!, 'mic-grant', utterance)).toBe(true)
    expect(service.consumeTranscript(result.receiptId!, 'mic-grant', utterance)).toBe(false)
  })

  it('expires receipts after 30 seconds and bounds the cache to 64 entries', async () => {
    const { service } = setup()
    installSuccess()
    const expired = await service.transcribe(asrRequest('expires'))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(service.consumeTranscript(expired.receiptId!, 'mic-grant', utterance)).toBe(false)
    const receipts: string[] = []
    for (let index = 0; index < 65; index++)
      receipts.push((await service.transcribe(asrRequest(`bounded-${index}`))).receiptId!)
    expect(service.consumeTranscript(receipts[0], 'mic-grant', utterance)).toBe(false)
    expect(service.consumeTranscript(receipts[64], 'mic-grant', utterance)).toBe(true)
  })

  it('rejects a receipt after revoke and re-enable, and clears receipts on cancellation', async () => {
    const rig = setup()
    installSuccess()
    const old = await rig.service.transcribe(asrRequest('old-grant'))
    rig.revoke('mic')
    rig.renew('mic')
    expect(rig.service.consumeTranscript(old.receiptId!, 'mic-grant', utterance)).toBe(false)
    expect(rig.service.consumeTranscript(old.receiptId!, 'mic-new-grant', utterance)).toBe(false)
    const fresh = await rig.service.transcribe(asrRequest('fresh', 'mic-new-grant'))
    rig.service.cancel('fresh')
    expect(rig.service.consumeTranscript(fresh.receiptId!, 'mic-new-grant', utterance)).toBe(false)
    const all = await rig.service.transcribe(asrRequest('all', 'mic-new-grant'))
    rig.service.cancelAll()
    expect(rig.service.consumeTranscript(all.receiptId!, 'mic-new-grant', utterance)).toBe(false)
  })

  it.each<AudioServiceKind>(['asr', 'tts'])('rejects a repeated completed %s request without spending a second request', async (kind) => {
    const { service } = setup()
    const transport = installSuccess()
    const call = () => kind === 'asr' ? service.transcribe(asrRequest()) : service.synthesize(ttsRequest())
    expect((await call()).status).toBe('complete')
    expect((await call()).status).toBe('failed')
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('permits at most two concurrent requests for each capability and rejects an in-flight duplicate', async () => {
    const { service } = setup()
    const signals: AbortSignal[] = []
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      const { signal } = inspect(input, init)
      signals.push(signal)
      return new Promise<Response>(() => {})
    })
    vi.stubGlobal('fetch', transport)
    const pending = [service.transcribe(asrRequest('asr-1')), service.transcribe(asrRequest('asr-2')), service.synthesize(ttsRequest('tts-1')), service.synthesize(ttsRequest('tts-2'))]
    await vi.advanceTimersByTimeAsync(0)
    expect(transport).toHaveBeenCalledTimes(4)
    expect((await service.transcribe(asrRequest('asr-1'))).status).toBe('failed')
    expect((await service.transcribe(asrRequest('asr-3'))).status).toBe('failed')
    expect((await service.synthesize(ttsRequest('tts-3'))).status).toBe('failed')
    expect(transport).toHaveBeenCalledTimes(4)
    service.cancelAll()
    const replies = await Promise.all(pending)
    expect(replies.every(reply => reply.status === 'cancelled')).toBe(true)
    expect(signals.every(signal => signal.aborted)).toBe(true)
  })

  it.each<AudioServiceKind>(['asr', 'tts'])('settles a cancelled %s operation before an abort-ignoring provider and drops its late result', async (kind) => {
    const { service } = setup()
    const remote = pendingTransport()
    const pending = kind === 'asr' ? service.transcribe(asrRequest()) : service.synthesize(ttsRequest())
    const signal = await remote.requested
    service.cancel(`${kind}-request`)
    const result = await pending
    expect(signal.aborted).toBe(true)
    expect(result.status).toBe('cancelled')
    expect(result.text).toBeUndefined()
    expect(result.receiptId).toBeUndefined()
    expect(result.audioBase64).toBeUndefined()
    remote.respond(successful(kind))
    await vi.advanceTimersByTimeAsync(0)
    expectSafe(result)
    expect(remote.transport).toHaveBeenCalledTimes(1)
  })

  it.each<AudioServiceKind>(['asr', 'tts'])('aborts %s at 15 seconds even if the SDK transport does not settle', async (kind) => {
    const { service } = setup()
    const remote = pendingTransport()
    const pending = kind === 'asr' ? service.transcribe(asrRequest()) : service.synthesize(ttsRequest())
    const signal = await remote.requested
    await vi.advanceTimersByTimeAsync(14_999)
    expect(signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const result = await pending
    expect(signal.aborted).toBe(true)
    expect(result.status).toBe('failed')
    expect(result.message).toBe('语音服务响应超时，请稍后重试。')
    expect(remote.transport).toHaveBeenCalledTimes(1)
    expectSafe(result)
  })

  it('drops a completed TTS result if its original LLM turn is no longer allowed', async () => {
    const { service, allowedTurns } = setup()
    const remote = pendingTransport()
    const pending = service.synthesize(ttsRequest())
    await remote.requested
    allowedTurns.clear()
    remote.respond(successful('tts'))
    const result = await pending
    expect(result.status).toBe('cancelled')
    expect(result.audioBase64).toBeUndefined()
    expectSafe(result)
  })

  it('refuses unapproved speech text and stale capture tokens before configuration or network use', async () => {
    const rig = setup()
    const transport = installSuccess()
    expect((await rig.service.synthesize(ttsRequest('wrong-text', 'speech-grant', 'not an LLM reply'))).status).toBe('cancelled')
    rig.getConfiguration.mockClear()
    expect((await rig.service.transcribe(asrRequest('wrong-token', 'wrong-grant'))).status).toBe('cancelled')
    expect(rig.getConfiguration).not.toHaveBeenCalled()
    expect(transport).not.toHaveBeenCalled()
  })

  it.each<AudioServiceKind>(['asr', 'tts'])('cancels %s publication when the grant is revoked during the request', async (kind) => {
    const rig = setup()
    const remote = pendingTransport()
    const pending = kind === 'asr' ? rig.service.transcribe(asrRequest()) : rig.service.synthesize(ttsRequest())
    const signal = await remote.requested
    rig.revoke(kind === 'asr' ? 'mic' : 'speech')
    const result = await pending
    expect(signal.aborted).toBe(true)
    expect(result.status).toBe('cancelled')
    remote.respond(successful(kind))
    await vi.advanceTimersByTimeAsync(0)
    expectSafe(result)
  })

  it.each([
    ['asr', 200, 64 * 1024],
    ['tts', 200, 6 * 1024 * 1024],
    ['tts', 500, 64 * 1024],
  ] as const)('bounds %s HTTP %s response bytes without trusting Content-Length', async (kind, status, limit) => {
    const { service } = setup()
    const cancelled = vi.fn()
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      inspect(input, init)
      let emitted = 0
      return new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          const remaining = limit + 1 - emitted
          // Keep the peer open so overflow must cancel it rather than rely on EOF.
          if (remaining <= 0) return
          const size = Math.min(16 * 1024, remaining)
          controller.enqueue(new Uint8Array(size))
          emitted += size
        },
        cancel: cancelled,
      }), { status, headers: { 'Content-Type': kind === 'tts' ? 'audio/wav' : 'application/json' } })
    })
    vi.stubGlobal('fetch', transport)
    const result = kind === 'asr' ? await service.transcribe(asrRequest()) : await service.synthesize(ttsRequest())
    expect(result.status).toBe('failed')
    expect(result.message).toContain('过大')
    expect(cancelled).toHaveBeenCalled()
    expect(transport).toHaveBeenCalledTimes(1)
    expectSafe(result)
  })

  it.each([307, 308])('rejects HTTP %s without redirecting or retrying', async (status) => {
    const { service } = setup()
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      inspect(input, init)
      return new Response(null, { status, headers: { Location: 'https://unexpected-fixture.invalid/' } })
    })
    vi.stubGlobal('fetch', transport)
    const result = await service.synthesize(ttsRequest())
    expect(result.status).toBe('failed')
    expect(transport).toHaveBeenCalledTimes(1)
    expectSafe(result)
  })

  it.each<AudioServiceKind>(['asr', 'tts'])('aborts an open %s response body at the deadline', async (kind) => {
    const { service } = setup()
    const bodyCancelled = vi.fn(() => new Promise<void>(() => {}))
    let reached!: (signal: AbortSignal) => void
    const requested = new Promise<AbortSignal>((resolve) => { reached = resolve })
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      const { signal } = inspect(input, init)
      reached(signal)
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])) },
        cancel: bodyCancelled,
      }))
    })
    vi.stubGlobal('fetch', transport)
    const pending = kind === 'asr' ? service.transcribe(asrRequest()) : service.synthesize(ttsRequest())
    const signal = await requested
    await vi.advanceTimersByTimeAsync(14_999)
    expect(signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const result = await pending
    expect(result.status).toBe('failed')
    expect(result.message).toBe('语音服务响应超时，请稍后重试。')
    expect(signal.aborted).toBe(true)
    expect(bodyCancelled).toHaveBeenCalled()
    expect(transport).toHaveBeenCalledTimes(1)
    expectSafe(result)
  })

  it('keeps a reused operation identity intact when the old aborted SDK promise settles late', async () => {
    const { service } = setup()
    const oldRemote = pendingTransport()
    const oldPending = service.transcribe(asrRequest('reused'))
    await oldRemote.requested
    service.cancelAll()
    expect((await oldPending).status).toBe('cancelled')

    let reached!: (signal: AbortSignal) => void
    const newRequested = new Promise<AbortSignal>((resolve) => { reached = resolve })
    let respond!: (response: Response) => void
    oldRemote.transport.mockImplementation(async (input, init) => {
      reached(inspect(input, init).signal)
      return new Promise<Response>((resolve) => { respond = resolve })
    })
    const newPending = service.transcribe(asrRequest('reused'))
    const newSignal = await newRequested
    oldRemote.respond(successful('asr'))
    await vi.advanceTimersByTimeAsync(0)
    expect(newSignal.aborted).toBe(false)
    service.cancel('reused')
    const result = await newPending
    expect(newSignal.aborted).toBe(true)
    expect(result.status).toBe('cancelled')
    expect(result.receiptId).toBeUndefined()
    respond(successful('asr'))
    await vi.advanceTimersByTimeAsync(0)
    expect(oldRemote.transport).toHaveBeenCalledTimes(2)
    expectSafe(result)
  })

  it.each<AudioServiceKind>(['asr', 'tts'])('never reflects %s HTTP errors, credentials or stacks into IPC or logs', async (kind) => {
    const { service } = setup()
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      inspect(input, init)
      return new Response(JSON.stringify({ error: { message: `${asrKey} ${ttsKey} ${privateDetail}` } }), { status: 500 })
    })
    vi.stubGlobal('fetch', transport)
    const result = kind === 'asr' ? await service.transcribe(asrRequest()) : await service.synthesize(ttsRequest())
    expect(result.status).toBe('failed')
    expect(result.message).toBe('语音服务暂时不可用，请检查配置与网络。')
    expect(transport).toHaveBeenCalledTimes(1)
    expectSafe(result)
  })

  it('redacts a provider-echoed ASR credential before issuing its receipt', async () => {
    const { service } = setup()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ text: `${utterance} ${asrKey}` }))))
    const result = await service.transcribe(asrRequest())
    expect(result.text).toBe(`${utterance} [redacted]`)
    expect(service.consumeTranscript(result.receiptId!, 'mic-grant', result.text!)).toBe(true)
    expectSafe(result)
  })

  it.each(['empty', 'too-long', 'wrong-type'])('rejects %s transcription results without receipts', async (mode) => {
    const { service } = setup()
    const text: unknown = mode === 'empty' ? ' ' : mode === 'too-long' ? 'x'.repeat(8001) : 123
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ text }))))
    const result = await service.transcribe(asrRequest())
    expect(result.status).toBe('failed')
    expect(result.receiptId).toBeUndefined()
    expect(result.text).toBeUndefined()
  })

  it.each(['empty', 'riff-length', 'format', 'sample-length'])('rejects %s TTS WAV output', async (mode) => {
    const { service } = setup()
    const bytes = mode === 'empty' ? Buffer.alloc(0) : wav()
    if (mode === 'riff-length') bytes.writeUInt32LE(1, 4)
    if (mode === 'format') bytes.writeUInt16LE(9, 20)
    if (mode === 'sample-length') bytes.writeUInt16LE(3, 32)
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(new Uint8Array(bytes))))
    const result = await service.synthesize(ttsRequest())
    expect(result.status).toBe('failed')
    expect(result.audioBase64).toBeUndefined()
  })

  it.each(['too-large', 'riff-length', 'invalid-base64'])('rejects %s ASR input without a network call', async (mode) => {
    const { service } = setup()
    const transport = installSuccess()
    const bytes = mode === 'too-large' ? wav(2 * 1024 * 1024) : wav()
    if (mode === 'riff-length') bytes.writeUInt32LE(1, 4)
    const input = asrRequest('invalid-recording', 'mic-grant', bytes)
    if (mode === 'invalid-base64') input.audioBase64 = '%%not-base64%%'
    expect((await service.transcribe(input)).status).toBe('failed')
    expect(transport).not.toHaveBeenCalled()
  })

  it.each<AudioServiceKind>(['asr', 'tts'])('requires its own %s credential instead of using the other capability', async (kind) => {
    const rig = setup()
    rig.getConfiguration.mockImplementation(selected => ({ ...configurations[selected], ...(selected === kind ? { apiKey: '' } : {}) }))
    const transport = installSuccess()
    const result = kind === 'asr' ? await rig.service.transcribe(asrRequest()) : await rig.service.synthesize(ttsRequest())
    expect(result.status).toBe('configuration-required')
    expect(transport).not.toHaveBeenCalled()
    expect(rig.getConfiguration).toHaveBeenCalledExactlyOnceWith(kind)
    expectSafe(result)
  })
  it.each<AudioServiceKind>(['asr', 'tts'])('cancels only the %s channel while the other operation can complete', async (cancelledKind) => {
    const rig = setup()
    const pending: Partial<Record<AudioServiceKind, { resolve: (value: Response) => void; signal: AbortSignal }>> = {}
    let announce!: () => void
    const observed = new Promise<void>(resolve => { announce = resolve })
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url, init) => {
      const kind = String(url).endsWith('/audio/transcriptions') ? 'asr' : 'tts'
      return new Promise<Response>((resolve) => {
        pending[kind] = { resolve, signal: init!.signal! }
        if (pending.asr && pending.tts) announce()
      })
    }))
    const recognition = rig.service.transcribe(asrRequest())
    const speech = rig.service.synthesize(ttsRequest())
    await observed
    rig.service.cancelAll(cancelledKind)
    const remainingKind = cancelledKind === 'asr' ? 'tts' : 'asr'
    expect(pending[cancelledKind]!.signal.aborted).toBe(true)
    expect(pending[remainingKind]!.signal.aborted).toBe(false)
    pending[remainingKind]!.resolve(remainingKind === 'asr' ? new Response(JSON.stringify({ text: utterance }), { headers: { 'Content-Type': 'application/json' } }) : new Response(new Uint8Array(wav())))
    const outcomes = await Promise.all([recognition, speech])
    expect(outcomes[cancelledKind === 'asr' ? 0 : 1].status).toBe('cancelled')
    expect(outcomes[remainingKind === 'asr' ? 0 : 1].status).toBe('complete')
    if (remainingKind === 'asr') expect(rig.service.consumeTranscript(outcomes[0].receiptId!, 'mic-grant', utterance)).toBe(true)
    pending[cancelledKind]!.resolve(new Response(JSON.stringify({ text: utterance })))
  })
})
