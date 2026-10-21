import type { createContext } from '@moeru/eventa/adapters/electron/renderer'

import type { BaselineTransportCode, BaselineTransportFailure } from './transport-events'

import { defineInvoke } from '@moeru/eventa'
import { nanoid } from 'nanoid'

import { BASELINE_CHUNK_BYTES, BASELINE_RESPONSE_BYTES, baselineTransportCancel, baselineTransportRead, baselineTransportStart } from './transport-events'

/** Renderer errors expose only the host's bounded code and status. */
export class BaselineRendererError extends Error {
  readonly code: BaselineTransportCode
  readonly status?: number
  constructor(failure: BaselineTransportFailure) {
    super(`Baseline transport: ${failure.code}`)
    this.name = 'BaselineRendererError'
    this.code = failure.code
    this.status = failure.status
  }
}

function failure(code: BaselineTransportCode) {
  return new BaselineRendererError({ ok: false, code })
}

function aborted() {
  return new DOMException('Baseline request cancelled', 'AbortError')
}

/**
 * Adapts the original SDK fetch contract to bounded Eventa pulls. Headers and credentials never enter the start event.
 *
 * Call stack:
 * baseline SDK -> renderer fetch -> host start -> response pull -> host read
 *                              -> signal/cancel -> host cancel
 */
export function createBaselineRendererFetch(context: ReturnType<typeof createContext>['context'], getEpoch: () => number): typeof fetch {
  const start = defineInvoke(context, baselineTransportStart)
  const read = defineInvoke(context, baselineTransportRead)
  const cancel = defineInvoke(context, baselineTransportCancel)

  return async (input, init) => {
    let request: Request
    try {
      request = new Request(input, init)
    }
    catch {
      throw failure('invalid-input')
    }
    if (request.method !== 'POST')
      throw failure('invalid-input')
    const url = new URL(request.url)
    if (url.username || url.password || url.search || url.hash)
      throw failure('invalid-input')
    const requestId = nanoid()
    const capturedEpoch = getEpoch()
    let finished = false
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined
    let received = 0
    let rejectAbort: (error: Error) => void = () => {}
    const abortResult = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject
    })
    void abortResult.catch(() => {})
    const sendCancel = async () => {
      try {
        await cancel({ requestId })
      }
      catch { /* A failed bridge never permits a new send. The host also expires active requests. */ }
    }
    const cleanup = () => {
      finished = true
      request.signal.removeEventListener('abort', onAbort)
    }
    function onAbort() {
      if (finished)
        return
      rejectAbort(aborted())
      void sendCancel()
      if (bodyController) {
        bodyController.error(aborted())
        cleanup()
      }
    }
    function assertCurrent() {
      if (request.signal.aborted)
        throw aborted()
      if (capturedEpoch !== getEpoch())
        throw failure('stale-run')
    }
    async function bounded<T>(operation: Promise<T>): Promise<T> {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        return await Promise.race([
          operation,
          abortResult,
          new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(failure('timeout')), 30_000) }),
        ])
      }
      finally {
        if (timer)
          clearTimeout(timer)
      }
    }

    request.signal.addEventListener('abort', onAbort, { once: true })
    try {
      assertCurrent()
      const body = await request.text()
      assertCurrent()
      if (new TextEncoder().encode(body).length > 64_000)
        throw failure('invalid-input')
      // Pre-cancelled host IDs remain consumed. A cancel can safely arrive before this start.
      const result = await bounded(start({ requestId, epoch: capturedEpoch, url: request.url, body }))
      assertCurrent()
      if (!result.ok)
        throw new BaselineRendererError(result)
      if (result.requestId !== requestId)
        throw failure('request-conflict')
      if ([204, 205, 304].includes(result.status)) {
        cleanup()
        return new Response(null, { status: result.status })
      }
      const stream = new ReadableStream<Uint8Array>({
        start(controller) { bodyController = controller },
        async pull(controller) {
          if (finished)
            return
          try {
            assertCurrent()
            const result = await bounded(read({ requestId }))
            if (finished)
              return
            assertCurrent()
            if (!result.ok)
              throw new BaselineRendererError(result)
            if (result.requestId !== requestId)
              throw failure('request-conflict')
            if (result.done) {
              cleanup()
              controller.close()
              return
            }
            if (typeof result.chunk !== 'string' || result.chunk.length > Math.ceil(BASELINE_CHUNK_BYTES / 3) * 4)
              throw failure('stream-too-large')
            const decoded = atob(result.chunk)
            received += decoded.length
            if (decoded.length > BASELINE_CHUNK_BYTES || received > BASELINE_RESPONSE_BYTES)
              throw failure('stream-too-large')
            controller.enqueue(Uint8Array.from(decoded, value => value.charCodeAt(0)))
          }
          catch (error) {
            if (!finished) {
              cleanup()
              controller.error(error instanceof BaselineRendererError || (error instanceof Error && error.name === 'AbortError') ? error : failure('stream-failed'))
              void sendCancel()
            }
          }
        },
        async cancel() {
          cleanup()
          await bounded(sendCancel()).catch(() => {})
        },
      })
      return new Response(stream, { status: result.status, headers: { 'content-type': result.contentType } })
    }
    catch (error) {
      cleanup()
      void sendCancel()
      if (error instanceof BaselineRendererError || (error instanceof Error && error.name === 'AbortError'))
        throw error
      throw failure('transport-failed')
    }
  }
}
