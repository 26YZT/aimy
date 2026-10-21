import type { Buffer } from 'node:buffer'
import type { ChildProcess } from 'node:child_process'
import type { IncomingMessage } from 'node:http'
import type { Server, Socket } from 'node:net'

import process from 'node:process'

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, appendFile, lstat, mkdir, open, readdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer, request as httpRequest } from 'node:http'
import { createRequire } from 'node:module'
import { connect, createServer } from 'node:net'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CdpClient, isRecord } from '../lib/remote-debug'

interface Options { entry: string, profile: string, campaignConfig: string, output: string, checkOnly: boolean }
interface Paths extends Options { electron: string, ledger: string, fixtureRoot: string, entrySha256: string, configSha256: string, markerSha256: string }
interface Projection {
  ready: true
  scope: { principalId: string, characterId: string }
  factCount: number
  factsSha256: string
  pendingJobCount: number
  failedJobCount: number
  modelRoutesSafe: boolean
  routeChecks: { chatProvider: boolean, chatDefinition: boolean, chatModel: boolean, chatEndpoint: boolean, followsChat: boolean }
}
interface ExitStatus { code: number | null, signal: string | null, forced: boolean }
interface RunEvidence {
  pid?: number
  cdpPort: number
  channelPort: number
  proxyPort: number
  portOwners?: { cdp: number[], channel: number[] }
  projection?: Projection
  exit?: ExitStatus
  network: { forwardedChannel: number, blockedGeneration: number, blockedMetadata: number, blockedOther: number }
}

const markerName = '.aimy-synthetic-profile.json'
const marker = { schemaVersion: 1, purpose: 'aimy-first-increment-offline', createdByTask: '2026-10-15-first-increment', realCredentials: false }
const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const readinessTimeoutMs = 120_000
const exitTimeoutMs = 12_000
let interrupted = false
let activeChild: ChildProcess | undefined

class SmokeFailure extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

function requireCondition(condition: unknown, code: string): asserts condition {
  if (!condition)
    throw new SmokeFailure(code)
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(canonical)
  if (isRecord(value))
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return !!path && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

function parseArguments(args: string[]): Options {
  const values = new Map<string, string>()
  let checkOnly = false
  const names = ['--entry', '--profile', '--campaign-config', '--output']
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === '--check-only') {
      requireCondition(!checkOnly, 'DUPLICATE_ARGUMENT')
      checkOnly = true
      continue
    }
    requireCondition(names.includes(argument), 'UNKNOWN_ARGUMENT')
    const value = args[++index]
    requireCondition(value && !value.startsWith('--') && !values.has(argument), 'INVALID_ARGUMENT')
    requireCondition(isAbsolute(value) && value.length < 4096, 'ABSOLUTE_PATH_REQUIRED')
    values.set(argument, value)
  }
  requireCondition(names.every(name => values.has(name)), 'MISSING_REQUIRED_ARGUMENT')
  return { entry: values.get('--entry')!, profile: values.get('--profile')!, campaignConfig: values.get('--campaign-config')!, output: values.get('--output')!, checkOnly }
}

async function jsonFile(path: string, limit = 64 * 1024): Promise<{ value: unknown, digest: string }> {
  const info = await lstat(path)
  requireCondition(info.isFile() && !info.isSymbolicLink() && info.size <= limit, 'INVALID_INPUT_FILE')
  const bytes = await readFile(path)
  return { value: JSON.parse(bytes.toString('utf8')), digest: sha256(bytes) }
}

async function canonicalNewPath(path: string): Promise<string> {
  try {
    return await realpath(path)
  }
  catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT')
      throw error
    const parent = dirname(path)
    requireCondition(parent !== path, 'UNKNOWN_PATH_OWNERSHIP')
    return join(await canonicalNewPath(parent), basename(path))
  }
}

async function absent(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return false
  }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return true
    throw error
  }
}

async function validateConfiguration(options: Options): Promise<Paths> {
  const entry = await realpath(options.entry)
  requireCondition(inside(await realpath(join(appDirectory, 'out', 'main')), entry) && /^index\.(?:mjs|cjs|js)$/.test(basename(entry)), 'ENTRY_OUTSIDE_BUILD')
  const entryBytes = await readFile(entry)
  const campaignConfig = await realpath(options.campaignConfig)
  const fixtureRoot = dirname(campaignConfig)
  const profileInfo = await lstat(options.profile)
  const profile = await realpath(options.profile)
  requireCondition(profileInfo.isDirectory() && !profileInfo.isSymbolicLink() && inside(fixtureRoot, profile), 'UNKNOWN_PROFILE_OWNERSHIP')
  // The first increment uses macOS. A synthetic marker never authorizes an ordinary application-data directory.
  requireCondition(!inside(join(homedir(), 'Library', 'Application Support'), profile), 'DEFAULT_PROFILE_FORBIDDEN')
  requireCondition(await absent(join(profile, 'SingletonLock')), 'PROFILE_ALREADY_IN_USE')
  requireCondition(await absent(join(profile, '.aimy-memory-restart.lock')), 'PROFILE_SMOKE_ALREADY_IN_USE')
  requireCondition(!await absent(join(profile, markerName)), 'SYNTHETIC_MARKER_REQUIRED')
  const profileMarker = await jsonFile(join(profile, markerName), 4096)
  const markerValue = profileMarker.value
  requireCondition(isRecord(markerValue) && Object.keys(markerValue).length === Object.keys(marker).length
    && Object.entries(marker).every(([key, value]) => markerValue[key] === value), 'SYNTHETIC_MARKER_REQUIRED')

  const config = await jsonFile(campaignConfig)
  requireCondition(isRecord(config.value) && Object.keys(config.value).every(key => ['ledgerPath', 'campaign'].includes(key)), 'INVALID_CAMPAIGN_CONFIG')
  const campaign = config.value.campaign
  requireCondition(isRecord(campaign) && typeof config.value.ledgerPath === 'string' && isAbsolute(config.value.ledgerPath), 'INVALID_CAMPAIGN_CONFIG')
  const price = campaign.price
  requireCondition(isRecord(price) && price.mode === 'synthetic' && price.providerId === 'openai-compatible' && price.modelId === 'synthetic-memory'
    && price.id === 'synthetic-zero-price' && price.verifiedAt === 'synthetic-fixture' && price.sourceUrl === 'https://example.invalid/aimy-synthetic'
    && price.currency === 'CNY' && price.inputMicroYuanPerMillion === 0 && price.outputMicroYuanPerMillion === 0
    && (price.cachedInputMicroYuanPerMillion === undefined || price.cachedInputMicroYuanPerMillion === 0)
    && typeof campaign.campaignId === 'string' && campaign.campaignId.startsWith('aimy-first-increment-synthetic-')
    && typeof campaign.maxCostMicroYuan === 'number' && Number.isSafeInteger(campaign.maxCostMicroYuan) && campaign.maxCostMicroYuan > 0 && campaign.maxCostMicroYuan <= 10_000_000, 'SYNTHETIC_ZERO_PRICE_CAMPAIGN_REQUIRED')
  const ledger = await canonicalNewPath(config.value.ledgerPath)
  requireCondition(inside(fixtureRoot, ledger) && !inside(profile, ledger) && ledger !== profile, 'UNKNOWN_LEDGER_OWNERSHIP')
  const output = await canonicalNewPath(options.output)
  requireCondition(inside(fixtureRoot, output) && !inside(profile, output) && !inside(output, profile) && output !== profile && output !== ledger && !inside(output, ledger), 'UNKNOWN_OUTPUT_OWNERSHIP')
  if (!await absent(output))
    requireCondition((await lstat(output)).isDirectory() && (await readdir(output)).length === 0, 'OUTPUT_MUST_BE_NEW_OR_EMPTY')
  const serverConfigPath = join(profile, 'server-channel-config.json')
  if (!await absent(serverConfigPath)) {
    const channel = (await jsonFile(serverConfigPath)).value
    requireCondition(isRecord(channel) && (channel.hostname === undefined || channel.hostname === '127.0.0.1') && !channel.tlsConfig, 'UNSAFE_CHANNEL_CONFIG')
  }
  const require = createRequire(import.meta.url)
  const electronPackage = dirname(require.resolve('electron/package.json'))
  const executable: unknown = require('electron')
  requireCondition(typeof executable === 'string', 'ELECTRON_NOT_INSTALLED')
  const electron = await realpath(executable)
  requireCondition(inside(await realpath(join(electronPackage, 'dist')), electron), 'UNKNOWN_ELECTRON_OWNERSHIP')
  await access(electron, constants.X_OK)
  return { ...options, entry, profile, campaignConfig, output, electron, ledger, fixtureRoot, entrySha256: sha256(entryBytes), configSha256: config.digest, markerSha256: profileMarker.digest }
}

async function reservePort(): Promise<{ port: number, server: Server }> {
  const server = createServer()
  await new Promise<void>((accept, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, accept)
  })
  const address = server.address()
  requireCondition(address && typeof address === 'object' && address.port !== 6121, 'PORT_ALLOCATION_FAILED')
  return { port: address.port, server }
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>(accept => server.close(() => accept()))
}

async function bounded<T>(promise: Promise<T>, timeoutMs: number, code: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new SmokeFailure(code)), timeoutMs)
    })])
  }
  finally {
    clearTimeout(timer)
  }
}

/** Chromium bypasses loopback proxies by default. The launcher explicitly disables that bypass. */
async function startNetworkGuard(channelPort: number, evidence: RunEvidence, record: (event: object) => void) {
  const sockets = new Set<Socket>()
  function targetFor(request: IncomingMessage): URL | undefined {
    try {
      return new URL(request.url ?? '')
    }
    catch { return undefined }
  }
  function isChannel(target: URL | undefined): target is URL {
    return !!target && ['http:', 'ws:'].includes(target.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
      && Number(target.port) === channelPort && !target.username && !target.password
  }
  function deny(request: IncomingMessage, target: URL | undefined) {
    const path = target?.pathname ?? ''
    const generation = (request.method !== 'GET' || request.headers.upgrade === 'websocket') && /\/(?:chat\/completions|responses|completions|generate|audio\/speech|audio\/transcriptions)(?:\/|$)/.test(path)
    const metadata = ['GET', 'HEAD'].includes(request.method ?? '') && /\/(?:models|voices)(?:\/|$)/.test(path)
    const kind = generation ? 'blockedGeneration' : metadata ? 'blockedMetadata' : 'blockedOther'
    evidence.network[kind]++
    // Query, userinfo, headers and bodies never enter evidence, including its hashes.
    record({ event: kind, routeSha256: sha256(target ? `${target.protocol}//${target.hostname}:${target.port}${path}` : 'unparsed') })
  }
  const server = createHttpServer((request, response) => {
    const target = targetFor(request)
    if (!isChannel(target)) {
      deny(request, target)
      response.writeHead(403).end()
      request.resume()
      return
    }
    evidence.network.forwardedChannel++
    const upstream = httpRequest({ hostname: '127.0.0.1', port: channelPort, method: request.method, path: `${target.pathname}${target.search}`, headers: { ...request.headers, host: target.host } }, (result) => {
      response.writeHead(result.statusCode ?? 502, result.headers)
      result.pipe(response)
    })
    upstream.on('error', () => {
      if (!response.headersSent && !response.destroyed)
        response.writeHead(502)
      response.end()
    })
    response.once('close', () => upstream.destroy())
    request.on('error', () => upstream.destroy())
    request.pipe(upstream)
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  server.on('connect', (request, socket) => {
    deny(request, undefined)
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
  })
  server.on('upgrade', (request, socket, head) => {
    const target = targetFor(request)
    if (!isChannel(target)) {
      deny(request, target)
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    evidence.network.forwardedChannel++
    const upstream = connect(channelPort, '127.0.0.1', () => {
      const headers = Object.entries(request.headers).filter(([key]) => key !== 'proxy-authorization' && key !== 'proxy-connection').map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`).join('\r\n')
      upstream.write(`${request.method} ${target.pathname}${target.search} HTTP/1.1\r\n${headers}\r\n\r\n`)
      if (head.length)
        upstream.write(head)
      socket.pipe(upstream).pipe(socket)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
    socket.once('close', () => upstream.destroy())
  })
  await new Promise<void>((accept, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, accept)
  })
  const address = server.address()
  requireCondition(address && typeof address === 'object', 'PROXY_BIND_FAILED')
  return { port: address.port, close: async () => {
    sockets.forEach(socket => socket.destroy())
    await closeServer(server)
  } }
}

async function portOwners(port: number): Promise<number[]> {
  const child = spawn('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpn'], { stdio: ['ignore', 'pipe', 'pipe'] })
  let text = ''
  child.stdout.on('data', chunk => text += String(chunk))
  const done = new Promise<void>((accept, reject) => {
    child.once('error', () => reject(new SmokeFailure('PORT_OWNER_CHECK_UNAVAILABLE')))
    child.once('exit', code => code === 0 || (code === 1 && !text.trim()) ? accept() : reject(new SmokeFailure('PORT_OWNER_CHECK_FAILED')))
  })
  try {
    await bounded(done, 5000, 'PORT_OWNER_CHECK_TIMEOUT')
  }
  finally {
    if (child.exitCode === null)
      child.kill('SIGKILL')
  }
  const lines = text.split('\n')
  const listeners = lines.filter(line => line.startsWith('n')).map(line => line.slice(1))
  if (!listeners.length)
    return []
  requireCondition(listeners.length && listeners.every(value => /^(?:127\.0\.0\.1|\[::1\]):\d+$/.test(value)), 'NON_LOOPBACK_LISTENER')
  return [...new Set(lines.filter(line => /^p\d+$/.test(line)).map(line => Number(line.slice(1))))]
}

const projectionExpression = `(async () => {
  const pinia = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$pinia;
  const memory = pinia?._s?.get('aimy-memory');
  if (!memory?.ready || memory.busy || memory.recovering) return null;
  const consciousness = pinia._s.get('consciousness');
  const providers = pinia._s.get('provider-config');
  const safeRoute = (providerId, modelId) => {
    if (!providerId || modelId !== 'synthetic-memory') return false;
    const provider = providers?.getProvider(providerId);
    if (provider?.definitionId !== 'openai-compatible') return false;
    const config = providers.getProviderConfig(providerId);
    const address = config?.baseUrl ?? config?.baseURL;
    try {
      const url = new URL(address);
      return url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)
        && !!url.port && !url.username && !url.password && !url.search && !url.hash;
    } catch { return false; }
  };
  const chatSafe = safeRoute(consciousness?.activeProvider, consciousness?.activeModel);
  const policy = memory.modelPolicy;
  const memorySafe = policy?.mode === 'follow-chat' ? chatSafe : safeRoute(policy?.providerId, policy?.modelId);
  const routeChecks = {chatProvider:!!consciousness?.activeProvider,
    chatDefinition:providers?.getProvider(consciousness?.activeProvider)?.definitionId === 'openai-compatible',
    chatModel:consciousness?.activeModel === 'synthetic-memory', chatEndpoint:chatSafe, followsChat:policy?.mode === 'follow-chat'};
  const canonical = value => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const facts = [...memory.facts].sort((left, right) => left.factId.localeCompare(right.factId));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(facts))));
  return {ready:true, scope:{principalId:memory.scope?.principalId, characterId:memory.scope?.characterId},
    factCount:facts.length, factsSha256:Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,'0')).join(''),
    pendingJobCount:memory.pendingJobCount, failedJobCount:memory.failedJobCount, modelRoutesSafe:chatSafe && memorySafe, routeChecks};
})()`

async function ledgerFingerprint(path: string) {
  if (await absent(path))
    return { exists: false, attempts: 0, recordsSha256: sha256('{}'), paused: false }
  const ledger = (await jsonFile(path, 8 * 1024 * 1024)).value
  requireCondition(isRecord(ledger) && isRecord(ledger.records), 'INVALID_LEDGER')
  return { exists: true, attempts: Object.keys(ledger.records).length, recordsSha256: sha256(JSON.stringify(canonical(ledger.records))), paused: ledger.paused === true }
}

async function runProcess(paths: Paths, evidence: RunEvidence, record: (event: object) => void): Promise<void> {
  const cdpReservation = await reservePort()
  let channelReservation: Awaited<ReturnType<typeof reservePort>>
  try {
    channelReservation = await reservePort()
  }
  catch (error) {
    await closeServer(cdpReservation.server)
    throw error
  }
  evidence.cdpPort = cdpReservation.port
  evidence.channelPort = channelReservation.port
  let proxy: Awaited<ReturnType<typeof startNetworkGuard>>
  try {
    proxy = await startNetworkGuard(evidence.channelPort, evidence, record)
  }
  catch (error) {
    await Promise.all([closeServer(cdpReservation.server), closeServer(channelReservation.server)])
    throw error
  }
  evidence.proxyPort = proxy.port
  let child: ChildProcess | undefined
  let page: CdpClient | undefined
  let browser: CdpClient | undefined
  let exited: ExitStatus | undefined
  let exit: Promise<ExitStatus> | undefined
  const childEnv: NodeJS.ProcessEnv = {}
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL']) {
    if (process.env[key])
      childEnv[key] = process.env[key]
  }
  Object.assign(childEnv, { APP_USER_DATA_PATH: paths.profile, APP_REMOTE_DEBUG: 'true', APP_REMOTE_DEBUG_NO_OPEN: 'true', APP_REMOTE_DEBUG_PORT: String(evidence.cdpPort), SERVER_CHANNEL_PORT: String(evidence.channelPort), SERVER_RUNTIME_HOSTNAME: '127.0.0.1', AIMY_ACCEPTANCE_CONFIG: paths.campaignConfig })
  try {
    await closeServer(cdpReservation.server)
    await closeServer(channelReservation.server)
    child = spawn(paths.electron, [paths.entry, '--remote-debugging-address=127.0.0.1', `--proxy-server=http://127.0.0.1:${proxy.port}`, '--proxy-bypass-list=<-loopback>', '--disable-background-networking'], { cwd: appDirectory, env: childEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    activeChild = child
    evidence.pid = child.pid
    exit = new Promise<ExitStatus>((accept) => {
      child!.once('error', () => {
        exited = { code: null, signal: 'spawn-error', forced: false }
        accept(exited)
      })
      child!.once('exit', (code, signal) => {
        exited = { code, signal, forced: false }
        accept(exited)
      })
    })
    requireCondition(child.pid, 'ELECTRON_SPAWN_FAILED')
    for (const [stream, source] of [['stdout', child.stdout], ['stderr', child.stderr]] as const) {
      source?.on('data', (chunk: Buffer) => record({ event: 'child-log-digest', pid: child!.pid, stream, bytes: chunk.length, sha256: sha256(chunk) }))
    }
    record({ event: 'process-start', pid: child.pid, cdpPort: evidence.cdpPort, channelPort: evidence.channelPort, proxyPort: proxy.port })
    const started = performance.now()
    let stable: Projection | undefined
    let stableCount = 0
    while (performance.now() - started < readinessTimeoutMs) {
      requireCondition(!interrupted && !exited, interrupted ? 'INTERRUPTED' : 'CHILD_EXITED_BEFORE_READY')
      if (!page) {
        try {
          const version: unknown = await (await fetch(`http://127.0.0.1:${evidence.cdpPort}/json/version`, { signal: AbortSignal.timeout(1500) })).json()
          requireCondition(isRecord(version) && typeof version.webSocketDebuggerUrl === 'string', 'INVALID_CDP_ENDPOINT')
          const debuggerUrl = new URL(version.webSocketDebuggerUrl)
          requireCondition(['127.0.0.1', 'localhost', '[::1]'].includes(debuggerUrl.hostname) && Number(debuggerUrl.port) === evidence.cdpPort && !debuggerUrl.username && !debuggerUrl.password && !debuggerUrl.search, 'FOREIGN_CDP_ENDPOINT')
          browser = await bounded(CdpClient.connect(debuggerUrl.href), 5000, 'CDP_CONNECT_TIMEOUT')
          const info = await bounded(browser.send('SystemInfo.getProcessInfo'), 5000, 'CDP_PID_TIMEOUT')
          const processInfo = isRecord(info.result) ? info.result.processInfo : undefined
          requireCondition(Array.isArray(processInfo) && processInfo.some(item => isRecord(item) && item.type === 'browser' && item.id === child!.pid), 'FOREIGN_ELECTRON_PID')
          const targets: unknown = await (await fetch(`http://127.0.0.1:${evidence.cdpPort}/json/list`, { signal: AbortSignal.timeout(1500) })).json()
          requireCondition(Array.isArray(targets), 'INVALID_CDP_TARGETS')
          const expectedDocument = resolve(dirname(paths.entry), '../renderer/index.html')
          const target = targets.find((candidate) => {
            if (!isRecord(candidate) || candidate.type !== 'page' || typeof candidate.url !== 'string')
              return false
            try {
              const url = new URL(candidate.url)
              return url.protocol === 'file:' && fileURLToPath(url) === expectedDocument && ['', '#', '#/'].includes(url.hash)
            }
            catch { return false }
          })
          if (!isRecord(target) || typeof target.webSocketDebuggerUrl !== 'string') {
            browser.close()
            browser = undefined
          }
          else {
            const pageUrl = new URL(target.webSocketDebuggerUrl)
            requireCondition(pageUrl.protocol === 'ws:' && ['127.0.0.1', 'localhost', '[::1]'].includes(pageUrl.hostname)
              && Number(pageUrl.port) === evidence.cdpPort && !pageUrl.username && !pageUrl.password && !pageUrl.search, 'FOREIGN_CDP_ENDPOINT')
            page = await bounded(CdpClient.connect(pageUrl.href), 5000, 'CDP_PAGE_TIMEOUT')
            const owners = { cdp: await portOwners(evidence.cdpPort), channel: await portOwners(evidence.channelPort) }
            if (!owners.cdp.length || !owners.channel.length) {
              page.close()
              page = undefined
              browser.close()
              browser = undefined
            }
            else {
              requireCondition(owners.cdp.length === 1 && owners.cdp[0] === child.pid && owners.channel.length === 1 && owners.channel[0] === child.pid, 'FOREIGN_PORT_OWNER')
              evidence.portOwners = owners
            }
          }
        }
        catch (error) {
          browser?.close()
          browser = undefined
          if (error instanceof SmokeFailure)
            throw error
        }
      }
      if (page) {
        const projection = await bounded(page.evaluate<Projection | null>(projectionExpression), 5000, 'PROJECTION_TIMEOUT')
        if (projection) {
          record({ event: 'projection-route-check', scopeIsLocal: projection.scope?.principalId === 'local', characterScopeValid: /^[\w-]{1,160}$/.test(projection.scope?.characterId ?? ''), checks: projection.routeChecks })
          requireCondition(projection.modelRoutesSafe && projection.scope?.principalId === 'local' && /^[\w-]{1,160}$/.test(projection.scope.characterId), 'UNSAFE_PROFILE_MODEL_OR_SCOPE')
          requireCondition(projection.pendingJobCount === 0, 'PENDING_MODEL_JOBS')
          requireCondition(projection.factCount > 0 && /^[a-f0-9]{64}$/.test(projection.factsSha256), 'NONEMPTY_MEMORY_FIXTURE_REQUIRED')
          stableCount = stable?.factsSha256 === projection.factsSha256 && JSON.stringify(stable.scope) === JSON.stringify(projection.scope) ? stableCount + 1 : 1
          stable = projection
          if (stableCount >= 2) {
            evidence.projection = projection
            break
          }
        }
      }
      await new Promise(accept => setTimeout(accept, 500))
    }
    requireCondition(evidence.projection, 'MEMORY_READY_TIMEOUT')
    requireCondition(evidence.network.blockedGeneration === 0, 'MODEL_GENERATION_ATTEMPTED')
    record({ event: 'memory-projection', pid: child.pid, projection: evidence.projection })
  }
  finally {
    page?.close()
    browser?.close()
    try {
      if (child && exit) {
        if (!exited)
          child.kill('SIGINT')
        try {
          evidence.exit = await bounded(exit, exitTimeoutMs, 'EXIT_TIMEOUT')
        }
        catch {
          evidence.exit = { code: null, signal: 'SIGKILL', forced: true }
          if (child.pid && child.exitCode === null && child.signalCode === null) {
            try {
              process.kill(-child.pid, 'SIGKILL')
            }
            catch { child.kill('SIGKILL') }
          }
          const outcome = await bounded(exit, 5000, 'FORCE_KILL_TIMEOUT')
          evidence.exit = { ...outcome, forced: true }
        }
        record({ event: 'process-exit', pid: child.pid, exit: evidence.exit })
      }
    }
    finally {
      activeChild = undefined
      await proxy.close()
      if (cdpReservation.server.listening)
        await closeServer(cdpReservation.server)
      if (channelReservation.server.listening)
        await closeServer(channelReservation.server)
    }
  }
  requireCondition(evidence.network.blockedGeneration === 0, 'MODEL_GENERATION_ATTEMPTED')
  requireCondition(evidence.exit?.code === 0 && !evidence.exit.signal && !evidence.exit.forced, 'GRACEFUL_EXIT_FAILED')
}

/**
 * Reads a marked synthetic profile in two independent Electron processes without generating model output.
 *
 * Call stack:
 * main
 *   -> {@link validateConfiguration}
 *   -> {@link runProcess} twice
 *   -> compare persisted projection digests
 */
async function main(): Promise<void> {
  const report: Record<string, unknown> = { status: 'FAIL', schemaVersion: 1, startedAt: new Date().toISOString(), runs: [] }
  let paths: Paths | undefined
  let ownedLock = false
  let logging: Promise<void> = Promise.resolve()
  let loggingFailed = false
  let logPath: string | undefined
  try {
    const options = parseArguments(process.argv.slice(2))
    paths = await validateConfiguration(options)
    requireCondition(process.platform === 'darwin' && typeof WebSocket === 'function', 'UNSUPPORTED_RUNTIME')
    if (paths.checkOnly) {
      console.info(JSON.stringify({ status: 'PREFLIGHT_OK', spawned: false, entry: paths.entry, profile: paths.profile, campaignConfig: paths.campaignConfig, output: paths.output, marker: markerName }))
      return
    }
    await mkdir(paths.output, { recursive: true, mode: 0o700 })
    logPath = join(paths.output, 'events.sanitized.jsonl')
    await writeFile(logPath, '', { flag: 'wx', mode: 0o600 })
    const lock = await open(join(paths.profile, '.aimy-memory-restart.lock'), 'wx', 0o600)
    ownedLock = true
    await lock.writeFile(JSON.stringify({ pid: process.pid, purpose: 'memory-restart-smoke' }))
    await lock.close()
    report.paths = { entry: paths.entry, profile: paths.profile, campaignConfig: paths.campaignConfig, ledger: paths.ledger, output: paths.output }
    report.fingerprints = { entry: paths.entrySha256, campaign: paths.configSha256, marker: paths.markerSha256 }
    report.logPolicy = 'Application output is stored only as chunk byte counts and SHA-256. Proxy evidence excludes headers, bodies, query and userinfo.'
    const before = await ledgerFingerprint(paths.ledger)
    report.ledgerBefore = before
    requireCondition(!before.paused, 'CAMPAIGN_ALREADY_PAUSED')
    const record = (event: object) => {
      const line = `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`
      logging = logging.then(() => appendFile(logPath!, line)).catch(() => {
        loggingFailed = true
      })
    }
    const runs: RunEvidence[] = []
    report.runs = runs
    for (let index = 0; index < 2; index++) {
      requireCondition(await absent(join(paths.profile, 'SingletonLock')), 'PROFILE_ALREADY_IN_USE')
      requireCondition(sha256(await readFile(paths.entry)) === paths.entrySha256 && (await jsonFile(paths.campaignConfig)).digest === paths.configSha256
        && (await jsonFile(join(paths.profile, markerName))).digest === paths.markerSha256, 'FIXTURE_CHANGED_DURING_RUN')
      const evidence: RunEvidence = { cdpPort: 0, channelPort: 0, proxyPort: 0, network: { forwardedChannel: 0, blockedGeneration: 0, blockedMetadata: 0, blockedOther: 0 } }
      runs.push(evidence)
      await runProcess(paths, evidence, record)
      const ledger = await ledgerFingerprint(paths.ledger)
      requireCondition(ledger.attempts === before.attempts && ledger.recordsSha256 === before.recordsSha256 && !ledger.paused, 'MODEL_ACCOUNTING_CHANGED')
    }
    const first = runs[0].projection!
    const second = runs[1].projection!
    requireCondition(runs[0].pid !== runs[1].pid && first.factCount === second.factCount && first.factsSha256 === second.factsSha256
      && JSON.stringify(first.scope) === JSON.stringify(second.scope), 'RESTART_PROJECTION_MISMATCH')
    report.status = 'PASS'
    report.ledgerAfter = await ledgerFingerprint(paths.ledger)
    report.modelRequests = 0
  }
  catch (error) {
    report.code = error instanceof SmokeFailure ? error.code : 'PREFLIGHT_OR_RUNTIME_FAILURE'
    process.exitCode = 1
  }
  finally {
    try {
      await logging
      if (loggingFailed) {
        report.status = 'FAIL'
        report.code = 'EVENT_LOG_WRITE_FAILED'
        process.exitCode = 1
      }
      if (paths && logPath) {
        report.finishedAt = new Date().toISOString()
        await writeFile(join(paths.output, 'memory-restart-report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
      }
    }
    finally {
      if (paths && ownedLock)
        await unlink(join(paths.profile, '.aimy-memory-restart.lock'))
    }
    if (!paths?.checkOnly || report.code)
      console.info(JSON.stringify({ status: report.status, code: report.code, report: logPath && paths ? join(paths.output, 'memory-restart-report.json') : undefined }))
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    interrupted = true
    activeChild?.kill('SIGINT')
  })
}

void main().catch(() => {
  process.exitCode = 1
  console.info(JSON.stringify({ status: 'FAIL', code: 'EVIDENCE_WRITE_OR_CLEANUP_FAILED' }))
})
