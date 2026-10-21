import type { ChildProcess } from 'node:child_process'

import type { LiveBuildBinding } from './live-build'
import type { LiveCampaign } from './live-campaign'

import process from 'node:process'

import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

import { CdpClient, findAvailablePort, findDebugTarget, waitFor, waitForRemoteDebug } from '../lib/remote-debug'
import { loadAcceptanceDataset, projectDataset, sha256 } from './dataset'
import { copyBoundCredential } from './live-credential'

interface Snapshot {
  sessionId: string
  characterId: string
  diskMessages: Array<{ id: string, role: string, content: unknown, createdAt?: number }>
  memory: { implemented: boolean, facts?: { facts: unknown[] } }
}
interface ExitEvidence { code: number | null, signal: string | null, forced: boolean }

async function writeJson(path: string, value: unknown) {
  await writeFile(path, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 })
}

function check(condition: unknown, code: string): asserts condition {
  if (!condition)
    throw new Error(code)
}

async function bounded<T>(operation: Promise<T>, milliseconds: number, code: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([operation, new Promise<never>((_accept, reject) => {
      timeout = setTimeout(() => reject(new Error(code)), milliseconds)
    })])
  }
  finally { clearTimeout(timeout) }
}

/**
 * Executes only synthetic, host-created credentials against a local fixture.
 * It deliberately has no paid-mode flag or ability to discover an existing user profile.
 */
export async function runOfflineComparison(options: { taskRoot: string, output: string, repository: string, onlyCase?: string }) {
  return runComparison(options)
}

/** Explicit live command -> already locked campaign -> the same process/session scenario runner as offline qualification. */
export async function runBoundLiveComparison(options: { campaign: LiveCampaign, builds: LiveBuildBinding, output: string, onlyCase?: string, operationToken: string }) {
  return runComparison({ taskRoot: options.campaign.root, output: options.output, repository: '', onlyCase: options.onlyCase }, options)
}

async function runComparison(options: { taskRoot: string, output: string, repository: string, onlyCase?: string }, live?: { campaign: LiveCampaign, builds: LiveBuildBinding, operationToken: string }) {
  const taskRoot = await realpath(options.taskRoot)
  const output = join(await realpath(dirname(resolve(options.output))), basename(options.output))
  const inside = relative(taskRoot, output)
  check(inside && !isAbsolute(inside) && inside !== '..' && !inside.startsWith(`..${sep}`), 'OFFLINE_OUTPUT_NOT_OWNED')
  await mkdir(output, { mode: 0o700 })
  const dataset = live
    ? { ...projectDataset(JSON.parse(await readFile(live.campaign.datasetPath, 'utf8')), await readFile(join(live.campaign.root, 'user-v2-source.md'))), datasetSha256: live.campaign.manifest.datasetSha256 }
    : await loadAcceptanceDataset(join(options.repository, 'docs/04-验证记录/2026-10-15-首批增量开发/acceptance/cases.json'), options.repository)
  if (options.onlyCase)
    check(dataset.cases.some(item => item.caseId === options.onlyCase), 'OFFLINE_UNKNOWN_CASE')
  const runId = randomUUID()
  if (!live) {
    const marker = join(taskRoot, '.aimy-offline-run.json')
    try {
      await writeJson(marker, { purpose: 'controlled-offline-comparison', realCredentials: false })
    }
    catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST')
        throw error
      check((JSON.parse(await readFile(marker, 'utf8'))).realCredentials === false, 'OFFLINE_TASK_MARKER_CHANGED')
    }
  }
  const campaign = {
    campaignId: `aimy-offline-${runId}`,
    maxCostMicroYuan: 10_000_000,
    price: { id: 'offline-fixture-zero', currency: 'CNY', providerId: 'deepseek', modelId: 'deepseek-flash', mode: 'synthetic', inputMicroYuanPerMillion: 0, cachedInputMicroYuanPerMillion: 0, outputMicroYuanPerMillion: 0, verifiedAt: 'synthetic-fixture', sourceUrl: 'https://example.invalid/aimy-offline-fixture' },
  }
  const campaignConfig = live?.campaign.budgetConfigPath ?? join(output, 'campaign.json')
  const ledgerPath = live?.campaign.ledgerPath ?? join(output, 'shared-ledger.json')
  if (!live)
    await writeJson(campaignConfig, { ledgerPath, campaign })
  const official = live?.campaign.manifest.purpose === 'official'
  const report: { mode: string, status: string, runId: string, datasetSha256: string, realModelCalls: number | null, fixtureRequests: number, semanticScores: null, cases: unknown[], failure?: string } = {
    mode: live ? official ? 'official-model' : 'qualification' : 'offline-fixture',
    status: 'running',
    runId,
    datasetSha256: dataset.datasetSha256,
    realModelCalls: 0,
    fixtureRequests: 0,
    semanticScores: null,
    cases: [],
  }
  let activeChild: ChildProcess | undefined
  let activeClient: CdpClient | undefined
  let activeExit: Promise<{ code: number | null, signal: string | null }> | undefined
  let activeLog: ReturnType<typeof createWriteStream> | undefined
  let activeProcess: Record<string, unknown> | undefined
  let cancelRequested = false
  const verifiedBuilds = new Set<string>()
  const interrupted = () => {
    cancelRequested = true
    activeChild?.kill('SIGINT')
  }
  process.once('SIGINT', interrupted)
  process.once('SIGTERM', interrupted)
  try {
    for (const item of dataset.cases.filter(item => !options.onlyCase || item.caseId === options.onlyCase)) {
      const bases: Record<string, string> = {}
      for (const arm of ['airi', 'aimy'] as const) {
        check(!cancelRequested, 'OFFLINE_CANCELLED')
        console.info(JSON.stringify({ event: 'case-start', caseId: item.caseId, arm }))
        const buildRoot = join(live?.builds.cacheRoot ?? taskRoot, 'builds', arm)
        const manifest = JSON.parse(await readFile(join(buildRoot, 'build-manifest.json'), 'utf8'))
        check(manifest.status === 'built' && manifest.arm === arm, 'OFFLINE_BUILD_NOT_READY')
        const entry = manifest.entry as string
        check(entry === join(buildRoot, 'out/main/index.js'), 'OFFLINE_ENTRY_OUTSIDE_BUILD')
        if (!verifiedBuilds.has(arm)) {
          for (const artifact of manifest.artifacts.entries as Array<{ path: string, type: string, sha256?: string }>) {
            const artifactPath = join(buildRoot, artifact.path)
            const within = relative(buildRoot, artifactPath)
            check(within && within !== '..' && !within.startsWith(`..${sep}`) && !isAbsolute(within), 'OFFLINE_ARTIFACT_OUTSIDE_BUILD')
            if (artifact.type === 'file') {
              check((await lstat(artifactPath)).isFile() && artifact.sha256 === sha256(await readFile(artifactPath)), 'OFFLINE_ARTIFACT_CHANGED')
            }
          }
          verifiedBuilds.add(arm)
        }
        const mainArtifact = manifest.artifacts.entries.find((value: { path: string }) => value.path === 'out/main/index.js')
        check(mainArtifact?.sha256 === sha256(await readFile(entry)), 'OFFLINE_BUILD_CHANGED')
        const require = createRequire(join(manifest.paths.workspaceRoot, 'apps/stage-tamagotchi/package.json'))
        const electron: unknown = require('electron')
        check(typeof electron === 'string' && isAbsolute(electron) && (await lstat(electron)).isFile(), 'OFFLINE_ELECTRON_UNAVAILABLE')
        const caseRoot = join(output, `${item.caseId}-${arm}`)
        const profile = join(caseRoot, 'profile')
        await mkdir(profile, { recursive: true, mode: 0o700 })
        if (live) {
          await writeJson(join(profile, '.aimy-acceptance-profile.json'), { schemaVersion: 1, campaignId: live.campaign.manifest.campaignId, kind: 'case', caseId: item.caseId, arm })
          await copyBoundCredential({ campaignId: live.campaign.manifest.campaignId, setupProfile: live.campaign.setupProfile, bindingPath: live.campaign.bindingPath, targetProfile: profile })
        }
        else {
          await writeJson(join(profile, '.aimy-offline-profile.json'), { caseId: item.caseId, arm, realCredentials: false })
        }
        const caseEvidence: { caseId: string, arm: string, buildManifestSha256: string, processes: Array<Record<string, unknown>>, steps: unknown[] } = {
          caseId: item.caseId,
          arm,
          buildManifestSha256: sha256(await readFile(join(buildRoot, 'build-manifest.json'))),
          processes: [],
          steps: [],
        }
        let currentSession: string | undefined
        let previousSnapshot: Snapshot | undefined
        let processNumber = 0
        let exitPromise: Promise<{ code: number | null, signal: string | null }> | undefined
        let processEvidence: Record<string, unknown> | undefined
        let processRoot = ''
        let log: ReturnType<typeof createWriteStream> | undefined
        // A restart restores the existing provider configuration without repairing its endpoint.
        const [channelPort, modelPort] = await Promise.all([findAvailablePort(), findAvailablePort()])
        check(channelPort !== modelPort, 'OFFLINE_PORT_COLLISION')
        async function stop() {
          check(activeChild && exitPromise, 'OFFLINE_PROCESS_NOT_STARTED')
          await bounded(activeClient!.evaluate('globalThis.__aimyAcceptanceDriver.flush()'), 30_000, 'OFFLINE_FLUSH_TIMEOUT')
          activeClient?.close()
          activeClient = undefined
          activeChild.kill('SIGINT')
          let exit: ExitEvidence
          try {
            exit = { ...await bounded(exitPromise, 15_000, 'OFFLINE_QUIT_TIMEOUT'), forced: false }
          }
          catch {
            activeChild.kill('SIGKILL')
            exit = { ...await bounded(exitPromise, 5000, 'OFFLINE_KILL_TIMEOUT'), forced: true }
          }
          if (processEvidence)
            processEvidence.exit = exit
          activeChild = undefined
          await new Promise<void>(accept => log?.end(accept))
          activeExit = undefined
          activeLog = undefined
          activeProcess = undefined
          check(!exit.forced && exit.code === 0, 'OFFLINE_GRACEFUL_EXIT_FAILED')
          const host = JSON.parse(await readFile(join(processRoot, 'host-final.json'), 'utf8'))
          const ledger = JSON.parse(await readFile(ledgerPath, 'utf8')) as { records: Record<string, { state: string, attempt: { runId: string, arm: string, caseId: string } }> }
          const records = Object.values(ledger.records).filter(record => record.attempt.runId === processEvidence?.runId)
          check(records.length === host.requests && records.every(record => record.state === 'settled' && record.attempt.arm === arm && record.attempt.caseId === item.caseId), 'OFFLINE_REQUEST_LEDGER_MISMATCH')
          check((live ? host.network.authorizationRejected : host.authorizationRejected) === 0, 'OFFLINE_AUTHORIZATION_REJECTED')
          if (official)
            report.realModelCalls = (report.realModelCalls ?? 0) + host.requests
          else
            report.fixtureRequests += host.requests
          for (const name of ['app.log', 'requests.jsonl']) {
            const content = await readFile(join(processRoot, name), 'utf8')
            check(!/fixture-only-[a-f\d-]{36}/.test(content), 'OFFLINE_PLAINTEXT_CREDENTIAL_EXPOSURE')
            if (name === 'app.log')
              check(!content.includes('Error during app initialization'), 'OFFLINE_APP_INITIALIZATION_FAILED')
          }
          if (processEvidence)
            processEvidence.accounting = { acceptedRequests: host.requests, settledAttempts: records.length, authorizationRejected: 0, plaintextSyntheticCredentialInEvidence: false }
        }
        async function start(clock: { now: number, timeZone: string }, restoreSessionId?: string) {
          check(!cancelRequested, 'OFFLINE_CANCELLED')
          processNumber++
          processRoot = join(caseRoot, `process-${processNumber}`)
          await mkdir(processRoot, { mode: 0o700 })
          const cdpPort = await findAvailablePort()
          check(new Set([cdpPort, channelPort, modelPort]).size === 3, 'OFFLINE_PORT_COLLISION')
          await writeFile(join(profile, 'server-channel-config.json'), JSON.stringify({ hostname: '127.0.0.1', port: channelPort, tlsConfig: null }), { mode: 0o600 })
          const hostConfig = join(processRoot, 'host-config.json')
          await writeJson(hostConfig, live
            ? { phase: 'run', arm, caseId: item.caseId, runId: `${runId}-${arm}-${item.caseId}-p${processNumber}`, campaignRoot: live.campaign.root, buildRoot: live.builds.cacheRoot, profile, entry, entrySha256: mainArtifact.sha256, evidenceDirectory: processRoot, channelPort, debugPort: cdpPort, operationToken: live.operationToken }
            : { mode: 'offline-fixture', arm, caseId: item.caseId, runId: `${runId}-${arm}-${item.caseId}-p${processNumber}`, taskRoot, profile, entry, evidenceDirectory: processRoot, campaignConfig, modelPort, channelPort })
          const env: NodeJS.ProcessEnv = {}
          for (const name of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL']) {
            if (process.env[name])
              env[name] = process.env[name]
          }
          Object.assign(env, { APP_USER_DATA_PATH: profile, APP_REMOTE_DEBUG: 'true', APP_REMOTE_DEBUG_PORT: String(cdpPort), APP_REMOTE_DEBUG_NO_OPEN: 'true', ...(live ? { AIMY_LIVE_HOST_CONFIG: hostConfig } : { AIMY_OFFLINE_HOST_CONFIG: hostConfig }), ...(arm === 'aimy' ? { AIMY_ACCEPTANCE_CONFIG: campaignConfig } : {}) })
          // Preserve Electron's Chromium sandbox. The test host separately guards Node sockets/fetch and Chromium webRequest.
          const hostEntry = live ? (official ? live.builds.liveHost.path : live.builds.qualificationHost.path) : join(taskRoot, 'host/offline-host.mjs')
          activeChild = spawn(electron as string, [hostEntry], { cwd: buildRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
          const child = activeChild
          check(child.pid && !caseEvidence.processes.some(previous => previous.pid === child.pid), 'OFFLINE_NEW_PID_REQUIRED')
          exitPromise = new Promise((accept, reject) => {
            child.once('error', () => reject(new Error('OFFLINE_SPAWN_FAILED')))
            child.once('exit', (code, signal) => accept({ code, signal }))
          })
          activeExit = exitPromise
          log = createWriteStream(join(processRoot, 'app.log'), { flags: 'wx', mode: 0o600 })
          activeLog = log
          child.stdout?.pipe(log, { end: false })
          child.stderr?.pipe(log, { end: false })
          processEvidence = { pid: child.pid, processNumber, runId: `${runId}-${arm}-${item.caseId}-p${processNumber}`, cdpPort, channelPort, modelPort, profile, entrySha256: mainArtifact.sha256 }
          activeProcess = processEvidence
          caseEvidence.processes.push(processEvidence)
          await bounded(Promise.race([waitForRemoteDebug(cdpPort), exitPromise.then(() => {
            throw new Error('OFFLINE_EARLY_EXIT')
          })]), 60_000, 'OFFLINE_DEBUG_TIMEOUT')
          const owners = await promisify(execFile)('/usr/sbin/lsof', ['-nP', `-tiTCP:${cdpPort}`, '-sTCP:LISTEN'])
          check(owners.stdout.trim().split('\n').map(Number).every(pid => pid === child.pid), 'OFFLINE_DEBUG_PID_MISMATCH')
          processEvidence.debugPortOwnerVerified = true
          const target = await bounded(Promise.race([findDebugTarget(cdpPort, 'offline main renderer', value => value.type === 'page' && value.url.includes('/out/renderer/index.html')
            && !value.url.includes('synced-leader=false') && (!new URL(value.url).hash || new URL(value.url).hash === '#/')), exitPromise.then(() => {
            throw new Error('OFFLINE_EARLY_EXIT')
          })]), 60_000, 'OFFLINE_MAIN_TARGET_TIMEOUT')
          check(target.webSocketDebuggerUrl, 'OFFLINE_MAIN_TARGET_MISSING')
          processEvidence.targetId = target.id
          activeClient = await CdpClient.connect(target.webSocketDebuggerUrl)
          await activeClient.send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Shanghai' })
          await waitFor('offline driver leader', async () => await activeClient!.evaluate('globalThis.__aimyAcceptanceDriver?.ready()') ? true : undefined, 60_000, 100)
          const snapshot = await bounded(activeClient.evaluate<Snapshot>(`globalThis.__aimyAcceptanceDriver.configure(${JSON.stringify({ clock, restoreSessionId })})`), 60_000, 'OFFLINE_CONFIGURE_TIMEOUT')
          currentSession = snapshot.sessionId
          if (restoreSessionId) {
            check(previousSnapshot && sha256(JSON.stringify(snapshot.diskMessages)) === sha256(JSON.stringify(previousSnapshot.diskMessages)), 'OFFLINE_RESTART_MESSAGES_CHANGED')
            check(sha256(JSON.stringify(snapshot.memory.facts?.facts ?? [])) === sha256(JSON.stringify(previousSnapshot.memory.facts?.facts ?? [])), 'OFFLINE_RESTART_MEMORY_CHANGED')
            processEvidence.restoredWithoutImport = true
          }
          else {
            check(snapshot.diskMessages.every(message => message.role === 'system'), 'OFFLINE_PROFILE_NOT_EMPTY')
            bases[arm] = sha256(JSON.stringify(snapshot.diskMessages.map(message => message.content)))
          }
          return snapshot
        }
        try {
          await start(item.steps[0].input.clock)
          for (const step of item.steps) {
            check(!cancelRequested, 'OFFLINE_CANCELLED')
            if (step.transition.includes('new_process')) {
              await stop()
              await start(step.input.clock, currentSession)
            }
            else if (step.transition.includes('new_empty_session')) {
              const before = await activeClient!.evaluate<Snapshot>(`globalThis.__aimyAcceptanceDriver.newSession(${JSON.stringify({ clock: step.input.clock })})`)
              check(before.sessionId !== currentSession && before.diskMessages.every(message => message.role === 'system'), 'OFFLINE_NEW_SESSION_INVALID')
              currentSession = before.sessionId
            }
            const before = performance.now()
            const result = await bounded(activeClient!.evaluate<Snapshot>(`globalThis.__aimyAcceptanceDriver.send(${JSON.stringify(step.input)})`), 90_000, 'OFFLINE_SEND_TIMEOUT')
            const latest = result.diskMessages.filter(message => message.role === 'user').at(-1)
            check(latest?.content === step.input.text || (Array.isArray(latest?.content) && latest.content.some(part => part.type === 'text' && part.text === step.input.text)), 'OFFLINE_STORED_UTTERANCE_CHANGED')
            check(latest?.createdAt === step.input.clock.now, 'OFFLINE_MESSAGE_CLOCK_MISMATCH')
            check(result.diskMessages.at(-1)?.role === 'assistant', 'OFFLINE_ASSISTANT_NOT_PERSISTED')
            await writeJson(join(caseRoot, `${step.stepId}.json`), result)
            caseEvidence.steps.push({ stepId: step.stepId, transition: step.transition, sourceSha256: step.sourceSha256, elapsedMs: Math.round(performance.now() - before), sessionId: result.sessionId, processNumber })
            previousSnapshot = result
            console.info(JSON.stringify({ event: 'step-complete', arm, stepId: step.stepId }))
          }
          await stop()
          await writeJson(join(caseRoot, 'case-result.json'), caseEvidence)
          report.cases.push(caseEvidence)
        }
        catch (error) {
          await writeJson(join(caseRoot, 'case-failure.json'), { ...caseEvidence, code: error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'COMPARISON_CASE_FAILED' })
          throw error
        }
      }
      check(bases.airi === bases.aimy, 'OFFLINE_BASE_ROLE_MISMATCH')
    }
    report.status = options.onlyCase ? 'pilot-passed' : live ? 'execution-complete-unscored' : 'offline-flow-passed'
  }
  catch (error) {
    report.status = 'failed'
    if (official)
      report.realModelCalls = null
    // CDP could contain app error text. Keep the public report bounded; synthetic diagnostics stay in the owned process folder.
    report.failure = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'OFFLINE_RUNTIME_FAILED'
    throw error
  }
  finally {
    activeClient?.close()
    if (activeChild && activeExit) {
      let forced = false
      let exit
      try {
        activeChild.kill('SIGINT')
        exit = await bounded(activeExit, 15_000, 'OFFLINE_CLEANUP_TIMEOUT')
      }
      catch {
        forced = true
        activeChild.kill('SIGKILL')
        exit = await bounded(activeExit, 5000, 'OFFLINE_KILL_TIMEOUT').catch(() => ({ code: null, signal: 'cleanup-unconfirmed' }))
      }
      if (activeProcess) {
        activeProcess.exit = { ...exit, forced }
        await writeJson(join(output, 'failure-process-cleanup.json'), activeProcess)
      }
    }
    if (activeLog)
      await new Promise<void>(accept => activeLog!.end(accept))
    process.removeListener('SIGINT', interrupted)
    process.removeListener('SIGTERM', interrupted)
    await writeJson(join(output, 'run-result.json'), report)
  }
  return report
}
