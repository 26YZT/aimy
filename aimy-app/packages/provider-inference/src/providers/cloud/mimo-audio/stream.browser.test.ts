import type { MimoStreamingSpeechProvider } from '.'

import { afterEach, expect, it, vi } from 'vitest'

import { providerMimoAudioSpeech } from '.'

afterEach(() => vi.unstubAllGlobals())

function event(bytes: number[]) {
  return `data: ${JSON.stringify({ choices: [{ delta: { audio: { data: btoa(String.fromCharCode(...bytes)) } } }] })}\r\n\r\n`
}

async function open() {
  const transport = new TransformStream<Uint8Array, Uint8Array>()
  const writer = transport.writable.getWriter()
  const network = vi.fn<typeof fetch>().mockResolvedValue(new Response(transport.readable))
  vi.stubGlobal('fetch', network)
  const provider = await providerMimoAudioSpeech.createProvider({ apiKey: 'synthetic', stylePrompt: 'Speak gently.' }) as MimoStreamingSpeechProvider
  const abort = new AbortController()
  const stream = await provider.streamSpeech('你好。', { model: 'mimo-v2.5-tts', voice: '冰糖', signal: abort.signal })
  const reader = stream.getReader()
  return { writer, network, provider, abort, reader }
}

it('delivers PCM before response completion and preserves bytes across network and audio event boundaries', async () => {
  const { writer, network, abort, reader } = await open()
  const first = reader.read()
  const wire = `: heartbeat\r\n\r\n${event([0])}${event([128, 255, 127])}`
  for (const char of wire)
    await writer.write(new TextEncoder().encode(char))
  expect(Array.from((await first).value!)).toEqual([-1, 32767 / 32768])
  const request = network.mock.calls[0][1]!
  expect(request.signal).toBe(abort.signal)
  expect(JSON.parse(String(request.body))).toEqual({ model: 'mimo-v2.5-tts', stream: true, messages: [{ role: 'user', content: 'Speak gently.' }, { role: 'assistant', content: '你好。' }], audio: { format: 'pcm16', voice: '冰糖' } })
  const last = reader.read()
  await writer.write(new TextEncoder().encode('data: [DONE]\r\n\r\n'))
  await writer.close().catch(() => {})
  expect((await last).done).toBe(true)
})

it.each([
  ['truncated stream', event([0, 0])],
  ['odd final PCM byte', `${event([0, 0, 1])}data: [DONE]\n\n`],
  ['server error', 'data: {"error":{"message":"private upstream text"}}\n\n'],
  ['bad JSON', 'data: nope\n\n'],
  ['missing audio', 'data: [DONE]\n\n'],
])('rejects %s without returning an empty success', async (_label, wire) => {
  const { writer, reader } = await open()
  const reading = (async () => {
    while (!(await reader.read()).done) { /* Drain real PCM before the protocol failure. */ }
  })()
  const assertion = expect(reading).rejects.toThrow(/MiMo speech/)
  await writer.write(new TextEncoder().encode(wire)).catch(() => {})
  await writer.close().catch(() => {})
  await assertion
})

it('cancels before the first audio block and releases the source stream', async () => {
  const { writer, reader, abort } = await open()
  const pending = reader.read()
  const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  abort.abort(new DOMException('Cancelled', 'AbortError'))
  await assertion
  await expect(writer.write(new Uint8Array([1]))).rejects.toBeDefined()
})

it('cancels after audio and never exposes a late block', async () => {
  const { writer, reader, abort } = await open()
  const first = reader.read()
  await writer.write(new TextEncoder().encode(event([0, 0])))
  expect((await first).value?.length).toBe(1)
  abort.abort(new DOMException('Cancelled', 'AbortError'))
  await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' })
  await expect(writer.write(new TextEncoder().encode(event([0, 1])))).rejects.toBeDefined()
})

it('accepts multiline SSE data and ends immediately at DONE without waiting for connection closure', async () => {
  const { writer, reader } = await open()
  const pending = reader.read()
  await writer.write(new TextEncoder().encode('data: {"choices":\ndata: [{"delta":{"audio":{"data":"AAA="}}}]}\n\n'))
  expect(Array.from((await pending).value!)).toEqual([0])
  const end = reader.read()
  await writer.write(new TextEncoder().encode('data: [DONE]\n\n'))
  expect((await end).done).toBe(true)
})

it('discards a late HTTP body after cancellation before the response headers', async () => {
  const late = Promise.withResolvers<Response>()
  const network = vi.fn<typeof fetch>(() => late.promise)
  vi.stubGlobal('fetch', network)
  const provider = await providerMimoAudioSpeech.createProvider({ apiKey: 'synthetic' }) as MimoStreamingSpeechProvider
  const abort = new AbortController()
  const pending = provider.streamSpeech('hello', { model: 'mimo-v2.5-tts', voice: '冰糖', signal: abort.signal })
  const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  abort.abort(new DOMException('Cancelled', 'AbortError'))
  const cancel = vi.fn()
  late.resolve(new Response(new ReadableStream({ cancel })))
  await assertion
  expect(cancel).toHaveBeenCalledOnce()
  expect(network.mock.calls[0][1]?.signal?.aborted).toBe(true)
})

it('rejects clone and design models before starting a stream request', async () => {
  const network = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', network)
  const provider = await providerMimoAudioSpeech.createProvider({ apiKey: 'synthetic' }) as MimoStreamingSpeechProvider
  for (const model of ['mimo-v2.5-tts-voiceclone', 'mimo-v2.5-tts-voicedesign'])
    await expect(provider.streamSpeech('hello', { model, voice: 'voice', signal: new AbortController().signal })).rejects.toThrow('built-in')
  expect(network).not.toHaveBeenCalled()
})

it('passes cancellation into the non-streaming transport', async () => {
  const network = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ message: { audio: { data: 'AAA=' } } }] }))
  vi.stubGlobal('fetch', network)
  const provider = await providerMimoAudioSpeech.createProvider({ apiKey: 'synthetic' }) as MimoStreamingSpeechProvider
  const signal = new AbortController().signal
  const request = provider.speech('mimo-v2.5-tts')
  await request.fetch!(new URL('https://unused.invalid'), { body: JSON.stringify({ input: 'hello' }), signal })
  expect(network.mock.calls[0][1]?.signal).toBe(signal)
})
