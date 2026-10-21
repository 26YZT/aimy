import type { IpcMainEvent, WebContents } from 'electron'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { appendFileSync, writeFileSync } from 'node:fs'
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { isAbsolute, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { app, ipcMain, session } from 'electron'

import * as v from 'valibot'

import { loadAcceptanceLedger } from '../../src/main/services/aimy/acceptance-config'
import { ProviderSecretVault } from '../../src/main/services/aimy/provider-secrets'
import { registerBaselineTransport } from './baseline-transport'
import { offlineFlush, offlineInfo } from './offline-events'
import { installOfflineNodeNetworkGuard } from './offline-network'

const integer = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535))
const path = v.pipe(v.string(), v.check(isAbsolute))
const configSchema = v.strictObject({
  mode: v.literal('offline-fixture'),
  arm: v.picklist(['airi', 'aimy']),
  caseId: v.pipe(v.string(), v.regex(/^USER-V2-0[1-8]$/)),
  runId: v.pipe(v.string(), v.regex(/^[\w-]{1,120}$/)),
  taskRoot: path,
  profile: path,
  entry: path,
  evidenceDirectory: path,
  campaignConfig: path,
  modelPort: integer,
  channelPort: integer,
})

function check(condition: unknown, code: string): asserts condition {
  if (!condition)
    throw new Error(code)
}

async function ownedPath(root: string, candidate: string) {
  const canonical = await realpath(candidate)
  const subpath = relative(root, canonical)
  check(subpath && subpath !== '..' && !subpath.startsWith(`..${sep}`) && !isAbsolute(subpath), 'OFFLINE_PATH_NOT_OWNED')
  return canonical
}

async function run() {
  const configPath = process.env.AIMY_OFFLINE_HOST_CONFIG
  check(configPath && isAbsolute(configPath), 'OFFLINE_CONFIG_REQUIRED')
  const file = await lstat(configPath)
  check(file.isFile() && !file.isSymbolicLink() && file.size < 32_768, 'OFFLINE_CONFIG_INVALID')
  const config = v.parse(configSchema, JSON.parse(await readFile(configPath, 'utf8')))
  const taskRoot = await realpath(config.taskRoot)
  check((JSON.parse(await readFile(join(taskRoot, '.aimy-offline-run.json'), 'utf8'))).realCredentials === false, 'OFFLINE_TASK_MARKER_REQUIRED')
  await Promise.all([config.profile, config.entry, config.evidenceDirectory, config.campaignConfig].map(value => ownedPath(taskRoot, value)))
  check((JSON.parse(await readFile(join(config.profile, '.aimy-offline-profile.json'), 'utf8'))).caseId === config.caseId, 'OFFLINE_PROFILE_MARKER_REQUIRED')
  check(process.env.APP_USER_DATA_PATH === config.profile, 'OFFLINE_PROFILE_ENV_MISMATCH')
  app.setPath('userData', config.profile)
  const networkGuard = installOfflineNodeNetworkGuard([config.modelPort, config.channelPort, Number(process.env.APP_REMOTE_DEBUG_PORT)])
  const { context } = createContext(ipcMain)
  const expectedDocument = pathToFileURL(join(config.entry, '../../renderer/index.html')).href
  let boundSender: WebContents | undefined
  const authorizeSender = (sender: WebContents) => {
    if (sender.isDestroyed())
      return false
    const url = new URL(sender.getURL())
    if (`${url.protocol}//${url.host}${url.pathname}` !== expectedDocument || url.searchParams.get('synced-leader') === 'false' || (url.hash && url.hash !== '#/'))
      return false
    if (boundSender && boundSender !== sender)
      return false
    boundSender = sender
    return true
  }
  const authorize = (event: IpcMainEvent | undefined) => check(event && event.senderFrame === event.sender.mainFrame && authorizeSender(event.sender), 'OFFLINE_PERMISSION_DENIED')
  const counts = { requests: 0, chat: 0, extraction: 0, blockedNetwork: 0, authorizationRejected: 0 }
  const credentialPath = join(config.profile, 'acceptance-credential-reference.json')
  const providerInstanceId = `offline-instance-${config.arm}-${config.caseId}`
  const endpoint = `http://127.0.0.1:${config.modelPort}`
  const nativeFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    check(url.origin === endpoint, 'OFFLINE_NETWORK_DENIED')
    return nativeFetch(input, init)
  }
  let transport: ReturnType<typeof registerBaselineTransport> | undefined
  const ready = app.whenReady().then(async () => {
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url)
      const allowed = !['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)
        || (url.hostname === '127.0.0.1' && [String(config.modelPort), String(config.channelPort)].includes(url.port))
      if (!allowed)
        counts.blockedNetwork++
      callback({ cancel: !allowed })
    })
    const vault = new ProviderSecretVault({ filePath: join(config.profile, 'provider-secrets.json') })
    let reference
    try {
      reference = v.parse(v.strictObject({ secretRef: v.pipe(v.string(), v.uuid()), revision: v.pipe(v.number(), v.integer(), v.minValue(1)) }), JSON.parse(await readFile(credentialPath, 'utf8')))
    }
    catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT')
        throw new Error('OFFLINE_CREDENTIAL_REFERENCE_INVALID')
      // Generated here; neither runner, CDP, logs nor the baseline renderer receives it.
      reference = await vault.write({ providerId: providerInstanceId, secrets: { config: JSON.stringify({ apiKey: `fixture-only-${randomUUID()}` }) } })
      await writeFile(credentialPath, JSON.stringify(reference), { flag: 'wx', mode: 0o600 })
    }
    const privateValues = await vault.read({ providerId: providerInstanceId, reference })
    const privateConfig: unknown = JSON.parse(privateValues.config)
    check(privateConfig && typeof privateConfig === 'object' && 'apiKey' in privateConfig && typeof privateConfig.apiKey === 'string' && privateConfig.apiKey.startsWith('fixture-only-'), 'OFFLINE_CREDENTIAL_NOT_SYNTHETIC')
    const authorization = `Bearer ${privateConfig.apiKey}`
    const ledger = await loadAcceptanceLedger(config.campaignConfig, config.profile)
    check(ledger, 'OFFLINE_LEDGER_REQUIRED')
    const campaign = ledger.info()
    check(campaign.price.mode === 'synthetic' && campaign.price.providerId === 'deepseek'
      && campaign.price.modelId === 'deepseek-flash' && campaign.price.inputMicroYuanPerMillion === 0
      && campaign.price.outputMicroYuanPerMillion === 0, 'OFFLINE_ZERO_PRICE_REQUIRED')
    const server = createServer(async (request, response) => {
      response.setHeader('access-control-allow-origin', '*')
      response.setHeader('access-control-allow-headers', 'authorization,content-type')
      response.setHeader('access-control-allow-methods', 'POST,OPTIONS')
      if (request.method === 'OPTIONS') {
        response.writeHead(204).end()
        return
      }
      try {
        check(request.method === 'POST' && request.url === '/v1/chat/completions', 'OFFLINE_REQUEST_ROUTE')
        if (request.headers.authorization !== authorization) {
          counts.authorizationRejected++
          throw new Error('OFFLINE_AUTHORIZATION_INVALID')
        }
        const chunks: Buffer[] = []
        let bytes = 0
        for await (const chunk of request) {
          bytes += chunk.length
          check(bytes <= 64_000, 'OFFLINE_REQUEST_TOO_LARGE')
          chunks.push(chunk)
        }
        const body = Buffer.concat(chunks).toString('utf8')
        const payload = v.parse(v.object({
          model: v.literal('deepseek-flash'),
          messages: v.array(v.object({ role: v.string(), content: v.unknown() })),
          thinking: v.object({ type: v.literal('disabled') }),
          max_tokens: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(2048)),
        }), JSON.parse(body))
        check(!body.includes('"image_url"') && !body.includes('"function_call"'), 'OFFLINE_TEXT_ONLY_REQUIRED')
        const last = payload.messages.at(-1)?.content
        let extraction: { allowedSources: Array<{ ref: { sourceId: string }, text: string }> } | undefined
        if (typeof last === 'string' && last.startsWith('{')) {
          const parsed: unknown = JSON.parse(last)
          if (parsed && typeof parsed === 'object' && 'allowedSources' in parsed)
            extraction = v.parse(v.object({ allowedSources: v.array(v.object({ ref: v.object({ sourceId: v.string() }), text: v.string() })) }), parsed)
        }
        const content = extraction
          ? JSON.stringify({ schemaVersion: 1, candidates: extraction.allowedSources.slice(0, 1).map(source => ({
              category: 'experience',
              subject: 'user',
              label: '离线管线测试原话片段',
              text: source.text.trim().slice(0, 1000),
              keywords: [source.text.trim().slice(0, 8)],
              sourceRefIds: [source.ref.sourceId],
            })) })
          : '这是离线固定响应，仅用于验证消息保存和请求流程，不代表 Aimy 的真实理解或陪伴效果。'
        counts.requests++
        if (extraction)
          counts.extraction++
        else
          counts.chat++
        appendFileSync(join(config.evidenceDirectory, 'requests.jsonl'), `${JSON.stringify({ index: counts.requests, kind: extraction ? 'memory-fixture' : 'chat-fixture', receivedAt: new Date().toISOString(), payload: JSON.parse(body) })}\n`, { mode: 0o600 })
        const usage = { prompt_tokens: Math.ceil(Buffer.byteLength(body) / 4), completion_tokens: Math.ceil(Buffer.byteLength(content) / 4), prompt_cache_hit_tokens: 0 }
        if (JSON.parse(body).stream) {
          response.writeHead(200, { 'content-type': 'text/event-stream' })
          response.write(`data: ${JSON.stringify({ id: randomUUID(), choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] })}\n\n`)
          setTimeout(() => {
            response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage })}\n\n`)
            response.end('data: [DONE]\n\n')
          }, 20)
        }
        else {
          response.writeHead(200, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ id: randomUUID(), choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage }))
        }
      }
      catch {
        response.writeHead(400, { 'content-type': 'application/json' }).end('{"error":{"message":"Offline fixture rejected request"}}')
      }
    })
    await new Promise<void>((accept, reject) => {
      server.once('error', reject)
      server.listen(config.modelPort, '127.0.0.1', accept)
    })
    if (config.arm === 'airi') {
      transport = registerBaselineTransport({ context, campaign, budget: ledger, providerDefinition: { id: 'deepseek' }, getRun: () => ({ arm: 'airi', caseId: config.caseId, runId: config.runId, epoch: 1 }), authorizeSender, prepareTransport: async () => (url, init) => {
        check(url.origin === endpoint && url.pathname === '/v1/chat/completions', 'OFFLINE_ENDPOINT_MISMATCH')
        const headers = new Headers(init.headers)
        headers.set('authorization', authorization)
        return nativeFetch(url, { ...init, headers, redirect: 'error' })
      } })
    }
    app.once('will-quit', () => {
      transport?.dispose()
      server.closeAllConnections()
      server.close()
      writeFileSync(join(config.evidenceDirectory, 'host-final.json'), JSON.stringify({ mode: 'offline-fixture', pid: process.pid, ...counts, nodeNetwork: networkGuard.summary(), transport: transport?.summary() }), { mode: 0o600 })
    })
    return { ledger, reference, vault }
  })
  defineInvokeHandler(context, offlineInfo, async (_, metadata) => {
    try {
      authorize(metadata?.raw.ipcMainEvent)
      const { ledger, reference } = await ready
      authorize(metadata?.raw.ipcMainEvent)
      return { ok: true as const, value: { mode: 'offline-fixture' as const, phase: 'run' as const, arm: config.arm, caseId: config.caseId, runId: config.runId, epoch: 1, campaign: ledger.info(), providerInstanceId, baseURL: `${endpoint}/v1/`, modelId: 'deepseek-flash' as const, reference } }
    }
    catch { return { ok: false as const, code: 'OFFLINE_HOST_UNAVAILABLE' } }
  })
  defineInvokeHandler(context, offlineFlush, async (_, metadata) => {
    try {
      authorize(metadata?.raw.ipcMainEvent)
      const { ledger, vault } = await ready
      await transport?.flush()
      await ledger.flush()
      await vault.flush()
      authorize(metadata?.raw.ipcMainEvent)
      return { ok: true as const, value: { budget: await ledger.status(), requests: counts.requests } }
    }
    catch { return { ok: false as const, code: 'OFFLINE_HOST_FLUSH_FAILED' } }
  })
  void ready.catch(() => {
    writeFileSync(join(config.evidenceDirectory, 'host-error.json'), JSON.stringify({ code: 'OFFLINE_HOST_INITIALIZATION_FAILED' }))
    app.exit(1)
  })
  // Import before ready: Electron's original scheme registration must keep its ordering.
  await import(pathToFileURL(config.entry).href)
}

try {
  await run()
}
catch {
  console.error('OFFLINE_HOST_START_FAILED')
  app.exit(1)
}
