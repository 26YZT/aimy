import type { RequestListener, Server } from 'node:http'

import type { AcceptanceCampaign } from '@proj-airi/stage-ui/stores/memory/budget'
import type { IpcMain, IpcMainEvent, WebContents, WebFrameMain } from 'electron'

import type { AuthorizedFetch } from './airi-baseline-adapter'
import type { BaselineRun } from './baseline-transport'

import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defineInvoke, defineInvokeEventa, defineInvokeHandler } from '@moeru/eventa'
import { createContext as createMainContext } from '@moeru/eventa/adapters/electron/main'
import { createContext as createRendererContext } from '@moeru/eventa/adapters/electron/renderer'
import { getDefinedProvider } from '@proj-airi/provider-inference'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AcceptanceBudgetLedger } from '../../src/main/services/aimy/acceptance-budget'
import { createBaselineRendererFetch } from './baseline-renderer-fetch'
import { registerBaselineTransport } from './baseline-transport'
import { BASELINE_CHUNK_BYTES, BASELINE_RESPONSE_BYTES, baselineTransportCancel, baselineTransportRead, baselineTransportStart } from './transport-events'

const campaign: AcceptanceCampaign = {
  campaignId: 'synthetic-eventa-campaign',
  maxCostMicroYuan: 10_000_000,
  price: { id: 'synthetic-eventa-price', currency: 'CNY', providerId: 'deepseek', modelId: 'synthetic-model', mode: 'synthetic', inputMicroYuanPerMillion: 1_000_000, outputMicroYuanPerMillion: 2_000_000, verifiedAt: 'synthetic', sourceUrl: 'https://example.invalid/synthetic' },
}
const definition = getDefinedProvider('deepseek')!
const directories: string[] = []
const servers: Server[] = []
const cleanups: Array<() => void> = []

function body() {
  return JSON.stringify({ model: 'synthetic-model', messages: [{ role: 'user', content: 'Synthetic input.' }], stream: true })
}

function end() {
  return 'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":7}}\n\ndata: [DONE]\n\n'
}

async function server(handler: RequestListener) {
  const result = createServer(handler)
  servers.push(result)
  await new Promise<void>(resolve => result.listen(0, '127.0.0.1', resolve))
  const address = result.address()
  if (!address || typeof address === 'string')
    throw new Error('Synthetic server port missing')
  return `http://127.0.0.1:${address.port}/chat/completions`
}

/** Only native Electron IPC objects are replaced. Both Eventa adapters run their actual protocol and serialization. */
function ipcFixture() {
  const emitter = new EventEmitter()
  const ipcMain = emitter as IpcMain
  const main = createMainContext(ipcMain)
  cleanups.push(main.dispose)
  const hostWire: unknown[] = []
  const clientWire: unknown[] = []
  function client(id: number) {
    const received = new EventEmitter()
    let destroyed = false
    let frame = {} as WebFrameMain
    const native = Object.assign(new EventEmitter(), {
      id,
      mainFrame: frame,
      isDestroyed: () => destroyed,
      send(channel: string, message: unknown) {
        const cloned = structuredClone(message)
        hostWire.push(cloned)
        queueMicrotask(() => received.emit(channel, {}, cloned))
      },
    })
    const sender = native as WebContents
    const ipcRenderer: Parameters<typeof createRendererContext>[0] = {
      on(channel, listener) {
        received.on(channel, listener)
        return () => {
          received.off(channel, listener)
        }
      },
      once(channel, listener) {
        received.once(channel, listener)
        return () => {
          received.off(channel, listener)
        }
      },
      removeListener(channel, listener) {
        received.off(channel, listener)
        return this
      },
      removeAllListeners(channel) { received.removeAllListeners(channel) },
      invoke: async () => { throw new Error('Unused native invoke') },
      postMessage() { throw new Error('Unused native postMessage') },
      sendSync() { throw new Error('Unused native sendSync') },
      sendTo() { throw new Error('Unused native sendTo') },
      sendToHost() { throw new Error('Unused native sendToHost') },
      send(channel: string, message: unknown) {
        const cloned = structuredClone(message)
        clientWire.push(cloned)
        const event = { sender, senderFrame: frame } as IpcMainEvent
        queueMicrotask(() => emitter.emit(channel, event, cloned))
      },
    }
    const renderer = createRendererContext(ipcRenderer)
    cleanups.push(renderer.dispose)
    return {
      context: renderer.context,
      sender,
      dispose: renderer.dispose,
      useSubframe() { frame = {} as WebFrameMain },
      navigate() { native.emit('did-start-navigation', {}, 'file:///synthetic-next', false, true) },
      destroy() {
        destroyed = true
        native.emit('destroyed')
      },
    }
  }
  return { main, client, hostWire, clientWire }
}

async function fixture(prepareTransport?: () => Promise<AuthorizedFetch>) {
  const ipc = ipcFixture()
  const directory = await mkdtemp(join(tmpdir(), 'aimy-eventa-transport-'))
  directories.push(directory)
  const filePath = join(directory, 'shared-ledger.json')
  const ledger = new AcceptanceBudgetLedger({ filePath, campaign })
  const run: BaselineRun = { arm: 'airi', caseId: 'synthetic-case', runId: 'synthetic-run', epoch: 1 }
  const send = vi.fn<AuthorizedFetch>(async () => new Response(end(), { headers: { 'content-type': 'text/event-stream' } }))
  const transport = registerBaselineTransport({ context: ipc.main.context, campaign, budget: ledger, providerDefinition: definition, getRun: () => run, authorizeSender: sender => sender.id === 1 || sender.id === 2, prepareTransport: prepareTransport ?? (async () => send) })
  cleanups.push(transport.dispose)
  const owner = ipc.client(1)
  return { ...ipc, owner, transport, run, ledger, filePath, send, fetch: createBaselineRendererFetch(owner.context, () => run.epoch) }
}

afterEach(async () => {
  vi.useRealTimers()
  cleanups.splice(0).reverse().forEach(cleanup => cleanup())
  for (const value of servers.splice(0)) {
    value.closeAllConnections()
    await new Promise<void>(resolve => value.close(() => resolve()))
  }
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('baseline Eventa transport', () => {
  it('delivers real HTTP SSE before completion with one ledger attempt and no authorization in Eventa', async () => {
    const finish = Promise.withResolvers<void>()
    const canary = 'synthetic-host-credential-canary'
    let nativeRequests = 0
    let auth: string | undefined
    const url = await server(async (incoming, outgoing) => {
      nativeRequests++
      auth = incoming.headers.authorization
      incoming.resume()
      outgoing.writeHead(200, { 'content-type': `text/event-stream; internal=${canary}` })
      outgoing.write('data: {"choices":[{"delta":{"content":"early"}}]}\n\n')
      await finish.promise
      outgoing.end(end())
    })
    const f = await fixture(async () => (url, request) => fetch(url, { ...request, headers: { 'content-type': 'application/json', 'authorization': `Bearer ${canary}` } }))
    const response = await f.fetch(url, { method: 'POST', body: body(), headers: { authorization: 'synthetic-renderer-placeholder' } })
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    const reader = response.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('early')
    expect((await f.ledger.status()).accountedMicroYuan).toBe(0)
    finish.resolve()
    let tail = ''
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read())
      tail += new TextDecoder().decode(chunk.value)
    expect(tail).toContain('prompt_tokens')
    await f.transport.flush()
    expect(nativeRequests).toBe(1)
    expect(auth).toBe(`Bearer ${canary}`)
    expect((await f.ledger.status()).attempts).toBe(1)
    expect((await f.ledger.status()).accountedMicroYuan).toBe(25)
    expect(JSON.stringify(f.hostWire)).not.toContain(canary)
    expect(JSON.stringify(f.clientWire)).not.toContain('synthetic-renderer-placeholder')
    expect(await readFile(f.filePath, 'utf8')).not.toContain(canary)
  })

  it('rejects a changed run during authorization before any reservation or send', async () => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const send = vi.fn<AuthorizedFetch>(async () => new Response(end()))
    const f = await fixture(async () => {
      entered.resolve()
      await release.promise
      return send
    })
    const pending = f.fetch('http://127.0.0.1:1/chat/completions', { method: 'POST', body: body() })
    const failure = expect(pending).rejects.toMatchObject({ code: 'stale-run' })
    await entered.promise
    f.run.epoch++
    release.resolve()
    await failure
    await f.transport.flush()
    expect(send).not.toHaveBeenCalled()
    expect((await f.ledger.status()).attempts).toBe(0)
  })

  it('consumes a pre-cancelled ID so a delayed start cannot send', async () => {
    const f = await fixture()
    const cancel = defineInvoke(f.owner.context, baselineTransportCancel)
    const start = defineInvoke(f.owner.context, baselineTransportStart)
    expect(await cancel({ requestId: 'pre-cancelled' })).toEqual({ ok: true, requestId: 'pre-cancelled' })
    expect(await start({ requestId: 'pre-cancelled', epoch: 1, url: 'http://127.0.0.1:1/chat/completions', body: body() })).toEqual({ ok: false, code: 'cancelled' })
    expect(f.send).not.toHaveBeenCalled()
    expect((await f.ledger.status()).attempts).toBe(0)
  })

  it('returns AbortError promptly while start is waiting and then suppresses the actual send', async () => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const send = vi.fn<AuthorizedFetch>(async () => new Response(end()))
    const f = await fixture(async () => {
      entered.resolve()
      await release.promise
      return send
    })
    const controller = new AbortController()
    const pending = f.fetch('http://127.0.0.1:1/chat/completions', { method: 'POST', body: body(), signal: controller.signal })
    const failure = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await entered.promise
    controller.abort('synthetic-private-cancel-reason')
    await failure
    release.resolve()
    await f.transport.flush()
    expect(send).not.toHaveBeenCalled()
    expect((await f.ledger.status()).attempts).toBe(0)
    expect(JSON.stringify(f.hostWire)).not.toContain('synthetic-private-cancel-reason')
  })

  it('isolates request ownership from another authorized window and rejects subframes', async () => {
    const f = await fixture()
    const start = defineInvoke(f.owner.context, baselineTransportStart)
    expect((await start({ requestId: 'owned-request', epoch: 1, url: 'http://127.0.0.1:1/chat/completions', body: body() })).ok).toBe(true)
    const other = f.client(2)
    expect(await defineInvoke(other.context, baselineTransportRead)({ requestId: 'owned-request' })).toEqual({ ok: false, code: 'permission-denied' })
    expect(await defineInvoke(other.context, baselineTransportCancel)({ requestId: 'owned-request' })).toEqual({ ok: false, code: 'permission-denied' })
    other.useSubframe()
    expect(await defineInvoke(other.context, baselineTransportStart)({ requestId: 'subframe-request', epoch: 1, url: 'http://127.0.0.1:1/chat/completions', body: body() })).toEqual({ ok: false, code: 'permission-denied' })
    expect((await defineInvoke(f.owner.context, baselineTransportRead)({ requestId: 'owned-request' })).ok).toBe(true)
    await f.transport.flush()
    expect(f.send).toHaveBeenCalledTimes(1)
  })

  it('rejects concurrent pulls without consuming another chunk', async () => {
    const finish = Promise.withResolvers<void>()
    const url = await server(async (incoming, outgoing) => {
      incoming.resume()
      outgoing.writeHead(200, { 'content-type': 'text/event-stream' }).flushHeaders()
      await finish.promise
      outgoing.end(end())
    })
    const f = await fixture(async () => fetch)
    const start = defineInvoke(f.owner.context, baselineTransportStart)
    const read = defineInvoke(f.owner.context, baselineTransportRead)
    await start({ requestId: 'pull-request', epoch: 1, url, body: body() })
    const pending = read({ requestId: 'pull-request' })
    expect(await read({ requestId: 'pull-request' })).toEqual({ ok: false, code: 'read-in-progress' })
    finish.resolve()
    const first = await pending
    expect(first.ok && first.chunk).toBeTruthy()
    expect(await read({ requestId: 'pull-request' })).toEqual({ ok: true, requestId: 'pull-request', done: true })
    await f.transport.flush()
  })

  it('cancels the native HTTP stream and retains unknown fees when the reader is cancelled', async () => {
    const closed = Promise.withResolvers<void>()
    const url = await server((incoming, outgoing) => {
      incoming.resume()
      outgoing.on('close', () => closed.resolve())
      outgoing.writeHead(200, { 'content-type': 'text/event-stream' })
      outgoing.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')
    })
    const f = await fixture(async () => fetch)
    const response = await f.fetch(url, { method: 'POST', body: body() })
    const reader = response.body!.getReader()
    expect((await reader.read()).done).toBe(false)
    await reader.cancel('synthetic-private-cancel')
    await closed.promise
    await expect(f.transport.flush()).rejects.toThrow('accounting incomplete')
    expect((await f.ledger.status()).pauseReason).toBe('usage-unknown')
    expect((await f.ledger.status()).reservedMicroYuan).toBeGreaterThan(0)
  })

  it('projects stream failures to a bounded code without sending their native cause', async () => {
    const broken = Promise.withResolvers<void>()
    const canary = 'synthetic-native-stream-secret'
    const f = await fixture(async () => async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[]}\n\n'))
        void broken.promise.then(() => controller.error(new Error(canary)))
      },
    }), { headers: { 'content-type': 'text/event-stream' } }))
    const response = await f.fetch('http://127.0.0.1:1/chat/completions', { method: 'POST', body: body() })
    const reader = response.body!.getReader()
    await reader.read()
    broken.resolve()
    await expect(reader.read()).rejects.toMatchObject({ code: 'stream-failed' })
    await expect(f.transport.flush()).rejects.toThrow('accounting incomplete')
    expect(JSON.stringify(f.hostWire)).not.toContain(canary)
    expect((await f.ledger.status()).paused).toBe(true)
  })

  it('bounds each response pull and rejects more than eight MiB', async () => {
    const text = `:${'x'.repeat(BASELINE_CHUNK_BYTES * 2)}\n\n${end()}`
    const f = await fixture(async () => async () => new Response(text, { headers: { 'content-type': 'text/event-stream' } }))
    const response = await f.fetch('http://127.0.0.1:1/chat/completions', { method: 'POST', body: body() })
    const sizes: number[] = []
    const reader = response.body!.getReader()
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read())
      sizes.push(chunk.value.byteLength)
    expect(sizes.every(size => size <= BASELINE_CHUNK_BYTES)).toBe(true)
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(new TextEncoder().encode(text).length)
    await f.transport.flush()

    const oversized = await fixture(async () => async () => new Response(new Uint8Array(BASELINE_RESPONSE_BYTES + 1)))
    const failed = await oversized.fetch('http://127.0.0.1:1/chat/completions', { method: 'POST', body: body() })
    await expect(failed.text()).rejects.toMatchObject({ code: 'stream-too-large' })
    await expect(oversized.transport.flush()).rejects.toThrow('accounting incomplete')
  })

  it('revokes navigation while authorization waits and removes only its own Eventa handlers', async () => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const send = vi.fn<AuthorizedFetch>(async () => new Response(end()))
    const f = await fixture(async () => {
      entered.resolve()
      await release.promise
      return send
    })
    const pending = f.fetch('http://127.0.0.1:1/chat/completions', { method: 'POST', body: body() })
    const rejected = expect(pending).rejects.toMatchObject({ code: 'permission-denied' })
    await entered.promise
    f.owner.navigate()
    release.resolve()
    await rejected
    expect(send).not.toHaveBeenCalled()
    const ping = defineInvokeEventa<number>('synthetic:unrelated-app-event')
    defineInvokeHandler(f.main.context, ping, () => 42)
    f.transport.dispose()
    expect(await defineInvoke(f.owner.context, ping)()).toBe(42)
  })

  it('rejects an Aimy run so the transport cannot double-charge the candidate arm', async () => {
    const f = await fixture()
    Object.assign(f.run, { arm: 'aimy' })
    await expect(f.fetch('http://127.0.0.1:1/chat/completions', { method: 'POST', body: body() })).rejects.toMatchObject({ code: 'invalid-run' })
    expect(f.send).not.toHaveBeenCalled()
    expect((await f.ledger.status()).attempts).toBe(0)
  })

  it('expires a stalled start without sending after authorization eventually returns', async () => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const send = vi.fn<AuthorizedFetch>(async () => new Response(end()))
    const f = await fixture(async () => {
      entered.resolve()
      await release.promise
      return send
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    const pending = f.fetch('http://127.0.0.1:1/chat/completions', { method: 'POST', body: body() })
    const rejected = expect(pending).rejects.toMatchObject({ code: 'timeout' })
    await entered.promise
    await vi.advanceTimersByTimeAsync(30_100)
    await rejected
    release.resolve()
    await f.transport.flush()
    expect(send).not.toHaveBeenCalled()
    expect(f.transport.summary().active).toBe(0)
    expect((await f.ledger.status()).attempts).toBe(0)
  })

  it('revokes destroyed senders while an authorization operation is pending', async () => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const send = vi.fn<AuthorizedFetch>(async () => new Response(end()))
    const f = await fixture(async () => {
      entered.resolve()
      await release.promise
      return send
    })
    const pending = f.fetch('http://127.0.0.1:1/chat/completions', { method: 'POST', body: body() })
    const rejected = expect(pending).rejects.toMatchObject({ code: 'transport-failed' })
    await entered.promise
    f.owner.destroy()
    f.owner.dispose()
    release.resolve()
    await rejected
    await f.transport.flush()
    expect(send).not.toHaveBeenCalled()
    expect(f.transport.summary().active).toBe(0)
    expect((await f.ledger.status()).attempts).toBe(0)
  })
})
