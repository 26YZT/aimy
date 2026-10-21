import type { AcceptanceCampaign } from '@proj-airi/stage-ui/stores/memory/budget'
import type { OnBeforeRequestListenerDetails, OnBeforeSendHeadersListenerDetails, Session, WebContents, WebFrameMain } from 'electron'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { connect, Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describeAcceptanceRequest } from '@proj-airi/stage-ui/services/acceptance-generation'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AcceptanceBudgetLedger } from '../../src/main/services/aimy/acceptance-budget'
import { installLiveNetworkPolicy } from './live-network'
import { LiveRequestClaims } from './live-request-claims'

const campaign: AcceptanceCampaign = {
  campaignId: 'synthetic-live-network',
  maxCostMicroYuan: 10_000_000,
  price: { id: 'synthetic-price', currency: 'CNY', providerId: 'deepseek', modelId: 'deepseek-flash', mode: 'non-thinking', inputMicroYuanPerMillion: 1_000_000, outputMicroYuanPerMillion: 2_000_000, verifiedAt: 'synthetic-only', sourceUrl: 'https://example.invalid/prices' },
}
const body = JSON.stringify({ model: 'deepseek-flash', thinking: { type: 'disabled' }, max_tokens: 128, stream: true, messages: [{ role: 'user', content: 'fictional test' }] })
const endpoint = new URL('https://api.deepseek.com/chat/completions')
const expectedAuthorization = 'Bearer synthetic-network-canary'
const policies: ReturnType<typeof installLiveNetworkPolicy>[] = []
const directories: string[] = []

afterEach(async () => {
  policies.splice(0).reverse().forEach(policy => policy.dispose())
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function electronFixture() {
  let before: Parameters<Session['webRequest']['onBeforeRequest']>[0]
  let headers: Parameters<Session['webRequest']['onBeforeSendHeaders']>[0]
  let completed: Parameters<Session['webRequest']['onCompleted']>[0]
  let failed: Parameters<Session['webRequest']['onErrorOccurred']>[0]
  // Native Electron boundary: the test supplies only the four hooks consumed by this policy.
  const session = { webRequest: {
    onBeforeRequest: (listener: typeof before) => { before = listener },
    onBeforeSendHeaders: (listener: typeof headers) => { headers = listener },
    onCompleted: (listener: typeof completed) => { completed = listener },
    onErrorOccurred: (listener: typeof failed) => { failed = listener },
  } } as Pick<Session, 'webRequest'>
  const emitter = Object.assign(new EventEmitter(), { id: 7, isDestroyed: () => false })
  const sender = emitter as WebContents
  const frame = { url: 'file:///synthetic/index.html', processId: 11, routingId: 22 } as WebFrameMain
  const details: OnBeforeRequestListenerDetails = { id: 1, url: endpoint.href, method: 'POST', webContentsId: sender.id, webContents: sender, frame, resourceType: 'xhr', referrer: '', timestamp: 1, uploadData: [{ bytes: Buffer.from(body) }] }
  const headerDetails = (request: OnBeforeRequestListenerDetails, authorization = expectedAuthorization): OnBeforeSendHeadersListenerDetails => ({ ...request, requestHeaders: { 'Authorization': authorization, 'Content-Type': 'application/json' } })
  return {
    session,
    emitter,
    sender,
    frame,
    details,
    request: (request = details) => new Promise<{ cancel?: boolean }>((accept) => {
      if (!before)
        throw new Error('TEST_HOOK_MISSING')
      before(request, accept)
    }),
    headers: (request = headerDetails(details)) => new Promise<{ cancel?: boolean }>((accept) => {
      if (!headers)
        throw new Error('TEST_HOOK_MISSING')
      headers(request, accept)
    }),
    headerDetails,
    hasHooks: () => Boolean(before || headers || completed || failed),
  }
}

async function claimsFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'aimy-network-claims-'))
  directories.push(directory)
  const ledgerPath = join(directory, 'ledger.json')
  const ledger = new AcceptanceBudgetLedger({ filePath: ledgerPath, campaign })
  const options = { ledgerPath, campaignId: campaign.campaignId, runId: 'synthetic-run', caseId: 'USER-V2-01', arm: 'aimy' as const, ownerPid: process.pid }
  const claims = new LiveRequestClaims(options)
  async function start(id: string, payload = body) {
    const attempt = {
      ...describeAcceptanceRequest(campaign, { id: 'deepseek' }, { url: endpoint, protocol: 'chat-completions', body: payload }),
      attemptId: id,
      requestId: id,
      runId: options.runId,
      caseId: options.caseId,
      arm: 'aimy' as const,
      purpose: 'chat' as const,
      requestBodySha256: createHash('sha256').update(payload).digest('hex'),
    }
    await ledger.started(await ledger.reserve(attempt))
  }
  return { claims, start }
}

function install(overrides: Partial<Parameters<typeof installLiveNetworkPolicy>[0]> = {}, fixture = electronFixture()) {
  const onRequest = vi.fn()
  const assertBindingCurrent = vi.fn(async () => {})
  const policy = installLiveNetworkPolicy({ phase: 'run', arm: 'aimy', campaign, localPorts: [], session: fixture.session, authorizeRenderer: (id, frame) => id === fixture.sender.id && frame === fixture.frame, assertBindingCurrent, expectedAuthorization, onRequest, ...overrides })
  policies.push(policy)
  return { policy, fixture, onRequest, assertBindingCurrent }
}

describe('live acceptance network policy', () => {
  it('permits only exact loopback ports while setup has zero remote egress', async () => {
    const server = createServer((_request, response) => response.end('local fixture'))
    await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept))
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('TEST_PORT_MISSING')
    const { policy, fixture, onRequest } = install({ phase: 'setup', localPorts: [address.port], expectedAuthorization: undefined })
    try {
      expect(await (await fetch(`http://127.0.0.1:${address.port}`)).text()).toBe('local fixture')
      await expect(fetch(endpoint)).rejects.toThrow('LIVE_NODE_NETWORK_DENIED')
      expect(() => connect({ host: 'api.deepseek.com', port: 443 })).toThrow('LIVE_NODE_NETWORK_DENIED')
      expect(await fixture.request()).toEqual({ cancel: true })
      expect(await fixture.request({ ...fixture.details, method: 'OPTIONS' })).toEqual({ cancel: true })
      await expect(policy.send(endpoint, { method: 'POST', body })).rejects.toThrow('LIVE_NATIVE_REQUEST_DENIED')
      expect(onRequest).not.toHaveBeenCalled()
    }
    finally {
      policy.dispose()
      server.closeAllConnections()
      await new Promise<void>(accept => server.close(() => accept()))
    }
  })

  it('requires a real started ledger claim and admits it only once', async () => {
    const { claims, start } = await claimsFixture()
    const { fixture, onRequest, policy } = install({ claims })
    expect(await fixture.request()).toEqual({ cancel: true })
    await start('started')
    const next = { ...fixture.details, id: 2 }
    expect(await fixture.request(next)).toEqual({ cancel: false })
    expect(await fixture.headers(fixture.headerDetails(next))).toEqual({ cancel: false })
    expect(onRequest).toHaveBeenCalledWith({ id: '2', body, arm: 'aimy', attemptId: 'started' })
    expect(await fixture.headers(fixture.headerDetails(next))).toEqual({ cancel: true })
    expect(await fixture.request({ ...next, id: 3 })).toEqual({ cancel: true })
    expect(policy.summary().allowedBrowserRemote).toBe(1)
    expect(JSON.stringify(onRequest.mock.calls)).not.toContain('synthetic-network-canary')
  })

  it('blocks a renderer without claims and blocks AIRI renderer direct requests', async () => {
    const first = install()
    expect(await first.fixture.request()).toEqual({ cancel: true })
    first.policy.dispose()
    const next = install({ arm: 'airi' })
    expect(await next.fixture.request()).toEqual({ cancel: true })
    expect(await next.fixture.request({ ...next.fixture.details, method: 'OPTIONS' })).toEqual({ cancel: true })
  })

  it('rejects wrong authorization before the browser sends bytes', async () => {
    const { claims, start } = await claimsFixture()
    await start('wrong-key')
    const { fixture, policy, onRequest } = install({ claims })
    expect(await fixture.request()).toEqual({ cancel: false })
    expect(await fixture.headers(fixture.headerDetails(fixture.details, 'Bearer wrong-key'))).toEqual({ cancel: true })
    expect(policy.summary().authorizationRejected).toBe(1)
    expect(onRequest).not.toHaveBeenCalled()
  })

  it('rechecks the binding at the actual header boundary', async () => {
    const { claims, start } = await claimsFixture()
    await start('stale-key')
    const { fixture, assertBindingCurrent, onRequest } = install({ claims })
    expect(await fixture.request()).toEqual({ cancel: false })
    assertBindingCurrent.mockRejectedValue(new Error('synthetic stale binding'))
    expect(await fixture.headers()).toEqual({ cancel: true })
    expect(onRequest).not.toHaveBeenCalled()
  })

  it('rejects navigation during an awaited binding check even if the URL returns unchanged', async () => {
    const { claims, start } = await claimsFixture()
    await start('navigation')
    const fixture = electronFixture()
    const { onRequest } = install({ claims, assertBindingCurrent: async () => {
      fixture.emitter.emit('did-start-navigation')
    } }, fixture)
    expect(await fixture.request()).toEqual({ cancel: true })
    expect(onRequest).not.toHaveBeenCalled()
    expect(fixture.emitter.listenerCount('did-start-navigation')).toBe(0)
  })

  it('rejects an unauthorized frame after asynchronous admission work', async () => {
    const { claims, start } = await claimsFixture()
    await start('frame')
    let authorized = true
    const { fixture, onRequest } = install({ claims, authorizeRenderer: () => authorized, assertBindingCurrent: async () => {
      authorized = false
    } })
    expect(await fixture.request()).toEqual({ cancel: true })
    expect(onRequest).not.toHaveBeenCalled()
  })

  it.each(['https://other.invalid/chat/completions', 'https://api.deepseek.com/models', 'https://api.deepseek.com/chat/completions?key=bad', 'https://api.deepseek.com/chat/completions#bad', 'http://api.deepseek.com/chat/completions'])('rejects unapproved destination %s', async (url) => {
    const { fixture, onRequest } = install()
    expect(await fixture.request({ ...fixture.details, url })).toEqual({ cancel: true })
    expect(onRequest).not.toHaveBeenCalled()
  })

  it('rejects invalid UTF8 and file or blob uploads', async () => {
    const { claims } = await claimsFixture()
    const { fixture } = install({ claims })
    for (const [index, uploadData] of [[{ bytes: Buffer.from([0xFF]) }], [{ bytes: Buffer.from(body), file: '/not-read' }], [{ bytes: Buffer.from(body), blobUUID: 'not-read' }]].entries())
      expect(await fixture.request({ ...fixture.details, id: index + 10, uploadData })).toEqual({ cancel: true })
  })

  it('allows only the official Aimy preflight and never labels it as a paid request', async () => {
    const { fixture, policy, onRequest } = install()
    const request = { ...fixture.details, method: 'OPTIONS', uploadData: [] }
    expect(await fixture.request(request)).toEqual({ cancel: false })
    expect(await fixture.headers(fixture.headerDetails(request, ''))).toEqual({ cancel: false })
    expect(policy.summary().allowedPreflight).toBe(1)
    expect(onRequest).not.toHaveBeenCalled()
  })

  it('keeps native streaming intact and forces redirect rejection', async () => {
    const firstChunk = 'data: {"choices":[]}\n\n'
    const native = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(firstChunk))
    } }), { headers: { 'content-type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', native)
    const { policy, onRequest } = install({ arm: 'airi' })
    const response = await policy.send(endpoint, { method: 'POST', body, headers: { Authorization: expectedAuthorization }, redirect: 'follow' })
    expect(native).toHaveBeenCalledTimes(1)
    expect(native.mock.calls[0][1]?.redirect).toBe('error')
    const reader = response.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(firstChunk)
    await reader.cancel()
    expect(onRequest).toHaveBeenCalledTimes(1)
    await expect(fetch(endpoint)).rejects.toThrow('LIVE_NODE_NETWORK_DENIED')
    expect(native).toHaveBeenCalledTimes(1)
  })

  it('restricts official Node sockets to the private fetch context', async () => {
    const original = vi.spyOn(Socket.prototype, 'connect').mockImplementation(function (this: Socket) {
      return this
    })
    vi.stubGlobal('fetch', vi.fn(async () => {
      new Socket().connect({ host: 'api.deepseek.com', port: 443 })
      return new Response('synthetic response')
    }))
    const { policy } = install({ arm: 'airi' })
    expect(() => new Socket().connect({ host: 'api.deepseek.com', port: 443 })).toThrow('LIVE_NODE_NETWORK_DENIED')
    expect(original).not.toHaveBeenCalled()
    await policy.send(endpoint, { method: 'POST', body, headers: { Authorization: expectedAuthorization } })
    expect(original).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid provider, native payloads and keys with no native invocation', async () => {
    const native = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', native)
    expect(() => install({ campaign: { ...campaign, price: { ...campaign.price, providerId: 'other' } } })).toThrow('LIVE_NETWORK_OPTIONS_INVALID')
    const { policy } = install({ arm: 'airi' })
    const parsed = JSON.parse(body)
    for (const payload of [{ ...parsed, model: 'other' }, { ...parsed, thinking: { type: 'enabled' } }, { ...parsed, max_tokens: 2049 }, { ...parsed, tools: [{}] }, { ...parsed, messages: [{ role: 'tool', content: 'secret' }] }])
      await expect(policy.send(endpoint, { method: 'POST', body: JSON.stringify(payload), headers: { Authorization: expectedAuthorization } })).rejects.toThrow('LIVE_NATIVE_REQUEST_DENIED')
    await expect(policy.send(endpoint, { method: 'POST', body, headers: { Authorization: 'Bearer wrong' } })).rejects.toThrow('LIVE_NATIVE_REQUEST_DENIED')
    expect(native).not.toHaveBeenCalled()
  })

  it('rejects destroyed or missing frames before browser headers leave', async () => {
    const { claims, start } = await claimsFixture()
    await start('destroyed')
    const { fixture, onRequest } = install({ claims })
    expect(await fixture.request({ ...fixture.details, id: 2, frame: null })).toEqual({ cancel: true })
    expect(await fixture.request()).toEqual({ cancel: false })
    fixture.emitter.emit('destroyed')
    expect(await fixture.headers()).toEqual({ cancel: true })
    expect(onRequest).not.toHaveBeenCalled()
  })

  it('rejects oversized browser uploads without consuming the valid claim', async () => {
    const { claims, start } = await claimsFixture()
    await start('bounded')
    const { fixture } = install({ claims })
    expect(await fixture.request({ ...fixture.details, id: 2, uploadData: [{ bytes: Buffer.alloc(64_001, 65) }] })).toEqual({ cancel: true })
    expect(await fixture.request()).toEqual({ cancel: false })
    expect(await fixture.headers()).toEqual({ cancel: false })
  })

  it('aborts native response streams when its host is disposed', async () => {
    const native = vi.fn<typeof fetch>().mockResolvedValue(new Response('synthetic stream'))
    vi.stubGlobal('fetch', native)
    const { policy } = install({ arm: 'airi' })
    await policy.send(endpoint, { method: 'POST', body, headers: { Authorization: expectedAuthorization } })
    const signal = native.mock.calls[0][1]?.signal
    expect(signal?.aborted).toBe(false)
    policy.dispose()
    expect(signal?.aborted).toBe(true)
  })

  it('counts failed native transport as admitted, not as a denied request', async () => {
    const native = vi.fn<typeof fetch>().mockRejectedValue(new Error('fixture network failure'))
    vi.stubGlobal('fetch', native)
    const { policy } = install({ arm: 'airi' })
    await expect(policy.send(endpoint, { method: 'POST', body, headers: { Authorization: expectedAuthorization } })).rejects.toThrow('LIVE_NATIVE_REQUEST_DENIED')
    expect(policy.summary().allowedNativeRequests).toBe(1)
    expect(policy.summary().failedNativeRequests).toBe(1)
    expect(policy.summary().blockedNode).toBe(0)
  })

  it('rejects a revoked window epoch after delayed binding validation and before native fetch', async () => {
    const native = vi.fn<typeof fetch>().mockResolvedValue(new Response('must not send'))
    vi.stubGlobal('fetch', native)
    let current = true
    let finish: (() => void) | undefined
    const binding = new Promise<void>((accept) => {
      finish = accept
    })
    const assertCurrent = vi.fn(() => {
      if (!current)
        throw new Error('synthetic epoch revoked')
    })
    const { policy, onRequest } = install({ arm: 'airi', assertBindingCurrent: () => binding, assertCurrent })
    const sent = policy.send(endpoint, { method: 'POST', body, headers: { Authorization: expectedAuthorization } })
    current = false
    finish?.()
    await expect(sent).rejects.toThrow('LIVE_NATIVE_REQUEST_DENIED')
    expect(native).not.toHaveBeenCalled()
    expect(onRequest).not.toHaveBeenCalled()
    expect(policy.summary().allowedNativeRequests).toBe(0)
  })

  it('runs the final synchronous guard after instrumentation and immediately before native fetch', async () => {
    const native = vi.fn<typeof fetch>().mockResolvedValue(new Response('must not send'))
    vi.stubGlobal('fetch', native)
    let current = true
    const { policy } = install({ arm: 'airi', onRequest: () => {
      current = false
    }, assertCurrent: () => {
      if (!current)
        throw new Error('synthetic epoch revoked')
    } })
    await expect(policy.send(endpoint, { method: 'POST', body, headers: { Authorization: expectedAuthorization } })).rejects.toThrow('LIVE_NATIVE_REQUEST_DENIED')
    expect(native).not.toHaveBeenCalled()
    expect(policy.summary().allowedNativeRequests).toBe(0)
  })

  it('cancels pending native admission when disposed and removes only owned hooks', async () => {
    const native = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', native)
    let finish: (() => void) | undefined
    const wait = new Promise<void>((accept) => {
      finish = accept
    })
    const { fixture, policy } = install({ arm: 'airi', assertBindingCurrent: () => wait })
    const task = policy.send(endpoint, { method: 'POST', body, headers: { Authorization: expectedAuthorization } })
    policy.dispose()
    finish?.()
    await expect(task).rejects.toThrow('LIVE_NATIVE_REQUEST_DENIED')
    expect(native).not.toHaveBeenCalled()
    expect(fixture.hasHooks()).toBe(false)
    expect(globalThis.fetch).toBe(native)
  })
})
