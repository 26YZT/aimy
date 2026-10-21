import type { IpcMainEvent, WebContents, WebFrameMain } from 'electron'

import type { LiveCredentialBinding } from './live-credential-contract'

import process from 'node:process'

import { appendFileSync, writeFileSync } from 'node:fs'
import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { app, ipcMain, session, webContents } from 'electron'

import * as v from 'valibot'

import { AcceptanceBudgetLedger } from '../../src/main/services/aimy/acceptance-budget'
import { ProviderSecretVault } from '../../src/main/services/aimy/provider-secrets'
import { registerBaselineTransport } from './baseline-transport'
import { sha256 } from './dataset'
import { acceptanceFlush, acceptanceInfo, acceptanceSetupInvalidate, acceptanceSetupRecord, acceptanceSetupStatus, acceptanceSetupUi } from './entry-events'
import { assertCampaignChild, assertLivePriceCurrent, openLiveCampaign, readCampaignJson, writeCampaignJson } from './live-campaign'
import { LiveCredentialBindingStore, readLiveCredentialBinding } from './live-credential'
import { installLiveNetworkPolicy } from './live-network'
import { LiveRequestClaims } from './live-request-claims'
import { installOfflineNodeNetworkGuard } from './offline-network'

const absolutePath = v.pipe(v.string(), v.check(isAbsolute))
const hostSchema = v.strictObject({
  phase: v.picklist(['setup', 'run']),
  arm: v.picklist(['airi', 'aimy']),
  campaignRoot: absolutePath,
  buildRoot: absolutePath,
  profile: absolutePath,
  evidenceDirectory: absolutePath,
  entry: absolutePath,
  entrySha256: v.pipe(v.string(), v.regex(/^[a-f\d]{64}$/)),
  caseId: v.pipe(v.string(), v.regex(/^(?:setup|USER-V2-0[1-8])$/)),
  runId: v.pipe(v.string(), v.regex(/^[\w-]{1,150}$/)),
  channelPort: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535)),
  debugPort: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535))),
  operationToken: v.pipe(v.string(), v.uuid()),
})

export type LiveHostConfig = v.InferOutput<typeof hostSchema>

/** Qualification supplies a local response at the native network boundary, never a paid-mode CLI flag. */
export interface LiveHostQualification {
  create: (authorize: () => string | undefined) => Promise<{
    port: number
    fetch: typeof fetch
    installSession: (session: Electron.Session) => void
    dispose: () => void
    summary: () => unknown
  }>
}

function check(condition: unknown, code: string): asserts condition {
  if (!condition)
    throw new Error(code)
}

/**
 * Runs one existing desktop entry with a dedicated campaign and profile.
 * Call stack: explicit CLI -> host -> existing application -> existing gate or baseline adapter.
 */
export async function startLiveHost(configPath: string, qualification?: LiveHostQualification) {
  const config = v.parse(hostSchema, await readCampaignJson(configPath))
  const campaign = await openLiveCampaign(config.campaignRoot)
  check((campaign.manifest.purpose === 'qualification') === !!qualification, 'LIVE_HOST_PURPOSE_MISMATCH')
  check(config.phase !== 'setup' || (config.arm === 'aimy' && config.caseId === 'setup'), 'LIVE_SETUP_IDENTITY_MISMATCH')
  await assertCampaignChild(campaign, config.profile)
  await assertCampaignChild(campaign, config.evidenceDirectory)
  const buildRoot = await realpath(config.buildRoot)
  check(await realpath(config.entry) === join(buildRoot, 'builds', config.arm, 'out/main/index.js'), 'LIVE_ENTRY_OUTSIDE_BUILD')
  check(sha256(await readFile(config.entry)) === config.entrySha256, 'LIVE_ENTRY_CHANGED')
  check(process.env.APP_USER_DATA_PATH === config.profile, 'LIVE_PROFILE_ENV_MISMATCH')
  check(process.env.AIMY_ACCEPTANCE_CONFIG === campaign.budgetConfigPath || config.arm === 'airi', 'LIVE_BUDGET_ENV_MISMATCH')
  check((process.env.AIMY_ACCEPTANCE_SETUP_ONLY === 'true') === (config.phase === 'setup'), 'LIVE_CONFIGURATION_MODE_MISMATCH')
  const marker = v.parse(v.object({ schemaVersion: v.literal(1), campaignId: v.string(), kind: v.picklist(['setup', 'case']) }), await readCampaignJson(join(config.profile, '.aimy-acceptance-profile.json')))
  check(marker.campaignId === campaign.manifest.campaignId && marker.kind === (config.phase === 'setup' ? 'setup' : 'case'), 'LIVE_PROFILE_MARKER_MISMATCH')
  app.setPath('userData', config.profile)
  app.setName('Aimy Acceptance')
  if (config.phase === 'setup') {
    app.on('web-contents-created', (_, contents) => {
      contents.on('devtools-opened', () => contents.closeDevTools())
    })
  }
  const { context } = createContext(ipcMain)
  const expectedDocument = pathToFileURL(join(config.entry, '../../renderer/index.html')).href
  let boundSender: WebContents | undefined
  let boundFrame: WebFrameMain | undefined
  let shuttingDown = false
  const authorizeRenderer = (id: number, frame?: WebFrameMain) => {
    const sender = webContents.fromId(id)
    if (!sender || sender.isDestroyed() || (frame && frame !== sender.mainFrame))
      return false
    const url = new URL(sender.getURL())
    if (`${url.protocol}//${url.host}${url.pathname}` !== expectedDocument || url.searchParams.get('synced-leader') === 'false' || (url.hash && url.hash !== '#/'))
      return false
    if (boundSender && boundSender !== sender)
      return false
    if (boundFrame && boundFrame !== sender.mainFrame)
      return false
    boundSender = sender
    boundFrame = sender.mainFrame
    return !shuttingDown
  }
  const authorize = (event: IpcMainEvent | undefined) => check(event && event.senderFrame === event.sender.mainFrame && authorizeRenderer(event.sender.id, event.senderFrame), 'LIVE_PERMISSION_DENIED')
  async function assertOperation() {
    const lock = v.parse(v.object({ operation: v.picklist(['setup', 'run']), token: v.string(), pid: v.number() }), await readCampaignJson(join(campaign.root, 'operation.lock')))
    check(lock.token === config.operationToken && lock.operation === config.phase && !shuttingDown, 'LIVE_OPERATION_CHANGED')
    try {
      process.kill(lock.pid, 0)
    }
    catch { throw new Error('LIVE_OPERATOR_STOPPED') }
  }
  await assertOperation()
  const lock = v.parse(v.looseObject({ pid: v.number(), operation: v.string(), token: v.string() }), await readCampaignJson(join(campaign.root, 'operation.lock')))
  check(lock.token === config.operationToken, 'LIVE_OPERATION_CHANGED')
  await writeCampaignJson(join(campaign.root, 'operation.lock'), { ...lock, hostPid: process.pid }, true)
  let fixedBinding: LiveCredentialBinding | undefined
  let expectedAuthorization: string | undefined
  let transport: ReturnType<typeof registerBaselineTransport> | undefined
  let policy: ReturnType<typeof installLiveNetworkPolicy> | undefined
  let qualified: Awaited<ReturnType<LiveHostQualification['create']>> | undefined
  let requests = 0
  const localPorts = [config.channelPort, ...(config.debugPort ? [config.debugPort] : [])]
  const nativeFetch = globalThis.fetch
  const preliminaryGuard = installOfflineNodeNetworkGuard(localPorts)
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    check(['http:', 'ws:'].includes(url.protocol) && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
      && localPorts.includes(Number(url.port)), 'LIVE_PREPARATION_NETWORK_DENIED')
    return nativeFetch(input, init)
  }
  if (qualification) {
    qualified = await qualification.create(() => expectedAuthorization)
    app.commandLine.appendSwitch('no-proxy-server')
    app.commandLine.appendSwitch('host-resolver-rules', `MAP api.deepseek.com 127.0.0.1:${qualified.port}, EXCLUDE localhost`)
  }
  const bindingLocation = { campaignId: campaign.manifest.campaignId, setupProfile: campaign.setupProfile, bindingPath: campaign.bindingPath }
  async function assertBindingCurrent() {
    await assertOperation()
    check(config.phase === 'run' && fixedBinding, 'LIVE_CONFIGURATION_ONLY')
    await assertLivePriceCurrent(campaign)
    const latest = await readLiveCredentialBinding(bindingLocation)
    check(JSON.stringify(latest) === JSON.stringify(fixedBinding), 'LIVE_CREDENTIAL_CHANGED')
  }
  const ready = app.whenReady().then(async () => {
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url)
      const remote = ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)
      callback({ cancel: remote && (!localPorts.includes(Number(url.port)) || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)) })
    })
    qualified?.installSession(session.defaultSession)
    const setupVault = new ProviderSecretVault({ filePath: join(campaign.setupProfile, 'provider-secrets.json') })
    const bindings = new LiveCredentialBindingStore({ ...bindingLocation, vault: setupVault })
    const ledger = new AcceptanceBudgetLedger({ filePath: campaign.ledgerPath, campaign: campaign.campaign })
    if (config.phase === 'run') {
      fixedBinding = await readLiveCredentialBinding(bindingLocation)
      await assertBindingCurrent()
      const values = await setupVault.read({ providerId: fixedBinding.providerId, reference: fixedBinding.secretReference })
      const secret = v.parse(v.strictObject({ apiKey: v.pipe(v.string(), v.minLength(1), v.maxLength(16_384), v.check(value => !/[\r\n]/.test(value))) }), JSON.parse(values.config))
      expectedAuthorization = `Bearer ${secret.apiKey}`
      if (config.arm === 'aimy') {
        const candidateVault = new ProviderSecretVault({ filePath: join(config.profile, 'provider-secrets.json') })
        const candidateValues = await candidateVault.read({ providerId: fixedBinding.providerId, reference: fixedBinding.secretReference })
        check(candidateValues.config === values.config, 'LIVE_CASE_CREDENTIAL_MISMATCH')
      }
      const status = await ledger.status()
      check(!status.paused, 'LIVE_BUDGET_PAUSED')
    }
    preliminaryGuard.restore()
    globalThis.fetch = qualified?.fetch ?? nativeFetch
    policy = installLiveNetworkPolicy({
      phase: config.phase,
      arm: config.arm,
      campaign: campaign.campaign,
      localPorts: [...localPorts, ...(qualified ? [qualified.port] : [])],
      session: session.defaultSession,
      authorizeRenderer,
      assertBindingCurrent,
      assertCurrent() {
        check(!shuttingDown && boundSender && boundFrame && authorizeRenderer(boundSender.id, boundFrame), 'LIVE_OWNER_CHANGED')
      },
      expectedAuthorization,
      claims: config.phase === 'run' && config.arm === 'aimy' ? new LiveRequestClaims({ ledgerPath: campaign.ledgerPath, campaignId: campaign.manifest.campaignId, caseId: config.caseId, runId: config.runId, arm: 'aimy', ownerPid: process.pid }) : undefined,
      onRequest(metadata) {
        requests++
        const parsed = JSON.parse(metadata.body)
        check(!expectedAuthorization || !metadata.body.includes(expectedAuthorization.slice(7)), 'LIVE_CREDENTIAL_IN_REQUEST_BODY')
        appendFileSync(join(config.evidenceDirectory, 'requests.jsonl'), `${JSON.stringify({ ...metadata, body: undefined, payload: parsed, receivedAt: new Date().toISOString(), index: requests })}\n`, { mode: 0o600 })
      },
    })
    if (config.phase === 'run' && config.arm === 'airi') {
      transport = registerBaselineTransport({ context, campaign: campaign.campaign, budget: ledger, providerDefinition: { id: 'deepseek' }, getRun: () => ({ arm: 'airi', caseId: config.caseId, runId: config.runId, epoch: 1 }), authorizeSender: sender => authorizeRenderer(sender.id, sender.mainFrame), prepareTransport: async () => {
        await assertBindingCurrent()
        return (url, init) => {
          const headers = new Headers(init.headers)
          headers.set('authorization', expectedAuthorization!)
          return policy!.send(url, { ...init, headers, redirect: 'error' })
        }
      } })
    }
    await writeCampaignJson(join(config.evidenceDirectory, 'host-ready.json'), { phase: config.phase, pid: process.pid, campaignId: campaign.manifest.campaignId, realRequestsStarted: false, remoteDebugEnabled: !!config.debugPort })
    app.once('before-quit', () => {
      shuttingDown = true
    })
    app.once('will-quit', () => {
      transport?.dispose()
      writeFileSync(join(config.evidenceDirectory, 'host-final.json'), JSON.stringify({ pid: process.pid, phase: config.phase, purpose: campaign.manifest.purpose, requests, network: policy?.summary(), qualification: qualified?.summary(), transport: transport?.summary() }), { mode: 0o600 })
      policy?.dispose()
      qualified?.dispose()
    })
    return { bindings, ledger, setupVault }
  })
  defineInvokeHandler(context, acceptanceInfo, async (_, metadata) => {
    try {
      authorize(metadata?.raw.ipcMainEvent)
      await ready
      authorize(metadata?.raw.ipcMainEvent)
      // The product channel installs its certificate verifier during startup. Re-pin only the local fixture after renderer readiness.
      qualified?.installSession(session.defaultSession)
      const common = { mode: campaign.manifest.purpose === 'official' ? 'official-model' as const : 'qualification' as const, arm: config.arm, caseId: config.caseId, runId: config.runId, epoch: 1, campaign: campaign.campaign, providerInstanceId: 'acceptance-deepseek', baseURL: 'https://api.deepseek.com/', modelId: 'deepseek-flash' as const }
      if (config.phase === 'setup')
        return { ok: true as const, value: { ...common, phase: 'setup' as const } }
      check(fixedBinding, 'LIVE_CREDENTIAL_NOT_CONFIGURED')
      return { ok: true as const, value: { ...common, phase: 'run' as const, reference: fixedBinding.secretReference } }
    }
    catch { return { ok: false as const, code: 'LIVE_HOST_UNAVAILABLE' } }
  })
  defineInvokeHandler(context, acceptanceSetupRecord, async (candidate, metadata) => {
    try {
      authorize(metadata?.raw.ipcMainEvent)
      check(config.phase === 'setup', 'LIVE_SETUP_CLOSED')
      const { bindings } = await ready
      await assertOperation()
      authorize(metadata?.raw.ipcMainEvent)
      return { ok: true as const, value: await bindings.record(candidate) }
    }
    catch { return { ok: false as const, code: 'LIVE_CONFIGURATION_NOT_SAVED' } }
  })
  defineInvokeHandler(context, acceptanceSetupInvalidate, async (input, metadata) => {
    try {
      authorize(metadata?.raw.ipcMainEvent)
      check(config.phase === 'setup', 'LIVE_SETUP_CLOSED')
      const { bindings } = await ready
      await assertOperation()
      return { ok: true as const, value: await bindings.invalidate(input.configurationRevision) }
    }
    catch { return { ok: false as const, code: 'LIVE_CONFIGURATION_NOT_SAVED' } }
  })
  defineInvokeHandler(context, acceptanceSetupStatus, async (_, metadata) => {
    try {
      authorize(metadata?.raw.ipcMainEvent)
      const { bindings } = await ready
      return { ok: true as const, value: await bindings.status() }
    }
    catch { return { ok: false as const, code: 'LIVE_CONFIGURATION_STATUS_UNAVAILABLE' } }
  })
  defineInvokeHandler(context, acceptanceSetupUi, async (input, metadata) => {
    try {
      authorize(metadata?.raw.ipcMainEvent)
      check(config.phase === 'setup', 'LIVE_SETUP_CLOSED')
      const status = v.parse(v.strictObject({ state: v.picklist(['page-opened', 'failed']), stage: v.picklist(['startup', 'host-info', 'memory-pause', 'onboarding', 'provider-defaults', 'provider-observer', 'open-settings', 'ready']) }), input)
      await writeCampaignJson(join(config.evidenceDirectory, 'setup-ui.json'), { ...status, pid: process.pid }, true)
      return { ok: true as const, value: { recorded: true as const } }
    }
    catch { return { ok: false as const, code: 'LIVE_SETUP_UI_STATUS_FAILED' } }
  })
  defineInvokeHandler(context, acceptanceFlush, async (_, metadata) => {
    try {
      authorize(metadata?.raw.ipcMainEvent)
      const { ledger, setupVault } = await ready
      await transport?.flush()
      await ledger.flush()
      await setupVault.flush()
      authorize(metadata?.raw.ipcMainEvent)
      return { ok: true as const, value: { budget: await ledger.status(), requests } }
    }
    catch { return { ok: false as const, code: 'LIVE_HOST_FLUSH_FAILED' } }
  })
  void ready.catch(() => {
    writeFileSync(join(config.evidenceDirectory, 'host-error.json'), JSON.stringify({ code: 'LIVE_HOST_INITIALIZATION_FAILED' }))
    app.exit(1)
  })
  // Awaiting this entry preserves Electron's scheme-registration order before the ready event.
  await import(pathToFileURL(config.entry).href)
}
