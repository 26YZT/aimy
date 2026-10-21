import type { RequestListener } from 'node:http'

import type { GenerationProvider } from '@proj-airi/provider-inference'

import { createServer } from 'node:http'

import { describe, expect, it, vi } from 'vitest'

import { streamFrom } from './llm-service'
import { createContinuationScope } from './request-context'
import { guardedRequestFetch } from './request-guard'

async function withHttpServer(handler: RequestListener, task: (url: URL) => Promise<void>) {
  const server = createServer(handler)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('Test server address unavailable')
  try {
    await task(new URL(`http://127.0.0.1:${address.port}/chat/completions`))
  }
  finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}

function completion(protocol: 'chat-completions' | 'responses') {
  const events = protocol === 'chat-completions'
    ? [{ choices: [{ index: 0, delta: { content: 'synthetic reply' }, finish_reason: 'stop' }] }]
    : [{ type: 'response.completed', response: { output: [], usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 } } }]
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
}

describe.each(['chat-completions', 'responses'] as const)('request authority: %s', (protocol) => {
  it('checks authority after async tool preparation and sends no stale HTTP', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => completion(protocol))
    let current = true
    const chatProvider: GenerationProvider = { generation: model => protocol === 'responses'
      ? { protocol, webSearch: false, config: { baseURL: 'https://synthetic.invalid/v1/', model, fetch } }
      : { protocol, config: { baseURL: 'https://synthetic.invalid/v1/', model, fetch } } }
    await expect(streamFrom({ model: 'synthetic', chatProvider, conversation: { turns: [] }, options: { assertCurrent() {
      if (!current)
        throw new DOMException('revoked', 'AbortError')
    } }, builtinToolsResolver: async () => {
      await Promise.resolve()
      current = false
      return []
    } })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('puts a finite output limit in the actual SDK HTTP payload', async () => {
    let body: Record<string, unknown> | undefined
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      body = JSON.parse(String(init?.body))
      return completion(protocol)
    })
    const chatProvider: GenerationProvider = { generation: model => protocol === 'responses'
      ? { protocol, webSearch: false, config: { baseURL: 'https://synthetic.invalid/v1/', model, fetch } }
      : { protocol, config: { baseURL: 'https://synthetic.invalid/v1/', model, fetch } } }
    await streamFrom({ model: 'synthetic', chatProvider, conversation: { turns: [] }, options: { maxOutputTokens: 128, assertCurrent() {} } })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(body?.[protocol === 'responses' ? 'max_output_tokens' : 'max_tokens']).toBe(128)
  })

  it('guards every actual fetch, including retries made by a provider', async () => {
    const fetch = vi.fn(async () => completion(protocol))
    const controller = new AbortController()
    const guarded = guardedRequestFetch(fetch, { abortSignal: controller.signal }, protocol)!
    await guarded(new URL('https://synthetic.invalid'), { body: '{}' })
    controller.abort()
    expect(() => guarded(new URL('https://synthetic.invalid'), { body: '{}' })).toThrow()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

it('isolates native continuation when the host memory epoch changes', () => {
  const config = { baseURL: 'https://synthetic.invalid/v1/', model: 'synthetic' }
  expect(createContinuationScope(config, { contextRevision: 'before' })).not.toBe(createContinuationScope(config, { contextRevision: 'after' }))
})

describe.each(['chat-completions', 'responses'] as const)('campaign send boundary: %s', (protocol) => {
  it('removes reflected credentials from unsuccessful native HTTP responses and accounts once', async () => {
    const canary = 'fixture-error-secret-3b638432'
    const transportFailed = vi.fn(async () => {})
    const observeResponse = vi.fn()
    const releaseNotSent = vi.fn(async () => {})
    await withHttpServer((request, response) => {
      response.writeHead(401, canary, { 'content-type': 'application/json', 'x-reflected-secret': String(request.headers.authorization) })
      response.end(JSON.stringify({ error: { message: request.headers.authorization } }))
    }, async (url) => {
      const guarded = guardedRequestFetch(undefined, { attemptGate: { maxOutputTokens: 128, begin: async () => ({ transportFailed, releaseNotSent, observeResponse }) } }, protocol)!
      const response = await guarded(url, { method: 'POST', body: '{}', headers: { authorization: `Bearer ${canary}` } })
      expect(response.status).toBe(401)
      expect(response.statusText).not.toContain(canary)
      expect(response.headers.get('x-reflected-secret')).toBeNull()
      expect(await response.json()).toEqual({ error: { code: 'ACCEPTANCE_HTTP_ERROR', status: 401 } })
      expect(transportFailed).toHaveBeenCalledTimes(1)
      expect(observeResponse).not.toHaveBeenCalled()
      expect(releaseNotSent).not.toHaveBeenCalled()
    })
  })

  it('hides raw transport errors without losing unknown-usage accounting', async () => {
    const transportFailed = vi.fn(async () => {})
    const releaseNotSent = vi.fn(async () => {})
    const observeResponse = vi.fn()
    const fetch = vi.fn(async () => {
      throw new Error('fixture-secret-in-network-error', { cause: new Error('fixture-secret-cause') })
    })
    const guarded = guardedRequestFetch(fetch, { attemptGate: { maxOutputTokens: 128, begin: async () => ({ transportFailed, releaseNotSent, observeResponse }) } }, protocol)!
    const error = await guarded(new URL('https://synthetic.invalid'), { body: '{}' }).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ message: 'Acceptance request failed' })
    expect(error).not.toHaveProperty('cause')
    expect(transportFailed).toHaveBeenCalledTimes(1)
    expect(releaseNotSent).not.toHaveBeenCalled()
    expect(observeResponse).not.toHaveBeenCalled()
  })

  it('preserves cancellation type while hiding the native fetch abort reason', async () => {
    const controller = new AbortController()
    const transportFailed = vi.fn(async () => {})
    const releaseNotSent = vi.fn(async () => {})
    await withHttpServer(() => {
      controller.abort(new DOMException('fixture-secret-in-abort', 'AbortError'))
    }, async (url) => {
      const guarded = guardedRequestFetch(undefined, { abortSignal: controller.signal, attemptGate: { maxOutputTokens: 128, begin: async () => ({ transportFailed, releaseNotSent, observeResponse: () => {} }) } }, protocol)!
      await expect(guarded(url, { method: 'POST', body: '{}', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError', message: 'Acceptance request cancelled' })
      expect(transportFailed).toHaveBeenCalledTimes(1)
      expect(releaseNotSent).not.toHaveBeenCalled()
    })
  })

  it('does not settle a rejected accounting operation twice or expose its error', async () => {
    const transportFailed = vi.fn(async () => {
      throw new Error('fixture-secret-in-accounting')
    })
    const guarded = guardedRequestFetch(async () => new Response('fixture-secret-response', { status: 429 }), {
      attemptGate: { maxOutputTokens: 128, begin: async () => ({ transportFailed, releaseNotSent: async () => {}, observeResponse: () => {} }) },
    }, protocol)!
    await expect(guarded(new URL('https://synthetic.invalid'), { body: '{}' })).rejects.toThrow('Acceptance request failed')
    expect(transportFailed).toHaveBeenCalledTimes(1)
  })

  it('preserves successful native SSE streaming and observes its independent branch once', async () => {
    const transportFailed = vi.fn(async () => {})
    let usageBody: Promise<string> | undefined
    const observeResponse = vi.fn((response: Response) => {
      usageBody = response.text()
    })
    let finish: (() => void) | undefined
    await withHttpServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: {"text":"first"}\n\n')
      finish = () => response.end('data: {"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n')
    }, async (url) => {
      const guarded = guardedRequestFetch(undefined, { attemptGate: { maxOutputTokens: 128, begin: async () => ({ transportFailed, releaseNotSent: async () => {}, observeResponse }) } }, protocol)!
      const response = await guarded(url, { method: 'POST', body: '{}' })
      const reader = response.body!.getReader()
      const first = await reader.read()
      expect(new TextDecoder().decode(first.value)).toBe('data: {"text":"first"}\n\n')
      expect(first.done).toBe(false)
      finish!()
      const chunks: string[] = []
      while (true) {
        const chunk = await reader.read()
        if (chunk.done)
          break
        chunks.push(new TextDecoder().decode(chunk.value))
      }
      reader.releaseLock()
      expect(chunks.join('')).toContain('"prompt_tokens":3')
      expect(await usageBody).toContain('"completion_tokens":2')
      expect(observeResponse).toHaveBeenCalledTimes(1)
      expect(transportFailed).not.toHaveBeenCalled()
    })
  })

  it('keeps non-campaign HTTP error responses unchanged', async () => {
    const original = new Response('ordinary-provider-error', { status: 403, statusText: 'Original status', headers: { 'x-provider-header': 'preserved' } })
    const guarded = guardedRequestFetch(async () => original, { assertCurrent() {} }, protocol)!
    const response = await guarded(new URL('https://synthetic.invalid'), { body: '{}' })
    expect(response).toBe(original)
    expect(await response.text()).toBe('ordinary-provider-error')
    expect(response.statusText).toBe('Original status')
    expect(response.headers.get('x-provider-header')).toBe('preserved')
  })

  it('rejects redirect following at the actual campaign fetch boundary', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => completion(protocol))
    const guarded = guardedRequestFetch(fetch, {
      attemptGate: { maxOutputTokens: 128, begin: async () => ({
        releaseNotSent: async () => {},
        transportFailed: async () => {},
        observeResponse: () => {},
      }) },
    }, protocol)!
    await guarded(new URL('https://synthetic.invalid/v1/chat/completions'), { body: '{"model":"synthetic"}', redirect: 'follow' })
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe('error')
  })

  it('rechecks authority after budget persistence and releases only an unsent attempt', async () => {
    let current = true
    const releaseNotSent = vi.fn(async () => {})
    const transportFailed = vi.fn(async () => {})
    const fetch = vi.fn(async () => completion(protocol))
    const guarded = guardedRequestFetch(fetch, {
      assertCurrent() {
        if (!current)
          throw new DOMException('changed while reserving', 'AbortError')
      },
      attemptGate: { maxOutputTokens: 128, begin: async ({ body, url }) => {
        expect(url.origin).toBe('https://synthetic.invalid')
        expect(JSON.parse(body)[protocol === 'responses' ? 'max_output_tokens' : 'max_tokens']).toBe(128)
        await Promise.resolve()
        current = false
        return { releaseNotSent, transportFailed, observeResponse: () => {} }
      } },
    }, protocol)!
    await expect(guarded(new URL('https://synthetic.invalid/v1/chat/completions'), { body: '{"model":"synthetic"}' })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
    expect(releaseNotSent).toHaveBeenCalledTimes(1)
    expect(transportFailed).not.toHaveBeenCalled()
  })

  it('measures the complete final request including tools and other input', async () => {
    const fetch = vi.fn(async () => completion(protocol))
    const guarded = guardedRequestFetch(fetch, { maxInputTokens: 2000 }, protocol)!
    expect(() => guarded(new URL('https://synthetic.invalid'), { body: JSON.stringify({ messages: [], tools: [{ description: 'x'.repeat(3000) }] }) })).toThrow('context budget')
    expect(fetch).not.toHaveBeenCalled()
  })
})
