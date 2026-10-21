import type { Session } from 'electron'

import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rootCertificates } from 'node:tls'
import { promisify } from 'node:util'

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { createQualificationTransport } from './qualification-transport'

let directory: string
let certificatePath: string
let keyPath: string
const transports: Awaited<ReturnType<typeof createQualificationTransport>>[] = []
const authorization = 'Bearer synthetic-qualification-canary'
const endpoint = 'https://api.deepseek.com/chat/completions'
const payload = { model: 'deepseek-flash', thinking: { type: 'disabled' }, max_tokens: 512, stream: false, messages: [{ role: 'user', content: 'This is a fictional case.' }] }

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'aimy-qualification-transport-'))
  certificatePath = join(directory, 'certificate.pem')
  keyPath = join(directory, 'key.pem')
  const config = join(directory, 'openssl.cnf')
  await writeFile(config, '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=api.deepseek.com\n[ext]\nsubjectAltName=DNS:api.deepseek.com\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\n')
  await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certificatePath, '-days', '1', '-config', config])
}, 15_000)
afterEach(() => {
  transports.splice(0).forEach(transport => transport.dispose())
})
afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

async function create(authorize: () => string | undefined = () => authorization) {
  const transport = await createQualificationTransport({ certificatePath, keyPath, authorize })
  transports.push(transport)
  return transport
}

function options(body: unknown = payload, key = authorization): RequestInit {
  return { method: 'POST', headers: { 'Authorization': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

describe('pinned qualification TLS fixture', () => {
  it('maps the official URL to localhost and returns clearly labelled fixed JSON with usage', async () => {
    const transport = await create()
    const response = await transport.fetch(endpoint, options())
    expect(response.status).toBe(200)
    expect(response.headers.get('x-aimy-qualification')).toBe('fixed-fixture')
    const result = await response.json()
    expect(result.id).toMatch(/^qualification-fixed-/)
    expect(result.choices[0].message.content).toContain('资格测试固定响应')
    expect(result.usage.prompt_tokens).toBeGreaterThan(0)
    expect(result.usage.completion_tokens).toBeGreaterThan(0)
    expect(transport.summary()).toEqual({ requests: 1, chat: 1, memory: 0, authRejected: 0, noRemoteCalls: true })
    expect(JSON.stringify(transport.summary())).not.toContain('synthetic-qualification-canary')
  })

  it('streams the first SSE chunk before completion and supplies final usage', async () => {
    const transport = await create()
    const response = await transport.fetch(endpoint, options({ ...payload, stream: true }))
    const reader = response.body!.getReader()
    const first = await reader.read()
    expect(first.done).toBe(false)
    let text = new TextDecoder().decode(first.value)
    expect(text).toContain('资格测试固定响应')
    while (true) {
      const value = await reader.read()
      if (value.done)
        break
      text += new TextDecoder().decode(value.value)
    }
    expect(text).toContain('"usage"')
    expect(text).toContain('[DONE]')
  })

  it('builds memory fixture output only from the first allowed source', async () => {
    const transport = await create()
    const sources = [{ ref: { sourceId: 'synthetic-source-1' }, text: 'fictional first source' }, { ref: { sourceId: 'synthetic-source-2' }, text: 'fictional second source' }]
    const response = await transport.fetch('https://api.deepseek.com/v1/chat/completions', options({ ...payload, messages: [{ role: 'user', content: JSON.stringify({ allowedSources: sources }) }] }))
    const result = await response.json()
    const memory = JSON.parse(result.choices[0].message.content)
    expect(memory.candidates).toHaveLength(1)
    expect(memory.candidates[0].sourceRefIds).toEqual(['synthetic-source-1'])
    expect(memory.candidates[0].text).toBe('fictional first source')
    expect(memory.candidates[0].label).toContain('固定')
    expect(transport.summary().memory).toBe(1)
  })

  it('rejects missing or changed authorization without returning the key', async () => {
    let expected: string | undefined = authorization
    const transport = await create(() => expected)
    expect((await transport.fetch(endpoint, options(payload, 'Bearer wrong'))).status).toBe(400)
    expected = undefined
    const response = await transport.fetch(endpoint, options())
    expect(response.status).toBe(400)
    expect(await response.text()).not.toContain('synthetic-qualification-canary')
    expect(transport.summary()).toMatchObject({ requests: 0, authRejected: 2 })
  })

  it.each(['https://other.invalid/chat/completions', 'http://api.deepseek.com/chat/completions', 'https://api.deepseek.com/models', 'https://api.deepseek.com/chat/completions?extra=1'])('does not route an unapproved URL %s', async (url) => {
    const transport = await create()
    await expect(transport.fetch(url, options())).rejects.toThrow('QUALIFICATION_REQUEST_FAILED')
    expect(transport.summary().requests).toBe(0)
  })

  it('rejects invalid model, thinking, bounds and nontext calls', async () => {
    const transport = await create()
    for (const changed of [{ ...payload, model: 'another' }, { ...payload, thinking: { type: 'enabled' } }, { ...payload, max_tokens: 2049 }, { ...payload, tools: [{}] }, { ...payload, messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'x' } }] }] }])
      expect((await transport.fetch(endpoint, options(changed))).status).toBe(400)
    expect(transport.summary().requests).toBe(0)
  })

  it('honors an abort before sending and rejects oversized outgoing bodies', async () => {
    const transport = await create()
    const controller = new AbortController()
    controller.abort()
    await expect(transport.fetch(endpoint, { ...options(), signal: controller.signal })).rejects.toThrow('QUALIFICATION_REQUEST_FAILED')
    await expect(transport.fetch(endpoint, options({ ...payload, messages: [{ role: 'user', content: 'x'.repeat(64_001) }] }))).rejects.toThrow('QUALIFICATION_REQUEST_FAILED')
    expect(transport.summary().requests).toBe(0)
  })

  it('propagates cancellation after SSE headers without buffering completion', async () => {
    const transport = await create()
    const controller = new AbortController()
    const response = await transport.fetch(endpoint, { ...options({ ...payload, stream: true }), signal: controller.signal })
    const reader = response.body!.getReader()
    expect((await reader.read()).done).toBe(false)
    controller.abort()
    await expect(reader.read()).rejects.toBeDefined()
  })

  it('applies certificate exceptions only to the selected fingerprint and exact hostname', async () => {
    const transport = await create()
    let callback: Parameters<Session['setCertificateVerifyProc']>[0] | undefined
    const set = vi.fn((listener: typeof callback) => {
      callback = listener
    })
    const session = { setCertificateVerifyProc: set }
    transport.installSession(session)
    const certificateData = await readFile(certificatePath, 'utf8')
    const fingerprint = new X509Certificate(certificateData).fingerprint256
    type Request = Parameters<NonNullable<typeof callback>>[0]
    function verify(hostname: string, value: string, data = certificateData) {
      if (!callback)
        throw new Error('TEST_VERIFY_CALLBACK_MISSING')
      const response = vi.fn()
      callback({ hostname, certificate: { fingerprint: value, data } } as Request, response)
      return response
    }
    expect(verify('api.deepseek.com', fingerprint)).toHaveBeenCalledWith(0)
    expect(verify('different.invalid', fingerprint)).toHaveBeenCalledWith(-3)
    expect(verify('api.deepseek.com', '00:00', rootCertificates[0])).toHaveBeenCalledWith(-2)
    transport.dispose()
    expect(set).toHaveBeenLastCalledWith(null)
  })

  it('derives SHA256 from actual PEM despite Electron fingerprint metadata formats', async () => {
    const transport = await create()
    let callback: Parameters<Session['setCertificateVerifyProc']>[0] | undefined
    transport.installSession({ setCertificateVerifyProc: (listener) => {
      callback = listener
    } })
    const data = await readFile(certificatePath, 'utf8')
    const certificate = new X509Certificate(data)
    if (!callback)
      throw new Error('TEST_VERIFY_CALLBACK_MISSING')
    type Request = Parameters<NonNullable<typeof callback>>[0]
    for (const fingerprint of [certificate.fingerprint, `sha256/${certificate.fingerprint256.replaceAll(':', '').toLowerCase()}`]) {
      const result = vi.fn()
      callback({ hostname: 'api.deepseek.com', certificate: { data, fingerprint } } as Request, result)
      expect(result).toHaveBeenCalledWith(0)
    }
    const malformed = vi.fn()
    callback({ hostname: 'api.deepseek.com', certificate: { data: 'malformed PEM', fingerprint: certificate.fingerprint256 } } as Request, malformed)
    expect(malformed).toHaveBeenCalledWith(-2)
  })

  it('rejects a real nonfixture certificate even when normal Chromium verification succeeds', async () => {
    const transport = await create()
    let callback: Parameters<Session['setCertificateVerifyProc']>[0] | undefined
    transport.installSession({ setCertificateVerifyProc: (listener) => {
      callback = listener
    } })
    // Node's bundled public trust store supplies real certificate bytes without a network request.
    const realCertificate = new X509Certificate(rootCertificates[0])
    if (!callback)
      throw new Error('TEST_VERIFY_CALLBACK_MISSING')
    const response = vi.fn()
    type Request = Parameters<NonNullable<typeof callback>>[0]
    callback({ hostname: 'api.deepseek.com', verificationResult: 'net::OK', errorCode: 0, isIssuedByKnownRoot: true, certificate: { fingerprint: realCertificate.fingerprint256, data: realCertificate.toString() } } as Request, response)
    expect(response).toHaveBeenCalledWith(-2)
  })

  it('accepts Chromium style TLS preflight only at the approved fixture path', async () => {
    const transport = await create()
    const ca = await readFile(certificatePath)
    const result = await new Promise<number | undefined>((accept, reject) => {
      const outgoing = request({ hostname: '127.0.0.1', port: transport.port, path: '/chat/completions', method: 'OPTIONS', ca, servername: 'api.deepseek.com' }, (response) => {
        response.resume()
        response.once('end', () => accept(response.statusCode))
      })
      outgoing.once('error', reject)
      outgoing.end()
    })
    expect(result).toBe(204)
    expect(transport.summary().requests).toBe(0)
  })

  it('stops routing after disposal without changing global fetch', async () => {
    const original = globalThis.fetch
    const transport = await create()
    expect(globalThis.fetch).toBe(original)
    transport.dispose()
    await expect(transport.fetch(endpoint, options())).rejects.toThrow('QUALIFICATION_REQUEST_FAILED')
  })

  it('rejects noncertificate files with a stable startup error', async () => {
    const bad = join(directory, 'not-a-certificate.pem')
    await writeFile(bad, Buffer.from('synthetic invalid PEM'))
    await expect(createQualificationTransport({ certificatePath: bad, keyPath, authorize: () => authorization })).rejects.toThrow('QUALIFICATION_TRANSPORT_START_FAILED')
  })
})
