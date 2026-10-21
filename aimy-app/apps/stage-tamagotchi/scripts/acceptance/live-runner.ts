import type { ChildProcess } from 'node:child_process'

import type { LiveBuildBinding } from './live-build'
import type { LiveCampaign } from './live-campaign'

import process from 'node:process'

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, unlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import * as v from 'valibot'

import { AcceptanceBudgetLedger } from '../../src/main/services/aimy/acceptance-budget'
import { findAvailablePort } from '../lib/remote-debug'
import { readLiveBuild } from './live-build'
import { assertLivePriceCurrent, lockLiveCampaign, openLiveCampaign, readCampaignJson, writeCampaignJson } from './live-campaign'
import { readLiveCredentialBinding } from './live-credential'
import { runBoundLiveComparison } from './offline-runner'

function requireCondition(condition: unknown, code: string): asserts condition {
  if (!condition)
    throw new Error(code)
}

function childEnvironment(campaign: LiveCampaign, profile: string, config: string, debugPort?: number) {
  const env: NodeJS.ProcessEnv = {}
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL']) {
    if (process.env[key])
      env[key] = process.env[key]
  }
  Object.assign(env, { APP_USER_DATA_PATH: profile, AIMY_LIVE_HOST_CONFIG: config, AIMY_ACCEPTANCE_CONFIG: campaign.budgetConfigPath, AIMY_ACCEPTANCE_SETUP_ONLY: 'true', APP_REMOTE_DEBUG_NO_OPEN: 'true' })
  if (debugPort)
    Object.assign(env, { APP_REMOTE_DEBUG: 'true', APP_REMOTE_DEBUG_PORT: String(debugPort) })
  return env
}

async function operationToken(campaign: LiveCampaign) {
  return v.parse(v.object({ token: v.string() }), await readCampaignJson(join(campaign.root, 'operation.lock'))).token
}

function hostPath(campaign: LiveCampaign, builds: LiveBuildBinding) {
  return campaign.manifest.purpose === 'official' ? builds.liveHost.path : builds.qualificationHost.path
}

export interface LiveSetupSession {
  pid: number
  output: string
  debugPort?: number
  closed: Promise<{ code: number | null, signal: string | null }>
  stop: () => void
}

async function setupDeadline<T>(operation: Promise<T>, milliseconds: number, code: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([operation, new Promise<never>((_accept, reject) => {
      timer = setTimeout(() => reject(new Error(code)), milliseconds)
    })])
  }
  finally { clearTimeout(timer) }
}

async function waitForSetup<T>(probe: () => Promise<T | undefined>, signal: AbortSignal): Promise<T> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (signal.aborted)
      throw new Error('LIVE_SETUP_CANCELLED')
    const value = await probe()
    if (value !== undefined)
      return value
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('LIVE_SETUP_READY_TIMEOUT')
}

/**
 * Opens the existing configuration page without enabling model requests.
 * Call stack: CLI configure -> one setup lock -> existing desktop -> opaque saved binding.
 */
export async function launchLiveSetup(campaign: LiveCampaign, builds: LiveBuildBinding, options: { qualificationDebug?: boolean } = {}): Promise<LiveSetupSession> {
  requireCondition(!options.qualificationDebug || campaign.manifest.purpose === 'qualification', 'LIVE_SETUP_DEBUG_FORBIDDEN')
  const release = await lockLiveCampaign(campaign, 'setup')
  let child: ChildProcess | undefined
  const polling = new AbortController()
  let releasePromise: Promise<void> | undefined
  const releaseOnce = () => releasePromise ??= release()
  let terminate: (() => Promise<void>) | undefined
  try {
    const runId = `setup-${randomUUID()}`
    const output = join(campaign.root, 'setup-runs', runId)
    await mkdir(output, { recursive: true, mode: 0o700 })
    const channelPort = await findAvailablePort()
    const debugPort = options.qualificationDebug ? await findAvailablePort() : undefined
    const entry = builds.arms.aimy.entry
    const manifest = v.parse(v.object({ paths: v.object({ workspaceRoot: v.string() }) }), JSON.parse(await readFile(builds.arms.aimy.manifestPath, 'utf8')))
    const require = createRequire(join(manifest.paths.workspaceRoot, 'apps/stage-tamagotchi/package.json'))
    const electron: unknown = require('electron')
    requireCondition(typeof electron === 'string', 'LIVE_ELECTRON_UNAVAILABLE')
    await writeCampaignJson(join(campaign.setupProfile, 'server-channel-config.json'), { hostname: '127.0.0.1', port: channelPort, tlsConfig: null }, true)
    const config = join(output, 'host-config.json')
    await writeCampaignJson(config, { phase: 'setup', arm: 'aimy', caseId: 'setup', runId, campaignRoot: campaign.root, buildRoot: builds.cacheRoot, profile: campaign.setupProfile, evidenceDirectory: output, entry, entrySha256: builds.arms.aimy.entrySha256, channelPort, ...(debugPort ? { debugPort } : {}), operationToken: await operationToken(campaign) })
    child = spawn(electron, [hostPath(campaign, builds)], { cwd: dirname(dirname(dirname(entry))), env: childEnvironment(campaign, campaign.setupProfile, config, debugPort), stdio: ['ignore', 'pipe', 'pipe'] })
    const ownedChild = child
    const exited = new Promise<{ code: number | null, signal: string | null }>((accept, reject) => {
      ownedChild.once('error', () => {
        // A failed spawn has no process to wait for. Errors from a running child do not confirm its exit.
        if (!ownedChild.pid)
          reject(new Error('LIVE_SETUP_SPAWN_FAILED'))
      })
      ownedChild.once('exit', (code, signal) => accept({ code, signal }))
    })
    void exited.catch(() => {})
    const log = createWriteStream(join(output, 'app.log'), { flags: 'wx', mode: 0o600 })
    let logFailed = false
    let rejectLog: (() => void) | undefined
    const logFailure = new Promise<never>((_accept, reject) => {
      rejectLog = () => reject(new Error('LIVE_SETUP_LOG_FAILED'))
    })
    void logFailure.catch(() => {})
    log.on('error', () => {
      logFailed = true
      rejectLog?.()
    })
    ownedChild.stdout?.pipe(log, { end: false })
    ownedChild.stderr?.pipe(log, { end: false })
    const stop = () => {
      void terminate?.().catch(() => {})
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    const closed = (async () => {
      let result: { code: number | null, signal: string | null } | undefined
      try {
        result = await exited
      }
      finally {
        ownedChild.stdout?.unpipe(log)
        ownedChild.stderr?.unpipe(log)
        try {
          if (!log.destroyed) {
            await setupDeadline(new Promise<void>((accept, reject) => {
              log.once('error', () => reject(new Error('LIVE_SETUP_LOG_FAILED')))
              log.end(accept)
            }), 5000, 'LIVE_SETUP_LOG_CLOSE_TIMEOUT')
          }
          requireCondition(!logFailed, 'LIVE_SETUP_LOG_FAILED')
          if (result)
            await writeCampaignJson(join(output, 'exit.json'), { ...result, pid: ownedChild.pid })
        }
        finally {
          log.destroy()
          polling.abort()
          process.removeListener('SIGINT', stop)
          process.removeListener('SIGTERM', stop)
          await releaseOnce()
        }
      }
      requireCondition(result, 'LIVE_SETUP_EXIT_UNCONFIRMED')
      return result
    })()
    void closed.catch(() => {})
    let termination: Promise<void> | undefined
    terminate = () => termination ??= (async () => {
      if (ownedChild.pid && ownedChild.exitCode === null && ownedChild.signalCode === null) {
        ownedChild.kill('SIGINT')
        try {
          await setupDeadline(exited, 15_000, 'LIVE_SETUP_QUIT_TIMEOUT')
        }
        catch {
          if (ownedChild.exitCode === null && ownedChild.signalCode === null)
            ownedChild.kill('SIGKILL')
          await setupDeadline(exited, 5000, 'LIVE_SETUP_EXIT_UNCONFIRMED')
        }
      }
      // This includes stream draining and the once-only lock release, not just process exit.
      await setupDeadline(closed, 10_000, 'LIVE_SETUP_CLEANUP_TIMEOUT')
    })()
    requireCondition(ownedChild.pid, 'LIVE_SETUP_SPAWN_FAILED')
    await Promise.race([
      waitForSetup(async () => {
        try {
          const ready = v.parse(v.object({ pid: v.number(), phase: v.literal('setup'), remoteDebugEnabled: v.boolean() }), await readCampaignJson(join(output, 'host-ready.json')))
          requireCondition(ready.pid === ownedChild.pid && ready.remoteDebugEnabled === !!debugPort, 'LIVE_SETUP_HOST_MISMATCH')
          return ready
        }
        catch { return undefined }
      }, polling.signal),
      closed.then(() => { throw new Error('LIVE_SETUP_EARLY_EXIT') }),
      logFailure,
    ])
    const ui = await Promise.race([
      waitForSetup(async () => {
        try {
          return v.parse(v.object({ state: v.picklist(['page-opened', 'failed']), pid: v.number() }), await readCampaignJson(join(output, 'setup-ui.json')))
        }
        catch { return undefined }
      }, polling.signal),
      closed.then(() => { throw new Error('LIVE_SETUP_EARLY_EXIT') }),
      logFailure,
    ])
    requireCondition(ui.state === 'page-opened' && ui.pid === ownedChild.pid, 'LIVE_SETUP_PAGE_FAILED')
    await writeCampaignJson(join(campaign.root, 'configuration-session.json'), { pid: ownedChild.pid, output, startedAt: new Date().toISOString(), remoteDebugEnabled: !!debugPort }, true)
    return { pid: ownedChild.pid, output, debugPort, closed, stop }
  }
  catch (error) {
    polling.abort()
    if (terminate) {
      try {
        await terminate()
      }
      catch {
        throw new Error('LIVE_SETUP_CLEANUP_FAILED')
      }
    }
    else {
      await releaseOnce()
    }
    throw error
  }
}

/** Returns public readiness. It never resolves a provider or decrypts a key. */
export async function liveAcceptanceStatus(root: string) {
  const campaign = await openLiveCampaign(root)
  let configured = false
  let credentialCode: string | undefined
  try {
    await readLiveCredentialBinding({ campaignId: campaign.manifest.campaignId, setupProfile: campaign.setupProfile, bindingPath: campaign.bindingPath })
    configured = true
  }
  catch (error) { credentialCode = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'LIVE_CREDENTIAL_NOT_CONFIGURED' }
  let priceCurrent = true
  try {
    await assertLivePriceCurrent(campaign)
  }
  catch { priceCurrent = false }
  const budget = await new AcceptanceBudgetLedger({ filePath: campaign.ledgerPath, campaign: campaign.campaign }).status()
  return { campaignId: campaign.manifest.campaignId, purpose: campaign.manifest.purpose, configured, credentialCode, priceCurrent, budget, billing: 'conservative-peak-price-bound', automaticExecution: false }
}

/**
 * A saved key is not execution authorization. The caller must select this command explicitly.
 * Call stack: CLI run --execute -> immutable campaign/build checks -> one lock -> 8-case runner.
 */
export async function runLiveAcceptance(options: { campaignRoot: string, execute: true, qualification?: boolean, onlyCase?: string }) {
  requireCondition(options.execute === true, 'LIVE_EXPLICIT_EXECUTION_REQUIRED')
  const campaign = await openLiveCampaign(options.campaignRoot)
  requireCondition((campaign.manifest.purpose === 'qualification') === !!options.qualification, 'LIVE_EXECUTION_PURPOSE_MISMATCH')
  const release = await lockLiveCampaign(campaign, 'run')
  try {
    await assertLivePriceCurrent(campaign)
    await readLiveCredentialBinding({ campaignId: campaign.manifest.campaignId, setupProfile: campaign.setupProfile, bindingPath: campaign.bindingPath })
    const budget = await new AcceptanceBudgetLedger({ filePath: campaign.ledgerPath, campaign: campaign.campaign }).status()
    requireCondition(!budget.paused && budget.remainingMicroYuan > 0, 'LIVE_BUDGET_PAUSED')
    const builds = await readLiveBuild(campaign)
    await mkdir(join(campaign.root, 'runs'), { recursive: true, mode: 0o700 })
    return await runBoundLiveComparison({ campaign, builds, output: join(campaign.root, 'runs', randomUUID()), onlyCase: options.onlyCase, operationToken: await operationToken(campaign) })
  }
  finally { await release() }
}

/** Recovery releases only a dead operation lock. Costs and unknown usage remain in the original ledger. */
export async function recoverLiveOperation(root: string) {
  const campaign = await openLiveCampaign(root)
  const path = join(campaign.root, 'operation.lock')
  const lock = v.parse(v.object({ pid: v.number(), hostPid: v.optional(v.number()), token: v.string() }), await readCampaignJson(path))
  for (const pid of [lock.pid, ...(lock.hostPid ? [lock.hostPid] : [])]) {
    let alive = true
    try {
      process.kill(pid, 0)
    }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ESRCH')
        alive = false
    }
    requireCondition(!alive, 'LIVE_OPERATION_STILL_ACTIVE')
  }
  const ledger = new AcceptanceBudgetLedger({ filePath: campaign.ledgerPath, campaign: campaign.campaign })
  const budget = await ledger.status()
  const current = v.parse(v.object({ token: v.string() }), await readCampaignJson(path))
  requireCondition(current.token === lock.token, 'LIVE_LOCK_CHANGED')
  await writeCampaignJson(join(campaign.root, `recovery-${randomUUID()}.json`), { lock, budget, recoveredAt: new Date().toISOString(), budgetReset: false })
  await unlink(path)
  return { recovered: true, budget }
}
