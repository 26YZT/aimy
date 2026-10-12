import type { ChatRequest, ChatUpdate } from '../shared/contracts'

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { format } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDesktopChat } from './chat-service'
import { createSettingsStore } from './settings-store'

const fakeKey = 'DESKTOP_FAKE_TEST_CREDENTIAL'
const privateDetail = 'PRIVATE_PROVIDER_ERROR_DETAIL'
const publicReply = 'LOCAL_SAFE_REPLY'
const protocols = ['chat-completions', 'responses'] as const
type Protocol = typeof protocols[number]

const fakeSecrets = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(value.split('').reverse().join('')),
  decryptString: (value: Buffer) => value.toString().split('').reverse().join(''),
}

const temporaryDirectories: string[] = []
let diagnostics: ReturnType<typeof vi.spyOn>[]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  diagnostics = (['log', 'info', 'warn', 'error'] as const).map(level => vi.spyOn(console, level).mockImplementation(() => {}))
})

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function configuredChat(protocol: Protocol, observeUpdate?: (update: ChatUpdate) => void) {
  const directory = await mkdtemp(join(tmpdir(), 'aimy-chat-service-'))
  temporaryDirectories.push(directory)
  const settings = await createSettingsStore(directory, fakeSecrets)
  const saved = await settings.save({
    model: 'fixture-model', visionModel: '', baseUrl: 'https://desktop-fixture.invalid/v1/', api: protocol, apiKey: fakeKey,
  })
  expect(saved.ok).toBe(true)
  const updates: ChatUpdate[] = []
  return { chat: createDesktopChat(settings, update => { updates.push(update); observeUpdate?.(update) }), updates }
}

function request(requestId = 'fixture-request', messages: ChatRequest['messages'] = []): ChatRequest {
  return { requestId, sessionId: 'fixture-session', text: 'hello', messages }
}

function inspectTransport(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) {
  expect(new URL(String(input)).hostname).toBe('desktop-fixture.invalid')
  expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${fakeKey}`)
  expect(init?.method).toBe('POST')
  expect(init?.redirect).toBe('error')
  const body = JSON.parse(String(init?.body)) as Record<string, unknown>
  expect(body.model).toBe('fixture-model')
  expect(body.tools).toBeUndefined()
  expect(body.tool_choice).toBeUndefined()
  if (!init?.signal)
    throw new Error('The actual SDK transport must carry an abort signal.')
  return init.signal
}

function installPendingTransport() {
  let announceRequest!: (signal: AbortSignal) => void
  const requested = new Promise<AbortSignal>((resolve) => { announceRequest = resolve })
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const signal = inspectTransport(input, init)
    announceRequest(signal)
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error(`${fakeKey} ${privateDetail}`)), { once: true })
    })
  })
  vi.stubGlobal('fetch', transport)
  return { transport, requested }
}

function successfulResponse(protocol: Protocol) {
  const events = protocol === 'responses'
    ? [
        { type: 'response.output_text.delta', delta: publicReply },
        { type: 'response.output_item.done', item: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: publicReply, annotations: [] }] } },
        { type: 'response.completed', response: { output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: publicReply, annotations: [] }] }] } },
      ]
    : [
        { id: 'fixture', object: 'chat.completion.chunk', created: 0, model: 'fixture-model', choices: [{ index: 0, delta: { role: 'assistant', content: publicReply }, finish_reason: null }] },
        { id: 'fixture', object: 'chat.completion.chunk', created: 0, model: 'fixture-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
      ]
  const body = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + (protocol === 'chat-completions' ? 'data: [DONE]\n\n' : '')
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
}

function expectPrivateBoundary(reply: unknown, updates: ChatUpdate[]) {
  const output = JSON.stringify({ reply, updates }) + diagnostics.flatMap(spy => spy.mock.calls).map(args => format(...args)).join('\n')
  expect(output).not.toContain(fakeKey)
  expect(output).not.toContain(privateDetail)
  expect(output).not.toMatch(/\n\s+at /)
}

describe('desktop chat through actual AIRI and SDK imports', () => {
  // Reproduce the resolved-abort path: AIRI treats cancellation as a settled send.
  it.each(protocols)('reports a 40-second %s abort as a safe timeout failure', async (protocol) => {
    const { chat, updates } = await configuredChat(protocol)
    const { transport, requested } = installPendingTransport()
    const pending = chat.send(request())
    const signal = await requested

    await vi.advanceTimersByTimeAsync(39_999)
    expect(signal.aborted).toBe(false)
    expect(transport).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)

    const reply = await pending
    expect(signal.aborted).toBe(true)
    expect(reply.status).toBe('failed')
    expect(reply.message).toBe('本轮响应超时，请稍后重试。')
    expect(reply.requestId).toBe('fixture-request')
    expect(transport).toHaveBeenCalledTimes(1)
    expectPrivateBoundary(reply, updates)
  })

  it.each(protocols)('keeps manual %s cancellation distinct and permits the next turn', async (protocol) => {
    const { chat, updates } = await configuredChat(protocol)
    const { transport, requested } = installPendingTransport()
    const pending = chat.send(request())
    const signal = await requested
    chat.cancel()

    const cancelled = await pending
    expect(signal.aborted).toBe(true)
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.message).not.toBe('本轮响应超时，请稍后重试。')
    expect(transport).toHaveBeenCalledTimes(1)
    expectPrivateBoundary(cancelled, updates)

    transport.mockImplementation(async (input, init) => {
      expect(inspectTransport(input, init).aborted).toBe(false)
      return successfulResponse(protocol)
    })
    const recovered = await chat.send(request('fixture-recovery', cancelled.messages))
    expect(recovered.status).toBe('complete')
    expect(JSON.stringify(recovered.messages)).toContain(publicReply)
    expect(transport).toHaveBeenCalledTimes(2)
    expectPrivateBoundary(recovered, updates)
  })

  it.each(protocols)('preserves only already streamed %s text after cancellation and reuses it in the next turn', async (protocol) => {
    // AIRI retains a marker-safety tail. Padding lets the entire fake key reach
    // the foreground while the transport remains open for cancellation.
    const partial = `LOCAL_PARTIAL_REPLY ${fakeKey} VISIBLE_PADDING_END`
    let safePartial = ''
    const late = `LATE_PROVIDER_OUTPUT ${fakeKey} ${privateDetail}`
    let announcePartial!: () => void
    const displayedPartial = new Promise<void>((resolve) => { announcePartial = resolve })
    const { chat, updates } = await configuredChat(protocol, update => {
      if (update.text.includes('LOCAL_PARTIAL_REPLY [redacted]')) {
        safePartial = update.text
        announcePartial()
      }
    })
    const encoder = new TextEncoder()
    const frame = (event: unknown) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
    const delta = (text: string) => protocol === 'responses'
      ? { type: 'response.output_text.delta', delta: text }
      : { id: 'fixture', object: 'chat.completion.chunk', created: 0, model: 'fixture-model', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] }
    let signal: AbortSignal | undefined
    let lateAttempted = false
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      signal = inspectTransport(input, init)
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(frame(delta(partial)))
          // The simulated peer attempts a late completion even after it receives abort.
          // Actual AIRI/SDK consumers must ignore this text rather than persist it.
          signal!.addEventListener('abort', () => {
            lateAttempted = true
            controller.enqueue(frame(delta(late)))
            if (protocol === 'responses') {
              const message = { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: partial + late, annotations: [] }] }
              controller.enqueue(frame({ type: 'response.output_item.done', item: message }))
              controller.enqueue(frame({ type: 'response.completed', response: { output: [message] } }))
            }
            else {
              controller.enqueue(frame({ id: 'fixture', object: 'chat.completion.chunk', created: 0, model: 'fixture-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }))
              controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            }
            controller.close()
          }, { once: true })
        },
      })
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
    })
    vi.stubGlobal('fetch', transport)

    const pending = chat.send(request())
    await displayedPartial
    expect(safePartial).toContain('LOCAL_PARTIAL_REPLY [redacted]')
    chat.cancel()
    const cancelled = await pending
    expect(signal?.aborted).toBe(true)
    expect(lateAttempted).toBe(true)
    expect(cancelled.status).toBe('cancelled')
    const partialMessages = cancelled.messages.filter(message => message.role === 'assistant')
    expect(partialMessages).toHaveLength(1)
    expect(partialMessages[0]).toMatchObject({
      content: safePartial, slices: [{ type: 'text', text: safePartial }], tool_results: [],
      replyToMessageId: cancelled.messages.find(message => message.role === 'user')?.id,
    })
    expect(JSON.stringify(cancelled)).not.toContain('LATE_PROVIDER_OUTPUT')
    expect(updates.some(update => update.text.includes('LATE_PROVIDER_OUTPUT'))).toBe(false)
    expectPrivateBoundary(cancelled, updates)

    let nextBody: Record<string, unknown> | undefined
    transport.mockImplementation(async (input, init) => {
      expect(inspectTransport(input, init).aborted).toBe(false)
      nextBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return successfulResponse(protocol)
    })
    const recovered = await chat.send(request('fixture-after-partial-cancel', cancelled.messages))
    expect(recovered.status).toBe('complete')
    expect(transport).toHaveBeenCalledTimes(2)
    expect(nextBody).toBeDefined()
    const wireMessages = (protocol === 'responses' ? nextBody!.input : nextBody!.messages) as { role: string, content: unknown }[]
    const previousAssistants = wireMessages.filter(message => message.role === 'assistant')
    expect(previousAssistants).toHaveLength(1)
    expect(JSON.stringify(previousAssistants)).toContain(safePartial)
    expect(JSON.stringify(nextBody)).not.toContain('LATE_PROVIDER_OUTPUT')
    expect(JSON.stringify(nextBody)).not.toContain(fakeKey)
    expect(recovered.messages.filter(message => message.role === 'assistant')).toHaveLength(2)
    expect(JSON.stringify(recovered.messages)).not.toContain('LATE_PROVIDER_OUTPUT')
    expectPrivateBoundary(recovered, updates)
  })

  it.each(protocols)('keeps a %s HTTP 500 and its fake credential out of replies and diagnostics', async (protocol) => {
    const { chat, updates } = await configuredChat(protocol)
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      inspectTransport(input, init)
      return new Response(JSON.stringify({ error: { message: `${fakeKey} ${privateDetail}`, type: 'fixture-only' } }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', transport)

    const reply = await chat.send(request())
    expect(reply.status).toBe('failed')
    expect(reply.message).toBe('模型服务暂时不可用，请检查配置与网络。')
    expect(transport).toHaveBeenCalledTimes(1)
    expectPrivateBoundary(reply, updates)
  })
})
