import type { AudioServiceKind, MediaReply, PrivateAudioSettings } from '../shared/contracts'

import { randomUUID } from 'node:crypto'
import { getDefinedProvider } from '@proj-airi/provider-inference'
import { generateSpeech } from '@xsai/generate-speech'
import { generateTranscription } from '@xsai/generate-transcription'
import { maxLength, minLength, object, pipe, safeParse, string } from 'valibot'

export interface OperationLease {
  signal: AbortSignal
  current: () => boolean
  finish: () => void
}

export interface AudioServiceOptions {
  getConfiguration: (kind: AudioServiceKind) => PrivateAudioSettings
  acquire: (kind: 'mic' | 'speech', token: string) => OperationLease | undefined
  isSpeechTextAllowed: (turnId: string, text: string) => boolean
}

const INPUT_LIMIT = 2 * 1024 * 1024
const JSON_LIMIT = 64 * 1024
const OUTPUT_LIMIT = 6 * 1024 * 1024
const TEXT_LIMIT = 8000
const REQUEST_TIMEOUT_MS = 15_000
const RECEIPT_TTL_MS = 30_000
const RECEIPT_LIMIT = 64
const SEEN_REQUEST_LIMIT = 4096
const identifier = pipe(string(), minLength(1), maxLength(100))
const transcriptionSchema = object({ requestId: identifier, token: identifier, audioBase64: pipe(string(), minLength(1), maxLength(Math.ceil(INPUT_LIMIT / 3) * 4)) })
const synthesisSchema = object({ requestId: identifier, token: identifier, turnId: identifier, text: pipe(string(), minLength(1), maxLength(TEXT_LIMIT)) })

class AudioFailure extends Error {
  constructor(readonly status: MediaReply['status'], readonly safeMessage: string) {
    super('Audio operation failed')
  }
}

interface Operation {
  kind: AudioServiceKind
  controller: AbortController
  lease: OperationLease
  signal: AbortSignal
  finished: boolean
  timedOut: boolean
}

interface TranscriptReceipt {
  requestId: string
  token: string
  text: string
  expiresAt: number
}

/** Accept bounded canonical base64, rather than Buffer's permissive decoder. */
function decodeRecording(base64: string) {
  if (base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64))
    throw new AudioFailure('failed', '音频数据格式无效。')
  const bytes = Buffer.from(base64, 'base64')
  if (!bytes.byteLength || bytes.byteLength > INPUT_LIMIT || bytes.toString('base64') !== base64 || !validWav(bytes))
    throw new AudioFailure('failed', '音频数据过大或格式无效。')
  return bytes
}

/** Validate complete RIFF, PCM/float format, aligned nonempty samples and chunk bounds. */
function validWav(bytes: Uint8Array) {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (data.length < 44 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE' || data.readUInt32LE(4) + 8 !== data.length)
    return false
  let blockAlign = 0
  let sampleBytes: number | undefined
  let formatFound = false
  for (let offset = 12; offset < data.length;) {
    if (offset + 8 > data.length)
      return false
    const length = data.readUInt32LE(offset + 4)
    const end = offset + 8 + length
    const paddedEnd = end + length % 2
    if (end > data.length || paddedEnd > data.length)
      return false
    const kind = data.toString('ascii', offset, offset + 4)
    if (kind === 'fmt ') {
      if (formatFound || length < 16)
        return false
      const format = data.readUInt16LE(offset + 8)
      const channels = data.readUInt16LE(offset + 10)
      const sampleRate = data.readUInt32LE(offset + 12)
      const byteRate = data.readUInt32LE(offset + 16)
      blockAlign = data.readUInt16LE(offset + 20)
      const bits = data.readUInt16LE(offset + 22)
      if ((format !== 1 && format !== 3) || !channels || channels > 8 || !sampleRate || sampleRate > 384_000
        || !(format === 1 ? [8, 16, 24, 32] : [32, 64]).includes(bits)
        || blockAlign !== channels * bits / 8 || byteRate !== sampleRate * blockAlign)
        return false
      formatFound = true
    }
    if (kind === 'data') {
      if (sampleBytes !== undefined || length === 0)
        return false
      sampleBytes = length
    }
    offset = paddedEnd
  }
  return formatFound && sampleBytes !== undefined && sampleBytes % blockAlign === 0
}

function configuration(value: PrivateAudioSettings, kind: AudioServiceKind) {
  if (!value || typeof value.apiKey !== 'string' || !value.apiKey.trim() || value.apiKey.length > 1000
    || typeof value.model !== 'string' || !value.model.trim() || value.model.length > 200
    || typeof value.baseUrl !== 'string' || value.baseUrl.length > 2000
    || (kind === 'tts' && (typeof value.voice !== 'string' || !value.voice.trim() || value.voice.length > 200)))
    throw new AudioFailure('configuration-required', kind === 'asr' ? '请先配置语音识别服务。' : '请先配置语音合成服务。')
  const baseUrl = value.baseUrl.trim()
  if (baseUrl) {
    try {
      const url = new URL(baseUrl)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
        throw new Error()
    }
    catch {
      throw new AudioFailure('configuration-required', '请检查语音服务地址。')
    }
  }
  return { ...value, apiKey: value.apiKey.trim(), model: value.model.trim(), voice: value.voice?.trim() || '', baseUrl }
}

function current(operation: Operation) {
  return !operation.finished && !operation.signal.aborted && operation.lease.current()
}

function assertCurrent(operation: Operation) {
  if (!current(operation))
    throw new AudioFailure('cancelled', '本轮语音授权已失效。')
}

/** Read the remote body under a cap before xsAI can collect it as JSON or an ArrayBuffer. */
async function boundedResponse(response: Response, limit: number, operation: Operation) {
  if (response.redirected || response.status >= 300 && response.status < 400) {
    void response.body?.cancel().catch(() => {})
    throw new AudioFailure('failed', '语音服务重定向已拒绝，请检查服务地址。')
  }
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > limit) {
    void response.body?.cancel().catch(() => {})
    throw new AudioFailure('failed', '语音服务返回的数据过大。')
  }
  if (!response.body)
    throw new AudioFailure('failed', '语音服务未返回有效数据。')
  const reader = response.body.getReader()
  const cancel = () => { void reader.cancel().catch(() => {}) }
  operation.signal.addEventListener('abort', cancel, { once: true })
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      assertCurrent(operation)
      const result = await reader.read()
      assertCurrent(operation)
      if (result.done)
        break
      bytes += result.value.byteLength
      if (bytes > limit) {
        cancel()
        throw new AudioFailure('failed', '语音服务返回的数据过大。')
      }
      chunks.push(result.value)
    }
    return new Response(Buffer.concat(chunks, bytes), { status: response.status, headers: response.headers })
  }
  finally {
    operation.signal.removeEventListener('abort', cancel)
    cancel()
    try { reader.releaseLock() } catch {}
  }
}

/** Credential and SDK ownership stays in the main process; no vendor protocol is implemented here. */
export function createAudioService(options: AudioServiceOptions) {
  const active = new Map<string, Operation>()
  const seen = new Map<string, AudioServiceKind>()
  const receipts = new Map<string, TranscriptReceipt>()

  function pruneReceipts() {
    const now = Date.now()
    for (const [id, receipt] of receipts) {
      if (receipt.expiresAt <= now)
        receipts.delete(id)
    }
  }

  async function run(kind: AudioServiceKind, requestId: string, token: string, work: (config: PrivateAudioSettings, operation: Operation, fetch: typeof globalThis.fetch) => Promise<MediaReply>): Promise<MediaReply> {
    if (active.has(requestId) || seen.has(requestId))
      return { requestId, status: 'failed', message: '该语音请求已处理，请勿重复发送。' }
    if (seen.size >= SEEN_REQUEST_LIMIT || [...active.values()].filter(operation => operation.kind === kind).length >= 2)
      return { requestId, status: 'failed', message: '当前语音请求较多，请稍后重试或重新开启语音。' }
    let lease: OperationLease | undefined
    let operation: Operation | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let abortListener: (() => void) | undefined
    try {
      lease = options.acquire(kind === 'asr' ? 'mic' : 'speech', token)
      if (!lease || !lease.current() || lease.signal.aborted)
        throw new AudioFailure('cancelled', '本轮语音授权已失效。')
      seen.set(requestId, kind)
      const config = configuration(options.getConfiguration(kind), kind)
      const controller = new AbortController()
      operation = { kind, controller, lease, signal: AbortSignal.any([controller.signal, lease.signal]), finished: false, timedOut: false }
      const ownedOperation = operation
      active.set(requestId, ownedOperation)
      timer = setTimeout(() => { ownedOperation.timedOut = true; controller.abort() }, REQUEST_TIMEOUT_MS)
      const aborted = new Promise<never>((_resolve, reject) => {
        abortListener = () => reject(new AudioFailure('cancelled', '已停止语音请求。'))
        ownedOperation.signal.addEventListener('abort', abortListener, { once: true })
      })
      let requests = 0
      const transport = globalThis.fetch
      const guardedFetch: typeof globalThis.fetch = async (input, init) => {
        assertCurrent(ownedOperation)
        if (requests++ > 0)
          throw new AudioFailure('failed', '语音服务请求已停止。')
        const response = await transport(input, { ...init, signal: ownedOperation.signal, redirect: 'error' })
        assertCurrent(ownedOperation)
        return boundedResponse(response, response.ok && kind === 'tts' ? OUTPUT_LIMIT : JSON_LIMIT, ownedOperation)
      }
      const result = await Promise.race([work(config, ownedOperation, guardedFetch), aborted])
      assertCurrent(ownedOperation)
      return result
    }
    catch (error) {
      if (operation?.timedOut)
        return { requestId, status: 'failed', message: '语音服务响应超时，请稍后重试。' }
      if (operation && !current(operation))
        return { requestId, status: 'cancelled', message: '已停止语音请求。' }
      if (error instanceof AudioFailure)
        return { requestId, status: error.status, message: error.safeMessage }
      return { requestId, status: 'failed', message: '语音服务暂时不可用，请检查配置与网络。' }
    }
    finally {
      clearTimeout(timer)
      if (operation) {
        operation.finished = true
        if (abortListener)
          operation.signal.removeEventListener('abort', abortListener)
        operation.controller.abort()
        if (active.get(requestId) === operation)
          active.delete(requestId)
      }
      try { lease?.finish() } catch {}
    }
  }

  return {
    async transcribe(value: unknown): Promise<MediaReply> {
      const parsed = safeParse(transcriptionSchema, value)
      if (!parsed.success)
        return { requestId: '', status: 'failed', message: '语音请求格式无效。' }
      const input = parsed.output
      return run('asr', input.requestId, input.token, async (config, operation, fetch) => {
        const bytes = decodeRecording(input.audioBase64)
        const definition = getDefinedProvider(config.baseUrl ? 'openai-compatible-audio-transcription' : 'openai-audio-transcription')
        if (!definition)
          throw new AudioFailure('failed', '语音识别服务不可用。')
        const provider = await definition.createProvider({ apiKey: config.apiKey, baseUrl: config.baseUrl || 'https://api.openai.com/v1/' })
        assertCurrent(operation)
        if (!('transcription' in provider) || typeof provider.transcription !== 'function')
          throw new AudioFailure('failed', '语音识别服务不可用。')
        const result = await generateTranscription({ ...provider.transcription(config.model), fetch, abortSignal: operation.signal, file: new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }), fileName: 'recording.wav', responseFormat: 'json' })
        assertCurrent(operation)
        if (typeof result.text !== 'string' || !result.text.trim() || result.text.length > TEXT_LIMIT)
          throw new AudioFailure('failed', '语音识别未返回有效文本。')
        const text = result.text.trim().replaceAll(config.apiKey, '[redacted]')
        if (text.length > TEXT_LIMIT)
          throw new AudioFailure('failed', '语音识别文本过长。')
        pruneReceipts()
        if (receipts.size >= RECEIPT_LIMIT)
          receipts.delete(receipts.keys().next().value!)
        const receiptId = randomUUID()
        receipts.set(receiptId, { requestId: input.requestId, token: input.token, text, expiresAt: Date.now() + RECEIPT_TTL_MS })
        return { requestId: input.requestId, status: 'complete', text, receiptId }
      })
    },
    async synthesize(value: unknown): Promise<MediaReply> {
      const parsed = safeParse(synthesisSchema, value)
      if (!parsed.success)
        return { requestId: '', status: 'failed', message: '语音请求格式无效。' }
      const input = parsed.output
      return run('tts', input.requestId, input.token, async (config, operation, fetch) => {
        if (!options.isSpeechTextAllowed(input.turnId, input.text) || input.text.includes(config.apiKey))
          throw new AudioFailure('cancelled', '本轮回复已失效，未生成语音。')
        const definition = getDefinedProvider(config.baseUrl ? 'openai-compatible-audio-speech' : 'openai-audio-speech')
        if (!definition)
          throw new AudioFailure('failed', '语音合成服务不可用。')
        const provider = await definition.createProvider({ apiKey: config.apiKey, baseUrl: config.baseUrl || 'https://api.openai.com/v1/' })
        assertCurrent(operation)
        if (!('speech' in provider) || typeof provider.speech !== 'function')
          throw new AudioFailure('failed', '语音合成服务不可用。')
        if (!options.isSpeechTextAllowed(input.turnId, input.text))
          throw new AudioFailure('cancelled', '本轮回复已失效，未生成语音。')
        const audio = await generateSpeech({ ...provider.speech(config.model), fetch, abortSignal: operation.signal, input: input.text, voice: config.voice, responseFormat: 'wav' })
        assertCurrent(operation)
        if (!options.isSpeechTextAllowed(input.turnId, input.text))
          throw new AudioFailure('cancelled', '本轮回复已失效，未播放语音。')
        const bytes = new Uint8Array(audio)
        if (!bytes.byteLength || bytes.byteLength > OUTPUT_LIMIT || !validWav(bytes))
          throw new AudioFailure('failed', '语音合成未返回有效音频。')
        return { requestId: input.requestId, status: 'complete', audioBase64: Buffer.from(bytes).toString('base64') }
      })
    },
    cancel(requestId: string) {
      active.get(requestId)?.controller.abort()
      for (const [id, receipt] of receipts) {
        if (receipt.requestId === requestId)
          receipts.delete(id)
      }
    },
    cancelAll(kind?: AudioServiceKind) {
      for (const operation of active.values())
        if (!kind || operation.kind === kind) operation.controller.abort()
      if (!kind || kind === 'asr') receipts.clear()
      if (!kind) seen.clear()
      else for (const [id, requestKind] of seen) { if (requestKind === kind) seen.delete(id) }
    },
    consumeTranscript(receiptId: string, token: string, text: string) {
      pruneReceipts()
      const receipt = receipts.get(receiptId)
      if (!receipt || receipt.token !== token || receipt.text !== text)
        return false
      let lease: OperationLease | undefined
      try {
        lease = options.acquire('mic', token)
        if (!lease || lease.signal.aborted || !lease.current()) {
          receipts.delete(receiptId)
          return false
        }
        receipts.delete(receiptId)
        return true
      }
      catch { return false }
      finally { try { lease?.finish() } catch {} }
    },
  }
}
