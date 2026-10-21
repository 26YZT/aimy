import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { AcceptanceProviderDefinition } from '@proj-airi/stage-ui/services/acceptance-generation'
import type { AcceptanceBudgetPort, AcceptanceCampaign } from '@proj-airi/stage-ui/stores/memory/budget'
import type { IpcMainEvent, WebContents, WebFrameMain } from 'electron'

import type { AuthorizedFetch } from './airi-baseline-adapter'
import type { BaselineCancelResult, BaselineReadResult, BaselineStartResult, BaselineTransportCode, BaselineTransportFailure } from './transport-events'

import { Buffer } from 'node:buffer'

import { defineInvokeHandler } from '@moeru/eventa'
import { AcceptanceBudgetError } from '@proj-airi/stage-ui/stores/memory/budget'

import * as v from 'valibot'

import { AiriBaselineAdapter, BaselineAcceptanceError } from './airi-baseline-adapter'
import { BASELINE_CHUNK_BYTES, BASELINE_RESPONSE_BYTES, baselineTransportCancel, baselineTransportRead, baselineTransportStart } from './transport-events'

/** Only the runner changes this authority. Renderer requests carry an epoch, never a replacement run. */
export interface BaselineRun { arm: 'airi', caseId: string, runId: string, epoch: number }

const identifier = v.pipe(v.string(), v.minLength(1), v.maxLength(160), v.regex(/^[\w.:-]+$/))
const epoch = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(Number.MAX_SAFE_INTEGER))
const runSchema = v.strictObject({ arm: v.literal('airi'), caseId: identifier, runId: identifier, epoch })
const referenceSchema = v.strictObject({ requestId: identifier })
const startSchema = v.strictObject({ requestId: identifier, epoch, url: v.pipe(v.string(), v.maxLength(2048)), body: v.pipe(v.string(), v.maxLength(64_000)) })

class TransportFailure extends Error {
  readonly code: BaselineTransportCode
  constructor(code: BaselineTransportCode) {
    super(code)
    this.code = code
  }
}

interface RecordState {
  requestId: string
  sender: WebContents
  frame: WebFrameMain
  run: BaselineRun
  controller: AbortController
  state: 'starting' | 'streaming' | 'done' | 'failed'
  failure?: BaselineTransportCode
  reader?: ReadableStreamDefaultReader<Uint8Array>
  remainder?: Uint8Array
  receivedBytes: number
  reading: boolean
  lastActivity: number
  createdAt: number
  adapter?: AiriBaselineAdapter
  operation?: Promise<BaselineStartResult>
  cleanup?: () => void
}

function projectFailure(error: unknown): BaselineTransportFailure {
  if (error instanceof TransportFailure)
    return { ok: false, code: error.code }
  if (error instanceof AcceptanceBudgetError)
    return { ok: false, code: error.code === 'invalid-input' || error.code === 'campaign-mismatch' ? 'invalid-input' : 'budget-paused' }
  if (error instanceof BaselineAcceptanceError)
    return { ok: false, code: error.code === 'invalid-input' ? 'invalid-input' : 'transport-failed', ...(error.status === undefined ? {} : { status: error.status }) }
  return { ok: false, code: 'transport-failed' }
}

/**
 * Owns baseline requests on the existing Eventa host context. It does not create a server or resolve credentials.
 *
 * Call stack:
 * renderer fetch -> start/read/cancel -> AiriBaselineAdapter -> authorized host fetch
 *                                  -> bounded response chunks
 */
export function registerBaselineTransport(options: {
  context: ReturnType<typeof createContext>['context']
  campaign: AcceptanceCampaign
  budget: AcceptanceBudgetPort
  providerDefinition: AcceptanceProviderDefinition
  getRun: () => BaselineRun
  authorizeSender: (sender: WebContents) => boolean
  prepareTransport: () => Promise<AuthorizedFetch>
}) {
  const records = new Map<string, RecordState>()
  let disposed = false
  let deliveredBytes = 0
  let rejected = 0

  function currentRun() {
    const parsed = v.safeParse(runSchema, options.getRun())
    if (!parsed.success)
      throw new TransportFailure('invalid-run')
    return parsed.output
  }

  function authorize(event: IpcMainEvent | undefined): asserts event is IpcMainEvent & { senderFrame: WebFrameMain } {
    if (disposed)
      throw new TransportFailure('disposed')
    if (!event || event.sender.isDestroyed() || !event.senderFrame || event.senderFrame !== event.sender.mainFrame || !options.authorizeSender(event.sender))
      throw new TransportFailure('permission-denied')
  }

  function stop(record: RecordState, code: BaselineTransportCode) {
    if (record.state === 'done' || record.state === 'failed')
      return
    record.state = 'failed'
    record.failure = code
    record.remainder = undefined
    record.controller.abort(new DOMException('Baseline request cancelled', 'AbortError'))
    const reader = record.reader
    record.reader = undefined
    void reader?.cancel().catch(() => {}).finally(() => reader.releaseLock())
    record.cleanup?.()
  }

  function guard(record: RecordState) {
    if (disposed)
      throw new TransportFailure('disposed')
    if (record.failure)
      throw new TransportFailure(record.failure)
    if (record.sender.isDestroyed() || record.sender.mainFrame !== record.frame || !options.authorizeSender(record.sender)) {
      stop(record, 'permission-denied')
      throw new TransportFailure('permission-denied')
    }
    const now = currentRun()
    if (now.epoch !== record.run.epoch || now.caseId !== record.run.caseId || now.runId !== record.run.runId) {
      stop(record, 'stale-run')
      throw new TransportFailure('stale-run')
    }
  }

  function owned(input: unknown, event: IpcMainEvent | undefined) {
    authorize(event)
    const parsed = v.safeParse(referenceSchema, input)
    if (!parsed.success)
      throw new TransportFailure('invalid-input')
    const record = records.get(parsed.output.requestId)
    if (!record)
      throw new TransportFailure('not-found')
    if (record.sender !== event.sender || record.frame !== event.senderFrame)
      throw new TransportFailure('permission-denied')
    return record
  }

  function newRecord(requestId: string, event: IpcMainEvent & { senderFrame: WebFrameMain }, run: BaselineRun): RecordState {
    // Completed and pre-cancelled IDs stay consumed for this host lifetime. Delayed starts cannot revive them.
    if (records.size >= 256 || [...records.values()].filter(record => record.state === 'starting' || record.state === 'streaming').length >= 8)
      throw new TransportFailure('request-limit')
    const record: RecordState = { requestId, sender: event.sender, frame: event.senderFrame, run, controller: new AbortController(), state: 'starting', receivedBytes: 0, reading: false, createdAt: Date.now(), lastActivity: Date.now() }
    records.set(requestId, record)
    const destroyed = () => stop(record, 'permission-denied')
    const navigated = (_event: unknown, _url: string, _inPlace: boolean, isMainFrame: boolean) => {
      if (isMainFrame)
        stop(record, 'permission-denied')
    }
    event.sender.on('destroyed', destroyed)
    event.sender.on('did-start-navigation', navigated)
    const timer = setInterval(() => {
      try {
        guard(record)
        if (Date.now() - record.createdAt > 120_000 || Date.now() - record.lastActivity > 30_000)
          stop(record, 'timeout')
      }
      catch (error) {
        stop(record, projectFailure(error).code)
      }
    }, 50)
    timer.unref()
    record.cleanup = () => {
      clearInterval(timer)
      event.sender.off('destroyed', destroyed)
      event.sender.off('did-start-navigation', navigated)
    }
    return record
  }

  async function start(input: unknown, event: IpcMainEvent | undefined): Promise<BaselineStartResult> {
    let record: RecordState | undefined
    try {
      authorize(event)
      const parsed = v.safeParse(startSchema, input)
      if (!parsed.success)
        throw new TransportFailure('invalid-input')
      const run = currentRun()
      if (parsed.output.epoch !== run.epoch)
        throw new TransportFailure('stale-run')
      const previous = records.get(parsed.output.requestId)
      if (previous) {
        if (previous.sender !== event.sender || previous.frame !== event.senderFrame)
          throw new TransportFailure('permission-denied')
        throw new TransportFailure(previous.failure ?? 'request-conflict')
      }
      record = newRecord(parsed.output.requestId, event, run)
      const ownedRecord = record
      const adapter = new AiriBaselineAdapter({
        budget: options.budget,
        campaign: options.campaign,
        providerDefinition: options.providerDefinition,
        run: { arm: 'airi', caseId: run.caseId, runId: run.runId },
        requestId: record.requestId,
        protocol: 'chat-completions',
        maxInputTokens: 64_000,
        maxOutputTokens: 2048,
        signal: record.controller.signal,
        assertCurrent: () => guard(ownedRecord),
        prepareTransport: options.prepareTransport,
      })
      record.adapter = adapter
      const operation = (async (): Promise<BaselineStartResult> => {
        try {
          const response = await adapter.fetch(new URL(parsed.output.url), { method: 'POST', body: parsed.output.body, headers: { 'content-type': 'application/json' } })
          guard(ownedRecord)
          ownedRecord.reader = response.body?.getReader()
          ownedRecord.state = response.body ? 'streaming' : 'done'
          ownedRecord.lastActivity = Date.now()
          if (!response.body)
            ownedRecord.cleanup?.()
          const contentType = response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream') ? 'text/event-stream' : 'application/json'
          return { ok: true, requestId: ownedRecord.requestId, status: response.status, contentType }
        }
        catch (error) {
          const failure = ownedRecord.failure ? { ok: false as const, code: ownedRecord.failure } : projectFailure(error)
          stop(ownedRecord, failure.code)
          return failure
        }
      })()
      record.operation = operation
      return await operation
    }
    catch (error) {
      rejected++
      if (record)
        stop(record, projectFailure(error).code)
      return projectFailure(error)
    }
  }

  async function read(input: unknown, event: IpcMainEvent | undefined): Promise<BaselineReadResult> {
    let record: RecordState | undefined
    try {
      record = owned(input, event)
      guard(record)
      if (record.state === 'done')
        return { ok: true, requestId: record.requestId, done: true }
      if (record.state !== 'streaming' || !record.reader)
        throw new TransportFailure('not-ready')
      if (record.reading)
        throw new TransportFailure('read-in-progress')
      record.reading = true
      record.lastActivity = Date.now()
      try {
        while (!record.remainder?.byteLength) {
          const chunk = await record.reader.read()
          guard(record)
          if (chunk.done) {
            record.state = 'done'
            record.reader.releaseLock()
            record.reader = undefined
            record.cleanup?.()
            return { ok: true, requestId: record.requestId, done: true }
          }
          record.receivedBytes += chunk.value.byteLength
          if (record.receivedBytes > BASELINE_RESPONSE_BYTES) {
            stop(record, 'stream-too-large')
            throw new TransportFailure('stream-too-large')
          }
          record.remainder = chunk.value
        }
        guard(record)
        const bytes = record.remainder.subarray(0, BASELINE_CHUNK_BYTES)
        record.remainder = bytes.byteLength === record.remainder.byteLength ? undefined : record.remainder.subarray(bytes.byteLength)
        deliveredBytes += bytes.byteLength
        record.lastActivity = Date.now()
        return { ok: true, requestId: record.requestId, done: false, chunk: Buffer.from(bytes).toString('base64') }
      }
      finally {
        record.reading = false
      }
    }
    catch (error) {
      rejected++
      const failure = error instanceof TransportFailure ? projectFailure(error) : { ok: false as const, code: 'stream-failed' as const }
      if (record && !['read-in-progress', 'not-ready', 'permission-denied'].includes(failure.code))
        stop(record, failure.code)
      return failure
    }
  }

  function cancel(input: unknown, event: IpcMainEvent | undefined): BaselineCancelResult {
    try {
      authorize(event)
      const parsed = v.safeParse(referenceSchema, input)
      if (!parsed.success)
        throw new TransportFailure('invalid-input')
      let record = records.get(parsed.output.requestId)
      if (record)
        record = owned(input, event)
      else
        record = newRecord(parsed.output.requestId, event, currentRun())
      stop(record, 'cancelled')
      return { ok: true, requestId: record.requestId }
    }
    catch (error) {
      rejected++
      return projectFailure(error)
    }
  }

  const unregister = [
    defineInvokeHandler(options.context, baselineTransportStart, (input, metadata) => start(input, metadata?.raw.ipcMainEvent)),
    defineInvokeHandler(options.context, baselineTransportRead, (input, metadata) => read(input, metadata?.raw.ipcMainEvent)),
    defineInvokeHandler(options.context, baselineTransportCancel, (input, metadata) => cancel(input, metadata?.raw.ipcMainEvent)),
  ]
  return {
    cancelAll() { for (const record of records.values()) stop(record, 'cancelled') },
    async flush() {
      await Promise.all([...records.values()].map(record => record.operation))
      try {
        await Promise.all([...records.values()].map(record => record.adapter?.flush()))
      }
      catch {
        throw new Error('Baseline transport accounting incomplete')
      }
    },
    summary() {
      const values = [...records.values()]
      return { disposed, requests: values.length, active: values.filter(record => record.state === 'starting' || record.state === 'streaming').length, completed: values.filter(record => record.state === 'done').length, failed: values.filter(record => record.state === 'failed').length, deliveredBytes, rejected }
    },
    dispose() {
      if (disposed)
        return
      for (const record of records.values())
        stop(record, 'disposed')
      disposed = true
      unregister.forEach(remove => remove())
    },
  }
}
