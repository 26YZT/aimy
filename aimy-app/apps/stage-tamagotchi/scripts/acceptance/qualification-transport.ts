import type { Session } from 'electron'

import { Buffer } from 'node:buffer'
import { createPrivateKey, randomUUID, X509Certificate } from 'node:crypto'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { createServer, request as httpsRequest } from 'node:https'
import { dirname, isAbsolute } from 'node:path'
import { Readable } from 'node:stream'

import * as v from 'valibot'

const payloadSchema = v.object({
  model: v.literal('deepseek-flash'),
  thinking: v.strictObject({ type: v.literal('disabled') }),
  max_tokens: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(2048)),
  stream: v.optional(v.boolean()),
  messages: v.pipe(v.array(v.object({
    role: v.picklist(['system', 'developer', 'user', 'assistant']),
    content: v.union([v.string(), v.array(v.strictObject({ type: v.literal('text'), text: v.string() }))]),
    tool_calls: v.optional(v.never()),
    function_call: v.optional(v.never()),
  })), v.minLength(1)),
  tools: v.optional(v.pipe(v.array(v.never()), v.maxLength(0))),
  functions: v.optional(v.never()),
  function_call: v.optional(v.never()),
})
const extractionSchema = v.object({ allowedSources: v.array(v.object({ ref: v.object({ sourceId: v.string() }), text: v.string() })) })

function check(condition: unknown): asserts condition {
  if (!condition)
    throw new Error('QUALIFICATION_TRANSPORT_REJECTED')
}

async function readTestPem(path: string) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const info = await handle.stat()
    check(info.isFile() && info.nlink === 1 && info.size > 0 && info.size <= 65_536)
    const buffer = Buffer.alloc(info.size + 1)
    let length = 0
    while (length < buffer.length) {
      const result = await handle.read(buffer, length, buffer.length - length, length)
      if (!result.bytesRead)
        break
      length += result.bytesRead
    }
    check(length === info.size)
    return buffer.subarray(0, length)
  }
  finally { await handle.close() }
}

function officialEndpoint(url: URL) {
  return url.origin === 'https://api.deepseek.com' && !url.username && !url.password && !url.search && !url.hash
    && ['/chat/completions', '/v1/chat/completions'].includes(url.pathname)
}

/**
 * Runs an explicit qualification fixture. Production live hosts never import this module.
 * The selected self-signed certificate is the only exception to normal certificate validation.
 *
 * Call stack:
 * qualification Node fetch -> pinned local HTTPS -> fixed fixture stream
 * qualification Chromium -> host resolver rule -> pinned local HTTPS -> fixed fixture stream
 */
export async function createQualificationTransport(options: {
  certificatePath: string
  keyPath: string
  authorize: () => string | undefined
}) {
  try {
    check(isAbsolute(options.certificatePath) && isAbsolute(options.keyPath) && dirname(options.certificatePath) === dirname(options.keyPath))
    const [certificatePem, keyPem] = await Promise.all([readTestPem(options.certificatePath), readTestPem(options.keyPath)])
    const certificate = new X509Certificate(certificatePem)
    check(certificate.checkHost('api.deepseek.com') === 'api.deepseek.com'
      && certificate.checkIssued(certificate) && certificate.verify(certificate.publicKey)
      && certificate.checkPrivateKey(createPrivateKey(keyPem)))
    const fingerprint = certificate.fingerprint256.replaceAll(':', '').toLowerCase()
    const counts = { requests: 0, chat: 0, memory: 0, authRejected: 0 }
    const sessions = new Set<Pick<Session, 'setCertificateVerifyProc'>>()
    let disposed = false
    const clients = new Set<ReturnType<typeof httpsRequest>>()
    const server = createServer({ cert: certificatePem, key: keyPem }, (request, response) => {
      void (async () => {
        try {
          check(!disposed && ['/chat/completions', '/v1/chat/completions'].includes(request.url ?? ''))
          response.setHeader('access-control-allow-origin', '*')
          response.setHeader('access-control-allow-headers', 'authorization,content-type')
          response.setHeader('access-control-allow-methods', 'POST,OPTIONS')
          if (request.method === 'OPTIONS') {
            response.writeHead(204).end()
            return
          }
          check(request.method === 'POST')
          const expected = options.authorize()
          if (!expected || request.headers.authorization !== expected) {
            counts.authRejected++
            throw new Error('QUALIFICATION_AUTHORIZATION_REJECTED')
          }
          let bytes = 0
          const chunks: Buffer[] = []
          for await (const chunk of request) {
            const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            bytes += value.length
            check(bytes <= 64_000)
            chunks.push(value)
          }
          const body = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
          const raw: unknown = JSON.parse(body)
          const payload = v.parse(payloadSchema, raw)
          check(!/"(?:image_url|input_audio|input_image|input_file|audio|file)"\s*:/.test(body))
          const last = payload.messages.at(-1)?.content
          let extraction: v.InferOutput<typeof extractionSchema> | undefined
          if (typeof last === 'string' && last.startsWith('{')) {
            try {
              const parsed = v.safeParse(extractionSchema, JSON.parse(last))
              if (parsed.success)
                extraction = parsed.output
            }
            catch { /* Non-JSON user text remains a normal fixed chat fixture. */ }
          }
          const content = extraction
            ? JSON.stringify({ schemaVersion: 1, candidates: extraction.allowedSources.slice(0, 1).map(source => ({ category: 'experience', subject: 'user', label: '资格测试固定原话片段', text: source.text.trim().slice(0, 1000), keywords: [source.text.trim().slice(0, 8)], sourceRefIds: [source.ref.sourceId] })) })
            : '这是资格测试固定响应，只验证真实验收入口的请求流程，不代表模型理解、记忆效果或陪伴质量。'
          counts.requests++
          if (extraction)
            counts.memory++
          else
            counts.chat++
          const usage = { prompt_tokens: Math.ceil(Buffer.byteLength(body) / 4), completion_tokens: Math.ceil(Buffer.byteLength(content) / 4), prompt_cache_hit_tokens: 0 }
          const id = `qualification-fixed-${randomUUID()}`
          if (!payload.stream) {
            response.writeHead(200, { 'content-type': 'application/json', 'x-aimy-qualification': 'fixed-fixture' })
            response.end(JSON.stringify({ id, choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage }))
            return
          }
          response.writeHead(200, { 'content-type': 'text/event-stream', 'x-aimy-qualification': 'fixed-fixture' })
          response.write(`data: ${JSON.stringify({ id, choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] })}\n\n`)
          const timer = setTimeout(() => {
            response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage })}\n\n`)
            response.end('data: [DONE]\n\n')
          }, 20)
          response.once('close', () => clearTimeout(timer))
        }
        catch {
          if (!response.headersSent)
            response.writeHead(400, { 'content-type': 'application/json' })
          response.end('{"error":{"code":"QUALIFICATION_FIXTURE_REJECTED"}}')
        }
      })()
    })
    await new Promise<void>((accept, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject)
        accept()
      })
    })
    const address = server.address()
    check(address && typeof address !== 'string')
    const port = address.port

    const fetch: typeof globalThis.fetch = async (input, init) => {
      try {
        const url = new URL(input instanceof Request ? input.url : String(input))
        check(!disposed && officialEndpoint(url))
        const outgoing = new Request(input, init)
        check(outgoing.method === 'POST' && !outgoing.signal.aborted)
        const chunks: Uint8Array[] = []
        let bytes = 0
        const reader = outgoing.body?.getReader()
        check(reader)
        try {
          while (true) {
            const chunk = await reader.read()
            if (chunk.done)
              break
            bytes += chunk.value.byteLength
            check(bytes <= 64_000)
            chunks.push(chunk.value)
          }
        }
        finally {
          await reader.cancel().catch(() => undefined)
          reader.releaseLock()
        }
        check(!disposed && !outgoing.signal.aborted)
        const headers = Object.fromEntries(outgoing.headers.entries())
        return await new Promise<Response>((accept, reject) => {
          const request = httpsRequest({ hostname: '127.0.0.1', port, path: url.pathname, method: 'POST', headers, ca: certificatePem, servername: 'api.deepseek.com', rejectUnauthorized: true, agent: false }, (incoming) => {
            const responseHeaders = new Headers()
            for (const [name, value] of Object.entries(incoming.headers)) {
              if (Array.isArray(value))
                value.forEach(item => responseHeaders.append(name, item))
              else if (value !== undefined)
                responseHeaders.set(name, value)
            }
            accept(new Response(Readable.toWeb(incoming) as ReadableStream<Uint8Array>, { status: incoming.statusCode ?? 500, headers: responseHeaders }))
          })
          clients.add(request)
          const abort = () => request.destroy(new Error('QUALIFICATION_REQUEST_ABORTED'))
          outgoing.signal.addEventListener('abort', abort, { once: true })
          request.once('close', () => {
            clients.delete(request)
            outgoing.signal.removeEventListener('abort', abort)
          })
          request.once('error', () => reject(new Error('QUALIFICATION_REQUEST_FAILED')))
          if (outgoing.signal.aborted)
            abort()
          else
            request.end(Buffer.concat(chunks))
        })
      }
      catch { throw new Error('QUALIFICATION_REQUEST_FAILED') }
    }

    return {
      port,
      fetch,
      installSession(session: Pick<Session, 'setCertificateVerifyProc'>) {
        check(!disposed)
        session.setCertificateVerifyProc((request, callback) => {
          if (request.hostname !== 'api.deepseek.com') {
            callback(-3)
            return
          }
          try {
            // Electron's fingerprint metadata format differs across versions. Pin the actual certificate bytes.
            const actual = new X509Certificate(request.certificate.data).fingerprint256.replaceAll(':', '').toLowerCase()
            // A valid public certificate is still outside this fixture. Never fall back to system trust here.
            callback(!disposed && actual === fingerprint ? 0 : -2)
          }
          catch {
            callback(-2)
          }
        })
        sessions.add(session)
      },
      summary() { return { ...counts, noRemoteCalls: true as const } },
      dispose() {
        if (disposed)
          return
        disposed = true
        for (const request of clients)
          request.destroy(new Error('QUALIFICATION_TRANSPORT_CLOSED'))
        clients.clear()
        for (const session of sessions)
          session.setCertificateVerifyProc(null)
        sessions.clear()
        server.closeAllConnections()
        server.close()
      },
    }
  }
  catch { throw new Error('QUALIFICATION_TRANSPORT_START_FAILED') }
}
