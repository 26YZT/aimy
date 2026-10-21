import type { RequestListener, Server } from 'node:http'

import type { AcceptanceBudgetPort, AcceptanceCampaign } from '@proj-airi/stage-ui/stores/memory/budget'

import type { AiriBaselineAdapterOptions, AuthorizedFetch } from './airi-baseline-adapter'

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getDefinedProvider } from '@proj-airi/provider-inference'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const campaign: AcceptanceCampaign = {
  campaignId: 'synthetic-two-arm-campaign',
  maxCostMicroYuan: 10_000_000,
  price: {
    id: 'synthetic-only-price',
    currency: 'CNY',
    providerId: 'deepseek',
    modelId: 'synthetic-model',
    mode: 'synthetic',
    inputMicroYuanPerMillion: 1_000_000,
    outputMicroYuanPerMillion: 2_000_000,
    verifiedAt: 'synthetic-fixture',
    sourceUrl: 'https://example.invalid/synthetic-price',
  },
}
const definition = getDefinedProvider('deepseek')!
const directories: string[] = []
const servers: Server[] = []

function request() {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'authorization': 'Bearer synthetic-placeholder' },
    body: JSON.stringify({ model: campaign.price.modelId, thinking: { type: 'disabled' }, stream: true, messages: [{ role: 'user', content: 'Synthetic source sentence.' }] }),
  }
}

function completion() {
  return 'data: {"id":"synthetic","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"Synthetic reply."},"finish_reason":null}]}\n\n'
    + 'data: {"id":"synthetic","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n'
    + 'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":7}}\n\ndata: [DONE]\n\n'
}

function response() {
  return new Response(completion(), { headers: { 'content-type': 'text/event-stream' } })
}

async function server(handler: RequestListener) {
  const value = createServer(handler)
  servers.push(value)
  await new Promise<void>(resolve => value.listen(0, '127.0.0.1', resolve))
  const address = value.address()
  if (!address || typeof address === 'string')
    throw new Error('Synthetic server has no port')
  return new URL(`http://127.0.0.1:${address.port}/chat/completions`)
}

async function fixture(overrides: Partial<AiriBaselineAdapterOptions> = {}) {
  const { AcceptanceBudgetLedger } = await import('../../src/main/services/aimy/acceptance-budget')
  const { AiriBaselineAdapter } = await import('./airi-baseline-adapter')
  const generation = await import('@proj-airi/stage-ui/services/acceptance-generation')
  const budgetModule = await import('@proj-airi/stage-ui/stores/memory/budget')
  const directory = await mkdtemp(join(tmpdir(), 'aimy-eval-gate-'))
  directories.push(directory)
  const filePath = join(directory, 'shared-campaign.json')
  const ledger = new AcceptanceBudgetLedger({ filePath, campaign })
  const send = vi.fn<AuthorizedFetch>(async () => response())
  const options: AiriBaselineAdapterOptions = {
    budget: ledger,
    campaign,
    providerDefinition: definition,
    run: { arm: 'airi', runId: 'synthetic-run', caseId: 'synthetic-case' },
    requestId: 'synthetic-turn',
    protocol: 'chat-completions',
    maxInputTokens: 64_000,
    maxOutputTokens: 128,
    assertCurrent() {},
    prepareTransport: async () => send,
    ...overrides,
  }
  return {
    adapter: new AiriBaselineAdapter(options),
    AiriBaselineAdapter,
    AcceptanceBudgetLedger,
    generation,
    budgetModule,
    ledger,
    filePath,
    send,
    options,
  }
}

beforeEach(() => vi.resetModules())
afterEach(async () => {
  vi.restoreAllMocks()
  for (const value of servers.splice(0)) {
    value.closeAllConnections()
    await new Promise<void>(resolve => value.close(() => resolve()))
  }
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('baseline acceptance fetch adapter', () => {
  it('delivers the first real HTTP chunk before completion and settles the independent usage stream', async () => {
    const finish = Promise.withResolvers<void>()
    const sentBodies: string[] = []
    const url = await server(async (incoming, outgoing) => {
      let body = ''
      for await (const chunk of incoming)
        body += chunk.toString()
      sentBodies.push(body)
      outgoing.writeHead(200, { 'content-type': 'text/event-stream' })
      outgoing.write('data: {"choices":[{"index":0,"delta":{"content":"first-chunk"}}]}\n\n')
      await finish.promise
      outgoing.end('data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":7}}\n\ndata: [DONE]\n\n')
    })
    const { adapter, ledger } = await fixture({ prepareTransport: async () => fetch })
    const received = await adapter.fetch(url, request())
    const reader = received.body!.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toContain('first-chunk')
    const pending = await ledger.status()
    expect(pending.accountedMicroYuan).toBe(0)
    expect(pending.reservedMicroYuan).toBeGreaterThan(0)
    finish.resolve()
    let remainder = ''
    let chunk = await reader.read()
    while (!chunk.done) {
      remainder += new TextDecoder().decode(chunk.value)
      chunk = await reader.read()
    }
    expect(remainder).toContain('prompt_tokens')
    await adapter.flush()
    expect((await ledger.status()).accountedMicroYuan).toBe(25)
    expect((await ledger.status()).reservedMicroYuan).toBe(0)
    expect(JSON.parse(sentBodies[0]).max_tokens).toBe(128)
    expect(JSON.parse(sentBodies[0]).stream_options.include_usage).toBe(true)
  })

  it('resolves transport before reserving and preserves successful Response identity', async () => {
    const { ledger, options, AiriBaselineAdapter } = await fixture()
    const order: string[] = []
    const prepared = response()
    const adapter = new AiriBaselineAdapter({
      ...options,
      assertCurrent: () => { order.push('guard') },
      prepareTransport: async () => {
        await Promise.resolve()
        order.push('prepared')
        return async (_url, init) => {
          order.push('send')
          expect(init.redirect).toBe('error')
          return prepared
        }
      },
      budget: {
        reserve: async (input) => {
          order.push('reserve')
          return ledger.reserve(input)
        },
        started: async (input) => {
          await ledger.started(input)
          order.push('started')
        },
        releaseNotSent: input => ledger.releaseNotSent(input),
        settle: input => ledger.settle(input),
        status: () => ledger.status(),
      },
    })
    expect(await adapter.fetch(new URL('http://127.0.0.1:1/chat/completions'), request())).toBe(prepared)
    await adapter.flush()
    expect(order.indexOf('prepared')).toBeLessThan(order.indexOf('reserve'))
    expect(order.slice(-3)).toEqual(['started', 'guard', 'send'])
  })

  it('uses one real ledger for baseline retries and the existing Aimy attempt gate', async () => {
    const actualBodies: Array<Record<string, unknown>> = []
    const url = await server(async (incoming, outgoing) => {
      let body = ''
      for await (const chunk of incoming)
        body += chunk.toString()
      actualBodies.push(JSON.parse(body))
      outgoing.writeHead(200, { 'content-type': 'text/event-stream' }).end(completion())
    })
    const { adapter, ledger, filePath, generation, budgetModule, AcceptanceBudgetLedger } = await fixture({ prepareTransport: async () => fetch })
    await adapter.fetch(url, request())
    await adapter.flush()
    await adapter.fetch(url, request())
    await adapter.flush()
    const reopened = new AcceptanceBudgetLedger({ filePath, campaign })
    budgetModule.configureAcceptanceBudget(reopened)
    generation.configureAcceptanceGeneration(campaign, { arm: 'aimy', runId: 'aimy-run', caseId: 'synthetic-case' })
    const aimyRequest = request()
    aimyRequest.body = JSON.stringify({ ...JSON.parse(aimyRequest.body), max_tokens: 128 })
    const gate = generation.acceptanceAttemptGate(definition, 'chat', 'aimy-turn')!
    const attempt = await gate.begin({ url, protocol: 'chat-completions', body: aimyRequest.body })
    const aimyResponse = await fetch(url, { ...aimyRequest, redirect: 'error' })
    attempt.observeResponse(aimyResponse.clone())
    await aimyResponse.text()
    await generation.flushAcceptanceGeneration()
    expect(actualBodies).toHaveLength(3)
    expect(actualBodies.every(body => body.max_tokens === 128)).toBe(true)
    const result = await ledger.status()
    expect(result.attempts).toBe(3)
    expect(result.accountedMicroYuan).toBe(75)
    expect(result.reservedMicroYuan).toBe(0)
    const saved = JSON.parse(await readFile(filePath, 'utf8'))
    const records = Object.values(saved.records) as Array<{ attempt: { arm: string, attemptId: string, requestId: string } }>
    expect(records.map(record => record.attempt.arm)).toEqual(['airi', 'airi', 'aimy'])
    expect(new Set(records.map(record => record.attempt.attemptId)).size).toBe(3)
    expect(records.slice(0, 2).map(record => record.attempt.requestId)).toEqual(['synthetic-turn', 'synthetic-turn'])
    expect(await readFile(filePath, 'utf8')).not.toContain('Synthetic source sentence.')
    expect(await readFile(filePath, 'utf8')).not.toContain('synthetic-placeholder')
  })

  it.each(['reserve', 'started'] as const)('rejects cancellation or a changed case during %s without invoking transport', async (phase) => {
    const { options, ledger, send, AiriBaselineAdapter, filePath } = await fixture()
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const controller = new AbortController()
    let current = true
    const port: AcceptanceBudgetPort = {
      reserve: async (input) => {
        const result = await ledger.reserve(input)
        if (phase === 'reserve') {
          entered.resolve()
          await release.promise
        }
        return result
      },
      started: async (input) => {
        await ledger.started(input)
        if (phase === 'started') {
          entered.resolve()
          await release.promise
        }
      },
      settle: input => ledger.settle(input),
      releaseNotSent: input => ledger.releaseNotSent(input),
      status: () => ledger.status(),
    }
    const adapter = new AiriBaselineAdapter({ ...options, budget: port, signal: controller.signal, assertCurrent() {
      if (!current)
        throw new DOMException('Case changed', 'AbortError')
    } })
    const pending = adapter.fetch(new URL('http://127.0.0.1:1/chat/completions'), request())
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await entered.promise
    if (phase === 'reserve')
      controller.abort('synthetic-private-abort-reason')
    else
      current = false
    release.resolve()
    await rejected
    await adapter.flush()
    expect(send).not.toHaveBeenCalled()
    const saved = JSON.parse(await readFile(filePath, 'utf8'))
    expect(Object.values(saved.records).map(record => (record as { state: string }).state)).toEqual(['released'])
    expect((await ledger.status()).remainingMicroYuan).toBe(campaign.maxCostMicroYuan)
  })

  it('keeps unknown usage reserved and blocks the next arm after reopening the shared ledger', async () => {
    const { adapter, send, ledger, filePath, AcceptanceBudgetLedger, generation, budgetModule } = await fixture()
    send.mockResolvedValue(new Response('data: {"choices":[]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }))
    await adapter.fetch(new URL('http://127.0.0.1:1/chat/completions'), request())
    await expect(adapter.flush()).rejects.toMatchObject({ code: 'paused' })
    const state = await ledger.status()
    expect(state.paused).toBe(true)
    expect(state.pauseReason).toBe('usage-unknown')
    expect(state.reservedMicroYuan).toBeGreaterThan(0)
    const reopened = new AcceptanceBudgetLedger({ filePath, campaign })
    budgetModule.configureAcceptanceBudget(reopened)
    generation.configureAcceptanceGeneration(campaign, { arm: 'aimy', runId: 'later-run', caseId: 'later-case' })
    const gate = generation.acceptanceAttemptGate(definition, 'chat')!
    await expect(gate.begin({ protocol: 'chat-completions', url: new URL('http://127.0.0.1:1/chat/completions'), body: JSON.stringify({ ...JSON.parse(request().body), max_tokens: 128 }) })).rejects.toMatchObject({ code: 'paused' })
    expect((await reopened.status()).attempts).toBe(1)
  })

  it('rejects redirects instead of making an unaccounted second HTTP request', async () => {
    let forbidden = 0
    const target = await server((_incoming, outgoing) => {
      forbidden++
      outgoing.end(completion())
    })
    const url = await server((_incoming, outgoing) => outgoing.writeHead(307, { location: target.href }).end())
    const { adapter, ledger } = await fixture({ prepareTransport: async () => fetch })
    await expect(adapter.fetch(url, request())).rejects.toMatchObject({ code: 'transport-failed' })
    await expect(adapter.flush()).rejects.toMatchObject({ code: 'paused' })
    expect(forbidden).toBe(0)
    expect((await ledger.status()).pauseReason).toBe('usage-unknown')
  })

  it('keeps credential canaries out of returned errors, responses, accounting, and console', async () => {
    const canary = 'synthetic-secret-canary-not-a-key'
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { adapter, send, ledger, filePath } = await fixture()
    send.mockRejectedValueOnce(Object.assign(new Error(canary), { status: 503 }))
    const error = await adapter.fetch(new URL('http://127.0.0.1:1/chat/completions'), request()).catch(error => error)
    expect(error).toMatchObject({ code: 'transport-failed', status: 503 })
    expect(String(error)).not.toContain(canary)
    expect(error.cause).toBeUndefined()
    await expect(adapter.flush()).rejects.toMatchObject({ code: 'paused' })
    expect(await readFile(filePath, 'utf8')).not.toContain(canary)
    expect(logged).not.toHaveBeenCalled()
    expect((await ledger.status()).attempts).toBe(1)
  })

  it('sanitizes non-success provider bodies while preserving status and unknown charges', async () => {
    const canary = 'synthetic-secret-response-canary'
    const { adapter, send, filePath, ledger } = await fixture()
    send.mockResolvedValue(new Response(canary, { status: 401, headers: { 'x-reflected-key': canary } }))
    const failed = await adapter.fetch(new URL('http://127.0.0.1:1/chat/completions'), request())
    expect(failed.status).toBe(401)
    expect(await failed.text()).not.toContain(canary)
    expect(failed.headers.get('x-reflected-key')).toBeNull()
    await expect(adapter.flush()).rejects.toMatchObject({ code: 'paused' })
    expect(await readFile(filePath, 'utf8')).not.toContain(canary)
    expect((await ledger.status()).reservedMicroYuan).toBeGreaterThan(0)
  })

  it('preserves source text and drops tools while enforcing the final common output bound', async () => {
    const { adapter, send } = await fixture()
    const input = request()
    const original = JSON.parse(input.body)
    input.body = JSON.stringify({ ...original, tools: [{ type: 'function', function: { name: 'not_allowed' } }], tool_choice: 'auto', max_tokens: 999_999, max_completion_tokens: 999_999 })
    await adapter.fetch(new URL('http://127.0.0.1:1/chat/completions'), input)
    await adapter.flush()
    const sent = JSON.parse(String(send.mock.calls[0][1].body))
    expect(sent.messages).toEqual(original.messages)
    expect(sent.tools).toBeUndefined()
    expect(sent.tool_choice).toBeUndefined()
    expect(sent.max_tokens).toBe(128)
    expect(sent.max_completion_tokens).toBeUndefined()
  })

  it('uses the Responses output field and usage totals in an explicitly synthetic run', async () => {
    const { adapter, send, ledger } = await fixture({ protocol: 'responses' })
    send.mockResolvedValue(new Response('data: {"type":"response.completed","response":{"usage":{"input_tokens":11,"output_tokens":7}}}\n\n', { headers: { 'content-type': 'text/event-stream' } }))
    const input = [{ role: 'user', content: [{ type: 'input_text', text: 'Synthetic source sentence.' }] }]
    await adapter.fetch(new URL('http://127.0.0.1:1/v1/responses'), {
      method: 'POST',
      body: JSON.stringify({ model: campaign.price.modelId, input, max_tokens: 9999, max_output_tokens: 9999 }),
    })
    await adapter.flush()
    const sent = JSON.parse(String(send.mock.calls[0][1].body))
    expect(sent.input).toEqual(input)
    expect(sent.max_output_tokens).toBe(128)
    expect(sent.max_tokens).toBeUndefined()
    expect((await ledger.status()).accountedMicroYuan).toBe(25)
  })

  it.each([
    { thinking: { type: 'enabled' } },
    { model: 'different-model' },
    { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,synthetic' } }] }] },
    { messages: [{ role: 'tool', content: 'Unapproved tool result' }] },
  ])('rejects a mismatched or non-text request before authorization and reservation: %j', async (patch) => {
    const prepareTransport = vi.fn(async () => async () => response())
    const { adapter, ledger } = await fixture({ prepareTransport })
    const input = request()
    input.body = JSON.stringify({ ...JSON.parse(input.body), ...patch })
    await expect(adapter.fetch(new URL('http://127.0.0.1:1/chat/completions'), input)).rejects.toBeInstanceOf(Error)
    expect(prepareTransport).not.toHaveBeenCalled()
    expect((await ledger.status()).attempts).toBe(0)
  })

  it('retains a settlement failure and blocks later sends', async () => {
    const { options, ledger, send, AiriBaselineAdapter } = await fixture()
    const adapter = new AiriBaselineAdapter({ ...options, budget: {
      reserve: input => ledger.reserve(input),
      started: input => ledger.started(input),
      releaseNotSent: input => ledger.releaseNotSent(input),
      status: () => ledger.status(),
      settle: async () => { throw new Error('synthetic-storage-failure') },
    } })
    await adapter.fetch(new URL('http://127.0.0.1:1/chat/completions'), request())
    await expect(adapter.flush()).rejects.toMatchObject({ code: 'paused' })
    await expect(adapter.fetch(new URL('http://127.0.0.1:1/chat/completions'), request())).rejects.toMatchObject({ code: 'paused' })
    expect(send).toHaveBeenCalledTimes(1)
    expect((await ledger.status()).reservedMicroYuan).toBeGreaterThan(0)
  })

  it('does not reserve when authorization preparation fails or is cancelled', async () => {
    const canary = 'synthetic-authorization-canary'
    const prepareTransport = vi.fn(async () => {
      throw new Error(canary)
    })
    const { adapter, ledger, options, AiriBaselineAdapter, send } = await fixture({ prepareTransport })
    const error = await adapter.fetch(new URL('http://127.0.0.1:1/chat/completions'), request()).catch(error => error)
    expect(error).toMatchObject({ code: 'transport-unavailable' })
    expect(String(error)).not.toContain(canary)
    expect((await ledger.status()).attempts).toBe(0)
    const controller = new AbortController()
    const cancelled = new AiriBaselineAdapter({ ...options, signal: controller.signal, prepareTransport: async () => {
      await Promise.resolve()
      controller.abort(canary)
      return send
    } })
    await expect(cancelled.fetch(new URL('http://127.0.0.1:1/chat/completions'), request())).rejects.toMatchObject({ name: 'AbortError' })
    expect(send).not.toHaveBeenCalled()
    expect((await ledger.status()).attempts).toBe(0)
  })
})
