import type { AcceptanceCampaign } from '@proj-airi/stage-ui/stores/memory/budget'
import type { OnBeforeRequestListenerDetails, OnBeforeSendHeadersListenerDetails, Session, WebContents, WebFrameMain } from 'electron'

import type { LiveRequestClaims } from './live-request-claims'

import { AsyncLocalStorage } from 'node:async_hooks'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { syncBuiltinESMExports } from 'node:module'
import { Socket } from 'node:net'

import { describeAcceptanceRequest } from '@proj-airi/stage-ui/services/acceptance-generation'

import * as v from 'valibot'

interface RequestMetadata {
  id: string
  body: string
  arm: 'airi' | 'aimy'
  attemptId?: string
}

interface Options {
  phase: 'setup' | 'run'
  arm: 'airi' | 'aimy'
  campaign: AcceptanceCampaign
  localPorts: number[]
  session: Pick<Session, 'webRequest'>
  authorizeRenderer: (webContentsId: number, frame?: WebFrameMain) => boolean
  assertBindingCurrent: () => Promise<void>
  assertCurrent?: () => void
  claims?: LiveRequestClaims
  expectedAuthorization?: string
  onRequest: (metadata: RequestMetadata) => void
}

interface BrowserApproval {
  body: string
  attemptId: string
  url: string
  sender: WebContents
  frame: WebFrameMain
  frameUrl: string
  frameProcessId: number
  frameRoutingId: number
  invalidated: boolean
  sent: boolean
  dispose: () => void
}

const bodySchema = v.object({
  model: v.literal('deepseek-flash'),
  max_tokens: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(2048)),
  thinking: v.strictObject({ type: v.literal('disabled') }),
  messages: v.pipe(v.array(v.object({
    role: v.picklist(['system', 'developer', 'user', 'assistant']),
    content: v.union([v.string(), v.array(v.strictObject({ type: v.literal('text'), text: v.string() }))]),
    tool_calls: v.optional(v.never()),
    function_call: v.optional(v.never()),
  })), v.minLength(1)),
})

function denied(code = 'LIVE_NETWORK_DENIED'): never {
  throw new Error(code)
}

/**
 * Owns network admission for one dedicated acceptance host and its Chromium session.
 * Setup has no remote path. Run has one private native sender and one ledger-proven renderer path.
 *
 * Call stack:
 * AIRI adapter -> send -> binding check -> private fetch context -> guarded Node socket
 * Aimy fetch -> Chromium request -> one ledger claim -> binding check -> private header check
 */
export function installLiveNetworkPolicy(options: Options) {
  if (!['setup', 'run'].includes(options.phase) || !['airi', 'aimy'].includes(options.arm)
    || options.localPorts.some(port => !Number.isSafeInteger(port) || port < 1 || port > 65535)
    || options.campaign.price.providerId !== 'deepseek' || options.campaign.price.modelId !== 'deepseek-flash'
    || options.campaign.price.mode !== 'non-thinking'
    || (options.phase === 'run' && (!options.expectedAuthorization?.startsWith('Bearer ') || options.expectedAuthorization.slice(7).trim().length === 0 || /[\r\n]/.test(options.expectedAuthorization)))) {
    denied('LIVE_NETWORK_OPTIONS_INVALID')
  }
  const phase = options.phase
  const arm = options.arm
  const campaign = structuredClone(options.campaign)
  const expectedAuthorization = options.expectedAuthorization
  const localPorts = new Set(options.localPorts)
  const privateFetchContext = new AsyncLocalStorage<boolean>()
  const originalFetch = globalThis.fetch
  const originalConnect = Socket.prototype.connect
  const approvals = new Map<number, BrowserApproval>()
  const seenRequests = new Set<number>()
  const nativeControllers = new Set<AbortController>()
  let disposed = false
  const counts = { allowedNodeLocal: 0, allowedNodeRemote: 0, blockedNode: 0, allowedBrowserLocal: 0, allowedBrowserRemote: 0, allowedPreflight: 0, blockedBrowser: 0, authorizationRejected: 0, allowedNativeRequests: 0, failedNativeRequests: 0 }

  function local(url: URL) {
    return !url.username && !url.password && ['http:', 'ws:'].includes(url.protocol)
      && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) && localPorts.has(Number(url.port))
  }

  function endpoint(url: URL) {
    return url.origin === 'https://api.deepseek.com' && !url.username && !url.password && !url.search && !url.hash
      && ['/chat/completions', '/v1/chat/completions'].includes(url.pathname)
  }

  function assertBody(url: URL, body: unknown) {
    if (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > 64_000 || !endpoint(url))
      denied('LIVE_NETWORK_REQUEST_INVALID')
    try {
      const parsed = JSON.parse(body)
      v.parse(bodySchema, parsed)
      const measured = describeAcceptanceRequest(campaign, { id: 'deepseek' }, { url, protocol: 'chat-completions', body })
      if (measured.maxOutputTokens > 2048 || 'web_search_options' in parsed || 'plugins' in parsed)
        denied('LIVE_NETWORK_REQUEST_INVALID')
    }
    catch { denied('LIVE_NETWORK_REQUEST_INVALID') }
    return body
  }

  function authorization(headers: Headers) {
    if (!expectedAuthorization || headers.get('authorization') !== expectedAuthorization) {
      counts.authorizationRejected++
      denied('LIVE_NETWORK_AUTHORIZATION_DENIED')
    }
  }

  const guardedConnect = function (this: Socket, ...input: unknown[]) {
    const args = Array.isArray(input[0]) ? input[0] : input
    const first = args[0]
    const config = first && typeof first === 'object' ? first as Record<string, unknown> : undefined
    const port = config ? Number(config.port) : Number(first)
    const host = String(config?.host ?? (typeof args[1] === 'string' ? args[1] : 'localhost'))
    const socketPath = config?.path
    const allowedLocal = localPorts.has(port) && ['127.0.0.1', '::1', 'localhost'].includes(host)
    const allowedRemote = phase === 'run' && privateFetchContext.getStore() === true && host === 'api.deepseek.com' && port === 443
    if (disposed || (socketPath !== undefined && socketPath !== null) || (!allowedLocal && !allowedRemote)) {
      counts.blockedNode++
      denied('LIVE_NODE_NETWORK_DENIED')
    }
    if (allowedLocal)
      counts.allowedNodeLocal++
    else
      counts.allowedNodeRemote++
    return Reflect.apply(originalConnect, this, input)
  } as typeof originalConnect
  const guardedFetch: typeof globalThis.fetch = async (input, init) => {
    try {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (disposed || !local(url))
        denied('LIVE_NODE_NETWORK_DENIED')
      return await originalFetch(input, { ...init, redirect: 'error' })
    }
    catch {
      counts.blockedNode++
      denied('LIVE_NODE_NETWORK_DENIED')
    }
  }
  Socket.prototype.connect = guardedConnect
  globalThis.fetch = guardedFetch
  syncBuiltinESMExports()

  function clearApproval(id: number) {
    approvals.get(id)?.dispose()
    approvals.delete(id)
  }

  function browserIdentity(details: OnBeforeRequestListenerDetails | OnBeforeSendHeadersListenerDetails) {
    const sender = details.webContents
    const frame = details.frame
    if (disposed || phase !== 'run' || arm !== 'aimy' || !sender || sender.isDestroyed() || !frame
      || details.webContentsId !== sender.id || !options.authorizeRenderer(sender.id, frame)) {
      denied()
    }
    return { sender, frame }
  }

  function approvalCurrent(details: OnBeforeRequestListenerDetails | OnBeforeSendHeadersListenerDetails, approval: BrowserApproval) {
    const { sender, frame } = browserIdentity(details)
    if (approval.invalidated || sender !== approval.sender || frame !== approval.frame || details.url !== approval.url
      || frame.url !== approval.frameUrl || frame.processId !== approval.frameProcessId || frame.routingId !== approval.frameRoutingId) {
      denied()
    }
  }

  function uploadBody(details: OnBeforeRequestListenerDetails) {
    if (!Array.isArray(details.uploadData) || details.uploadData.length === 0)
      denied('LIVE_NETWORK_REQUEST_INVALID')
    let bytes = 0
    const chunks = details.uploadData.map((part) => {
      if (part.file !== undefined || part.blobUUID !== undefined || !Buffer.isBuffer(part.bytes))
        denied('LIVE_NETWORK_REQUEST_INVALID')
      bytes += part.bytes.length
      if (bytes > 64_000)
        denied('LIVE_NETWORK_REQUEST_INVALID')
      return part.bytes
    })
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
    }
    catch { denied('LIVE_NETWORK_REQUEST_INVALID') }
  }

  options.session.webRequest.onBeforeRequest((details, callback) => {
    void (async () => {
      try {
        if (disposed)
          denied()
        const url = new URL(details.url)
        if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) {
          callback({ cancel: false })
          return
        }
        if (local(url)) {
          counts.allowedBrowserLocal++
          callback({ cancel: false })
          return
        }
        if (!endpoint(url))
          denied()
        const { sender, frame } = browserIdentity(details)
        if (details.method === 'OPTIONS') {
          counts.allowedPreflight++
          callback({ cancel: false })
          return
        }
        if (details.method !== 'POST' || !options.claims || seenRequests.has(details.id))
          denied()
        seenRequests.add(details.id)
        const body = assertBody(url, uploadBody(details))
        const approval: BrowserApproval = {
          body,
          attemptId: '',
          url: details.url,
          sender,
          frame,
          frameUrl: frame.url,
          frameProcessId: frame.processId,
          frameRoutingId: frame.routingId,
          invalidated: false,
          sent: false,
          dispose: () => {},
        }
        const invalidate = () => {
          approval.invalidated = true
        }
        sender.on('did-start-navigation', invalidate)
        sender.on('destroyed', invalidate)
        approval.dispose = () => {
          sender.removeListener('did-start-navigation', invalidate)
          sender.removeListener('destroyed', invalidate)
        }
        approvals.set(details.id, approval)
        const claim = await options.claims.claim(body)
        approval.attemptId = claim.attemptId
        approvalCurrent(details, approval)
        await options.assertBindingCurrent()
        approvalCurrent(details, approval)
        callback({ cancel: false })
      }
      catch {
        clearApproval(details.id)
        counts.blockedBrowser++
        callback({ cancel: true })
      }
    })()
  })

  options.session.webRequest.onBeforeSendHeaders((details, callback) => {
    void (async () => {
      try {
        if (disposed)
          denied()
        const url = new URL(details.url)
        if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || local(url)) {
          callback({ cancel: false })
          return
        }
        if (!endpoint(url))
          denied()
        browserIdentity(details)
        if (details.method === 'OPTIONS') {
          callback({ cancel: false })
          return
        }
        const approval = approvals.get(details.id)
        if (details.method !== 'POST' || !approval || approval.sent)
          denied()
        approvalCurrent(details, approval)
        authorization(new Headers(details.requestHeaders))
        await options.assertBindingCurrent()
        approvalCurrent(details, approval)
        authorization(new Headers(details.requestHeaders))
        approval.sent = true
        options.onRequest({ id: String(details.id), body: approval.body, arm, attemptId: approval.attemptId })
        approvalCurrent(details, approval)
        counts.allowedBrowserRemote++
        callback({ cancel: false })
      }
      catch {
        clearApproval(details.id)
        counts.blockedBrowser++
        callback({ cancel: true })
      }
    })()
  })
  options.session.webRequest.onCompleted(details => clearApproval(details.id))
  options.session.webRequest.onErrorOccurred(details => clearApproval(details.id))

  return {
    /** Native sender is inaccessible to renderer code. The AIRI adapter has already reserved its request. */
    async send(url: URL, init: RequestInit): Promise<Response> {
      let invoked = false
      const controller = new AbortController()
      try {
        if (disposed || phase !== 'run' || arm !== 'airi' || init.method?.toUpperCase() !== 'POST' || init.signal?.aborted)
          denied()
        options.assertCurrent?.()
        const body = assertBody(url, init.body)
        const headers = new Headers(init.headers)
        authorization(headers)
        await options.assertBindingCurrent()
        options.assertCurrent?.()
        if (disposed || init.signal?.aborted)
          denied()
        options.onRequest({ id: randomUUID(), body, arm })
        if (disposed || init.signal?.aborted)
          denied()
        // Retain cancellation through the unwrapped response stream until this bounded host closes.
        nativeControllers.add(controller)
        const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal
        return await privateFetchContext.run(true, () => {
          // Binding validation awaited disk IO. Recheck the window epoch synchronously at the final send boundary.
          options.assertCurrent?.()
          invoked = true
          counts.allowedNativeRequests++
          return originalFetch(url, { method: 'POST', headers, body, signal, redirect: 'error' })
        })
      }
      catch {
        nativeControllers.delete(controller)
        if (invoked)
          counts.failedNativeRequests++
        else
          counts.blockedNode++
        denied('LIVE_NATIVE_REQUEST_DENIED')
      }
    },
    summary() { return { phase, arm, disposed, pendingBrowserRequests: approvals.size, ...counts } },
    dispose() {
      if (disposed)
        return
      disposed = true
      for (const controller of nativeControllers)
        controller.abort()
      nativeControllers.clear()
      for (const id of approvals.keys())
        clearApproval(id)
      // This dedicated session has one hook owner. Clear only the four hooks installed above.
      options.session.webRequest.onBeforeRequest(null)
      options.session.webRequest.onBeforeSendHeaders(null)
      options.session.webRequest.onCompleted(null)
      options.session.webRequest.onErrorOccurred(null)
      if (globalThis.fetch === guardedFetch)
        globalThis.fetch = originalFetch
      if (Socket.prototype.connect === guardedConnect)
        Socket.prototype.connect = originalConnect
      syncBuiltinESMExports()
      privateFetchContext.disable()
    },
  }
}
