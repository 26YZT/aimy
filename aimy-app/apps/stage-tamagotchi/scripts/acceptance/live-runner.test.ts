import type { LiveBuildBinding } from './live-build'

import process from 'node:process'

import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { prepareLiveCampaign, writeCampaignJson } from './live-campaign'
import { launchLiveSetup } from './live-runner'

const roots: string[] = []
const pids: number[] = []

async function fixture(mode: 'graceful' | 'ignore' | 'missing-binary' | 'missing-manifest') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'aimy-setup-cleanup-')))
  roots.push(root)
  const repository = resolve(import.meta.dirname, '../../../../..')
  const campaign = await prepareLiveCampaign({ root: join(root, 'campaign'), repository, datasetPath: join(repository, 'docs/04-验证记录/2026-10-15-首批增量开发/acceptance/cases.json'), purpose: 'qualification', price: {
    observedAt: new Date(Date.now() - 1000).toISOString(),
    sourceUrl: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
    sourceSha256: 'a'.repeat(64),
    modelVersion: 'DeepSeek-V4.1-Flash',
    inputMicroYuanPerMillion: 2_000_000,
    cachedInputMicroYuanPerMillion: 40_000,
    outputMicroYuanPerMillion: 8_000_000,
  } })
  const workspaceRoot = join(root, 'workspace')
  const packageRoot = join(workspaceRoot, 'apps/stage-tamagotchi')
  const electronModule = join(packageRoot, 'node_modules/electron')
  await mkdir(electronModule, { recursive: true })
  await writeFile(join(packageRoot, 'package.json'), '{"name":"synthetic-setup-process"}')
  await writeFile(join(electronModule, 'index.js'), `module.exports = ${JSON.stringify(mode === 'missing-binary' ? join(root, 'absent-executable') : process.execPath)}`)
  const buildRoot = join(root, 'builds/aimy')
  await mkdir(buildRoot, { recursive: true })
  const manifestPath = join(buildRoot, 'build-manifest.json')
  if (mode !== 'missing-manifest')
    await writeCampaignJson(manifestPath, { paths: { workspaceRoot } })
  const entry = join(buildRoot, 'out/main/index.js')
  const host = join(root, 'fixture-host.mjs')
  await writeFile(host, `import process from 'node:process';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const config=JSON.parse(readFileSync(process.env.AIMY_LIVE_HOST_CONFIG,'utf8'));
writeFileSync(join(config.evidenceDirectory,'host-ready.json'),JSON.stringify({pid:process.pid,phase:'setup',remoteDebugEnabled:false}));
process.on('SIGINT',()=>{writeFileSync(join(config.evidenceDirectory,'signal-received.json'),JSON.stringify({pid:process.pid}));${mode === 'ignore' ? '' : 'setTimeout(()=>{process.stdout.write(\'graceful-output-drained\\n\');process.exit(0)},150)'}});
writeFileSync(join(config.evidenceDirectory,'setup-ui.json'),JSON.stringify({state:'failed',pid:process.pid}));
setInterval(()=>{},1000);`)
  const arm = { manifestPath, manifestSha256: 'a'.repeat(64), entry, entrySha256: 'a'.repeat(64) }
  const artifact = { path: host, sha256: 'a'.repeat(64) }
  const builds: LiveBuildBinding = { schemaVersion: 1, campaignId: campaign.manifest.campaignId, buildOwnerCampaignId: campaign.manifest.campaignId, createdAt: new Date().toISOString(), cacheRoot: root, buildRoot: join(root, 'builds'), arms: { airi: arm, aimy: arm }, liveHost: artifact, qualificationHost: artifact, bundles: artifact }
  return { campaign, builds }
}

afterEach(async () => {
  for (const pid of pids.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL')
    }
    catch { /* The assertion normally confirms the owned synthetic child has already exited. */ }
  }
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('setup process failure cleanup', () => {
  it.each(['graceful', 'ignore'] as const)('waits for %s child termination and closes evidence and lock before rejecting', async (mode) => {
    const { campaign, builds } = await fixture(mode)
    await expect(launchLiveSetup(campaign, builds)).rejects.toThrow('LIVE_SETUP_PAGE_FAILED')
    const runs = join(campaign.root, 'setup-runs')
    const output = join(runs, (await readdir(runs))[0])
    const ready = JSON.parse(await readFile(join(output, 'host-ready.json'), 'utf8'))
    pids.push(ready.pid)
    expect(() => process.kill(ready.pid, 0)).toThrow()
    await expect(stat(join(campaign.root, 'operation.lock'))).rejects.toMatchObject({ code: 'ENOENT' })
    const exit = JSON.parse(await readFile(join(output, 'exit.json'), 'utf8'))
    expect(exit.signal).toBe(mode === 'ignore' ? 'SIGKILL' : null)
    expect(exit.code).toBe(mode === 'ignore' ? null : 0)
    if (mode === 'graceful')
      expect(await readFile(join(output, 'app.log'), 'utf8')).toContain('graceful-output-drained')
  }, 25_000)

  it.each(['missing-binary', 'missing-manifest'] as const)('releases its lock after %s without leaving a running child', async (mode) => {
    const { campaign, builds } = await fixture(mode)
    await expect(launchLiveSetup(campaign, builds)).rejects.toThrow()
    await expect(stat(join(campaign.root, 'operation.lock'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
