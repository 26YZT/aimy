import type { Conversation } from '@proj-airi/core-agent'
import type { GenerationProvider, PortableProviderId } from '@proj-airi/provider-inference'

import type { Capability, ProbeArguments, ProbeResult, ProbeStatus } from './arguments'

import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { streamFrom } from '@proj-airi/core-agent'
import { getDefinedProvider, getGenerationProvider } from '@proj-airi/provider-inference'
import { generateSpeech } from '@xsai/generate-speech'
import { generateTranscription } from '@xsai/generate-transcription'
import { config as loadDotenv } from 'dotenv'

import { parseArguments } from './arguments'

class LocalProbeError extends Error {
  constructor(readonly status: ProbeStatus) {
    super(status)
  }
}

const imageTypes: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }
const audioTypes: Record<string, string> = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.ogg': 'audio/ogg', '.webm': 'audio/webm', '.flac': 'audio/flac' }

async function authorizedFile(path: string | undefined, capability: 'vision' | 'asr') {
  if (!path)
    throw new LocalProbeError('input-required')
  try {
    const info = await stat(path)
    const extension = extname(path).toLowerCase()
    const mime = (capability === 'vision' ? imageTypes : audioTypes)[extension]
    if (!info.isFile() || info.size === 0 || info.size > 25 * 1024 * 1024 || !mime)
      throw new LocalProbeError('invalid-input')
    const data = await readFile(path)
    if (data.byteLength === 0 || data.byteLength > 25 * 1024 * 1024)
      throw new LocalProbeError('invalid-input')
    return { data, extension, mime }
  }
  catch {
    throw new LocalProbeError('invalid-input')
  }
}

function configuration(capability: Capability) {
  const prefix = capability === 'llm' ? 'AIMY' : `AIMY_${capability === 'asr' ? 'ASR' : capability === 'tts' ? 'TTS' : 'VISION'}`
  const apiKey = process.env[`${prefix}_API_KEY`]?.trim()
  const model = process.env[`${prefix}_MODEL`]?.trim()
  const baseUrl = process.env[`${prefix}_BASE_URL`]?.trim()
  const api = process.env[`${prefix}_API`]?.trim()
  const voice = process.env.AIMY_TTS_VOICE?.trim()
  if (!apiKey || !model || (capability === 'tts' && !voice))
    throw new LocalProbeError('configuration-required')
  if ((capability === 'llm' || capability === 'vision') && api && api !== 'responses' && api !== 'chat-completions')
    throw new LocalProbeError('configuration-required')
  if (baseUrl) {
    try {
      const url = new URL(baseUrl)
      if (url.protocol !== 'http:' && url.protocol !== 'https:')
        throw new Error('invalid protocol')
    }
    catch {
      throw new LocalProbeError('configuration-required')
    }
  }
  return { apiKey, model, baseUrl, api, voice }
}

function nonemptyWav(audio: ArrayBuffer): boolean {
  const bytes = Buffer.from(audio)
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE')
    return false
  let formatFound = false
  let dataFound = false
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const length = bytes.readUInt32LE(offset + 4)
    if (offset + 8 + length > bytes.length)
      return false
    const kind = bytes.toString('ascii', offset, offset + 4)
    if (kind === 'fmt ' && length >= 16)
      formatFound = true
    if (kind === 'data' && length > 0)
      dataFound = true
    offset += 8 + length + (length % 2)
  }
  return formatFound && dataFound
}

async function probe(args: ProbeArguments): Promise<Omit<ProbeResult, 'durationMs'>> {
  const capability = args.capability!
  const result: Omit<ProbeResult, 'durationMs'> = { capability, status: 'failed' }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  const timedOut = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(new LocalProbeError('timeout')), { once: true })
  })
  const operation = async () => {
    // File reads require both --live and the corresponding explicit file flag.
    const file = capability === 'vision' ? await authorizedFile(args.image, 'vision') : capability === 'asr' ? await authorizedFile(args.audio, 'asr') : undefined
    loadDotenv({ path: process.env.AIMY_ENV_FILE?.trim() || fileURLToPath(new URL('../../../.env', import.meta.url)), override: false })
    const config = configuration(capability)
    let requests = 0
    const singleFetch: typeof globalThis.fetch = async (input, init) => {
      if (requests++ > 0)
        throw new LocalProbeError('failed')
      controller.signal.throwIfAborted()
      // A 307/308 follow can repeat a POST within a single fetch invocation.
      // Reject redirects so the one-request budget also covers HTTP transport.
      return globalThis.fetch(input, { ...init, redirect: 'error' })
    }
    const id: PortableProviderId = capability === 'llm' || capability === 'vision'
      ? config.baseUrl ? 'openai-compatible' : 'openai'
      : capability === 'asr'
        ? config.baseUrl ? 'openai-compatible-audio-transcription' : 'openai-audio-transcription'
        : config.baseUrl ? 'openai-compatible-audio-speech' : 'openai-audio-speech'
    const definition = getDefinedProvider(id)
    if (!definition)
      throw new LocalProbeError('failed')
    const provider = await definition.createProvider({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseUrl: config.baseUrl } : capability === 'asr' || capability === 'tts' ? { baseUrl: 'https://api.openai.com/v1/' } : {}),
      ...(config.api ? { api: config.api } : {}),
    })
    controller.signal.throwIfAborted()
    if (capability === 'llm' || capability === 'vision') {
      const generation = getGenerationProvider(provider)
      if (!generation)
        throw new LocalProbeError('failed')
      const guardedProvider: GenerationProvider = {
        generation: (model) => {
          const request = generation.generation(model)
          return { ...request, config: { ...request.config, fetch: singleFetch } }
        },
      }
      const conversation: Conversation = {
        turns: [{ type: 'user', id: 'experience-probe', content: [
          { type: 'text', text: capability === 'vision' ? '请用一句简短中文描述这张图片。' : '请用一句简短中文回应：你好。' },
          ...(file ? [{ type: 'image' as const, url: `data:${file.mime};base64,${file.data.toString('base64')}` }] : []),
        ] }],
      }
      let textLength = 0
      const startedAt = performance.now()
      await streamFrom({
        model: config.model,
        chatProvider: guardedProvider,
        conversation,
        options: {
          abortSignal: controller.signal,
          supportsTools: false,
          onStreamEvent: (event) => {
            if (event.type === 'text-delta' && event.text.length > 0) {
              result.firstTokenMs ??= Math.round(performance.now() - startedAt)
              textLength += event.text.length
            }
          },
        },
      })
      if (textLength === 0)
        throw new LocalProbeError('failed')
      result.textLength = textLength
    }
    else if (capability === 'asr') {
      if (!('transcription' in provider) || !file)
        throw new LocalProbeError('failed')
      const transcription = await generateTranscription({
        ...provider.transcription(config.model),
        fetch: singleFetch,
        abortSignal: controller.signal,
        file: new Blob([new Uint8Array(file.data)], { type: file.mime }),
        fileName: `probe-audio${file.extension}`,
        responseFormat: 'json',
      })
      if (typeof transcription.text !== 'string' || !transcription.text.trim())
        throw new LocalProbeError('failed')
      result.textLength = transcription.text.length
    }
    else {
      if (!('speech' in provider) || !config.voice)
        throw new LocalProbeError('failed')
      const audio = await generateSpeech({
        ...provider.speech(config.model),
        fetch: singleFetch,
        abortSignal: controller.signal,
        input: '你好，我是 Aimy。',
        voice: config.voice,
        responseFormat: 'wav',
      })
      if (!nonemptyWav(audio))
        throw new LocalProbeError('failed')
      result.audioBytes = audio.byteLength
    }
    controller.signal.throwIfAborted()
    result.status = 'ok'
  }
  try {
    await Promise.race([operation(), timedOut])
  }
  catch (error) {
    result.status = controller.signal.aborted ? 'timeout' : error instanceof LocalProbeError ? error.status : 'failed'
  }
  finally {
    clearTimeout(timeout)
  }
  return { ...result }
}

process.once('message', (message: unknown) => {
  const input = message && typeof message === 'object' ? message as Record<string, unknown> : undefined
  const capability = input?.capability
  if (!input || typeof input.live !== 'boolean' || (capability !== 'llm' && capability !== 'vision' && capability !== 'asr' && capability !== 'tts')
    || (input.image !== undefined && typeof input.image !== 'string') || (input.audio !== undefined && typeof input.audio !== 'string')) {
    process.send?.({ capability: null, status: 'invalid-arguments' }, () => process.disconnect?.())
    return
  }
  const args = parseArguments([
    ...(input.live ? ['--live'] : []), '--capability', capability,
    ...(input.image ? ['--image', input.image as string] : []),
    ...(input.audio ? ['--audio', input.audio as string] : []),
  ])
  if (!args) {
    process.send?.({ capability: null, status: 'invalid-arguments' }, () => process.disconnect?.())
    return
  }
  if (!args.live) {
    process.send?.({ capability, status: 'not-run' }, () => process.disconnect?.())
    return
  }
  void probe(args).then(result => process.send?.(result, () => process.disconnect?.())).catch(() => {
    process.send?.({ capability, status: 'failed' }, () => process.disconnect?.())
  })
})
