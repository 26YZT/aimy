import type { LiveBuildBinding } from './live-build'

import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { sha256 } from './dataset'
import { bindVerifiedLiveBuild, prepareLiveBuild, readLiveBuild, reviseLiveHostBuild } from './live-build'
import { prepareLiveCampaign, writeCampaignJson } from './live-campaign'

const directories: string[] = []
const productRoot = resolve(import.meta.dirname, '../../../..')
const repository = dirname(productRoot)

async function fixture(purpose: 'qualification' | 'official' = 'qualification') {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'aimy-live-build-test-')))
  directories.push(directory)
  const campaign = await prepareLiveCampaign({
    root: join(directory, 'campaign'),
    repository,
    datasetPath: join(repository, 'docs/04-验证记录/2026-10-15-首批增量开发/acceptance/cases.json'),
    purpose,
    price: { observedAt: new Date(Date.now() - 1000).toISOString(), sourceUrl: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/', sourceSha256: 'a'.repeat(64), modelVersion: 'DeepSeek-V4.1-Flash', inputMicroYuanPerMillion: 2_000_000, cachedInputMicroYuanPerMillion: 40_000, outputMicroYuanPerMillion: 8_000_000 },
  })
  const cacheRoot = join(directory, 'cache')
  await mkdir(cacheRoot)
  await writeCampaignJson(join(cacheRoot, '.aimy-live-build.json'), { schemaVersion: 1, campaignId: campaign.manifest.campaignId, purpose: 'controlled-live-build' })
  async function file(path: string, content: string) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, { mode: 0o600 })
    return { path, sha256: sha256(content) }
  }
  const airiDriver = await file(join(cacheRoot, 'driver/airi.bootstrap.ts'), 'synthetic airi driver')
  const aimyDriver = await file(join(cacheRoot, 'driver/aimy.bootstrap.ts'), 'synthetic aimy driver')
  const offlineHost = await file(join(cacheRoot, 'host/offline-host.mjs'), 'synthetic offline host')
  const liveHost = await file(join(cacheRoot, 'host/live-host-entry.mjs'), 'synthetic live host')
  const qualificationHost = await file(join(cacheRoot, 'host/qualification-host-entry.mjs'), 'synthetic qualification host')
  const bundlePath = join(cacheRoot, 'tool-bundles.json')
  await writeCampaignJson(bundlePath, {
    provenance: [airiDriver, aimyDriver, offlineHost].map(value => ({ output: value.path, outputSha256: value.sha256 })),
    liveHosts: [liveHost, qualificationHost].map(value => ({ entry: join(productRoot, 'synthetic-entry.ts'), sourceSha256: sha256('synthetic source'), output: value.path, outputSha256: value.sha256 })),
  })
  const arms = {} as LiveBuildBinding['arms']
  for (const arm of ['airi', 'aimy'] as const) {
    const outputRoot = join(cacheRoot, 'builds', arm)
    const workspaceRoot = join(cacheRoot, 'workspaces', arm)
    const dependencies = join(workspaceRoot, 'apps/stage-tamagotchi/node_modules')
    await mkdir(dependencies, { recursive: true })
    const main = await file(join(outputRoot, 'out/main/index.js'), `synthetic ${arm} main`)
    const renderer = await file(join(outputRoot, 'out/renderer/assets/index.js'), `synthetic ${arm} renderer`)
    await symlink(relative(outputRoot, dependencies), join(outputRoot, 'node_modules'))
    const entries: Array<Record<string, unknown>> = []
    for (const value of [main, renderer]) {
      const info = await stat(value.path)
      entries.push({ path: relative(outputRoot, value.path), type: 'file', kind: 'source', mode: info.mode & 0o777, bytes: info.size, sha256: value.sha256 })
    }
    entries.push({ path: 'node_modules', type: 'symlink', kind: 'dependency', mode: 0o777, target: relative(outputRoot, dependencies), targetPath: dependencies })
    entries.sort((left, right) => String(left.path).localeCompare(String(right.path)))
    const manifestPath = join(outputRoot, 'build-manifest.json')
    await writeCampaignJson(manifestPath, {
      schemaVersion: 1,
      arm,
      status: 'built',
      paths: { sourceRoot: arm === 'aimy' ? productRoot : resolve(productRoot, '../.baseline/airi-evaluation-2026-10-10/source'), workspaceRoot, outputRoot },
      rendererBootstrap: { inputPath: arm === 'airi' ? airiDriver.path : aimyDriver.path, inputSha256: arm === 'airi' ? airiDriver.sha256 : aimyDriver.sha256 },
      artifacts: { sha256: sha256(JSON.stringify(entries)), entries, excluded: [] },
      entry: main.path,
    })
    arms[arm] = { manifestPath, manifestSha256: sha256(await readFile(manifestPath)), entry: main.path, entrySha256: main.sha256 }
  }
  const binding: LiveBuildBinding = { schemaVersion: 1, campaignId: campaign.manifest.campaignId, buildOwnerCampaignId: campaign.manifest.campaignId, createdAt: new Date().toISOString(), cacheRoot, buildRoot: join(cacheRoot, 'builds'), arms, liveHost, qualificationHost, bundles: { path: bundlePath, sha256: sha256(await readFile(bundlePath)) } }
  await writeCampaignJson(join(campaign.root, 'build-binding.json'), binding)
  const saveBinding = () => writeCampaignJson(join(campaign.root, 'build-binding.json'), binding, true)
  return { campaign, binding, directory, file, saveBinding }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('live build binding verification', () => {
  it('compiles immutable host revisions while retaining desktop, credentials, budget and previous host artifacts', async () => {
    const { campaign, binding } = await fixture()
    const bindingPath = join(campaign.root, 'build-binding.json')
    const originalBinding = await readFile(bindingPath)
    const secretPath = join(campaign.setupProfile, 'provider-secrets.json')
    await writeFile(secretPath, '{"syntheticCiphertext":"unchanged"}')
    const preservedPaths = [campaign.ledgerPath, secretPath, binding.liveHost.path, binding.qualificationHost.path, binding.bundles.path, binding.arms.airi.manifestPath, binding.arms.aimy.manifestPath, binding.arms.aimy.entry, join(binding.cacheRoot, 'driver/aimy.bootstrap.ts'), join(binding.cacheRoot, '.aimy-live-build.json')]
    const before = await Promise.all(preservedPaths.map(path => readFile(path)))
    const revised = await reviseLiveHostBuild(campaign)
    expect(revised.hostRevisionId).toMatch(/^[a-f\d-]{36}$/)
    expect(revised.liveHost.path).toBe(join(binding.cacheRoot, 'host/revisions', revised.hostRevisionId!, 'live-host-entry.mjs'))
    expect(revised.qualificationHost.path).toBe(join(binding.cacheRoot, 'host/revisions', revised.hostRevisionId!, 'qualification-host-entry.mjs'))
    expect(revised.arms).toEqual(binding.arms)
    expect(revised.buildOwnerCampaignId).toBe(binding.buildOwnerCampaignId)
    const metadata = JSON.parse(await readFile(revised.bundles.path, 'utf8'))
    expect(metadata.liveHosts).toHaveLength(2)
    for (const host of metadata.liveHosts) {
      expect(host.modules.length).toBeGreaterThan(1)
      expect(host.modules).toContainEqual(expect.objectContaining({ id: host.entry, transformedSha256: expect.stringMatching(/^[a-f\d]{64}$/) }))
      expect(host.externalModules).toContain('electron')
    }
    for (const [index, path] of preservedPaths.entries())
      expect(await readFile(path)).toEqual(before[index])
    const archived = await readdir(join(campaign.root, 'build-binding-archive'))
    expect(archived).toHaveLength(1)
    expect(await readFile(join(campaign.root, 'build-binding-archive', archived[0]))).toEqual(originalBinding)
    await writeFile(bindingPath, originalBinding)
    await expect(readLiveBuild(campaign)).resolves.toEqual(binding)
    await writeCampaignJson(bindingPath, revised, true)
    const hostBytes = await readFile(revised.qualificationHost.path)
    await unlink(revised.qualificationHost.path)
    await expect(readLiveBuild(campaign)).rejects.toThrow()
    await writeFile(revised.qualificationHost.path, 'altered new host')
    await expect(readLiveBuild(campaign)).rejects.toThrow('LIVE_BUILD_HOST_CHANGED')
    await writeFile(revised.qualificationHost.path, hostBytes)
    await expect(readLiveBuild(campaign)).resolves.toEqual(revised)
    const nextRevision = await reviseLiveHostBuild(campaign)
    expect(nextRevision.hostRevisionId).not.toBe(revised.hostRevisionId)
    expect(await readFile(revised.qualificationHost.path)).toEqual(hostBytes)
    await writeCampaignJson(bindingPath, revised, true)
    await expect(readLiveBuild(campaign)).resolves.toEqual(revised)
    const target = await fixture('official')
    const shared = await bindVerifiedLiveBuild(target.campaign, campaign)
    expect(shared.hostRevisionId).toBe(revised.hostRevisionId)
    expect(shared.liveHost).toEqual(revised.liveHost)
    await expect(readLiveBuild(target.campaign)).resolves.toEqual(shared)
  }, 30_000)

  it('refuses to compile a new revision when the currently bound host has changed', async () => {
    const { campaign, binding } = await fixture()
    const originalBinding = await readFile(join(campaign.root, 'build-binding.json'))
    await writeFile(binding.liveHost.path, 'tampered existing host')
    await expect(reviseLiveHostBuild(campaign)).rejects.toThrow('LIVE_BUILD_HOST_CHANGED')
    expect(await readFile(join(campaign.root, 'build-binding.json'))).toEqual(originalBinding)
    await expect(stat(join(binding.cacheRoot, 'host/revisions'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('shares only verified artifacts across distinct campaigns and archives the exact old binding', async () => {
    const source = await fixture()
    const target = await fixture('official')
    const oldBinding = await readFile(join(target.campaign.root, 'build-binding.json'))
    const sourceBinding = await readFile(join(source.campaign.root, 'build-binding.json'))
    const marker = await readFile(join(source.binding.cacheRoot, '.aimy-live-build.json'))
    const independentFiles = [source.campaign.ledgerPath, target.campaign.ledgerPath]
    for (const item of [source, target]) {
      const path = join(item.campaign.setupProfile, 'provider-secrets.json')
      await writeFile(path, JSON.stringify({ syntheticCiphertext: item.campaign.manifest.campaignId }), { mode: 0o600 })
      independentFiles.push(path)
    }
    const original = await Promise.all(independentFiles.map(path => readFile(path)))
    const shared = await bindVerifiedLiveBuild(target.campaign, source.campaign)
    expect(shared.campaignId).toBe(target.campaign.manifest.campaignId)
    expect(target.campaign.manifest.purpose).toBe('official')
    expect(source.campaign.manifest.purpose).toBe('qualification')
    expect(shared.buildOwnerCampaignId).toBe(source.campaign.manifest.campaignId)
    expect(shared.cacheRoot).toBe(source.binding.cacheRoot)
    expect(shared.arms).toEqual(source.binding.arms)
    expect(shared.liveHost).toEqual(source.binding.liveHost)
    expect(shared.qualificationHost).toEqual(source.binding.qualificationHost)
    expect(shared.bundles).toEqual(source.binding.bundles)
    expect(await readLiveBuild(target.campaign)).toEqual(shared)
    expect(await readFile(join(source.campaign.root, 'build-binding.json'))).toEqual(sourceBinding)
    expect(await readFile(join(source.binding.cacheRoot, '.aimy-live-build.json'))).toEqual(marker)
    for (const [index, path] of independentFiles.entries())
      expect(await readFile(path)).toEqual(original[index])
    const archive = join(target.campaign.root, 'build-binding-archive')
    const names = await readdir(archive)
    expect(names).toHaveLength(1)
    expect(await readFile(join(archive, names[0]))).toEqual(oldBinding)
  })

  it('preserves the original build owner through an explicit second sharing operation', async () => {
    const original = await fixture()
    const intermediate = await fixture()
    const target = await fixture()
    await bindVerifiedLiveBuild(intermediate.campaign, original.campaign)
    const shared = await bindVerifiedLiveBuild(target.campaign, intermediate.campaign)
    expect(shared.buildOwnerCampaignId).toBe(original.campaign.manifest.campaignId)
    expect(shared.cacheRoot).toBe(original.binding.cacheRoot)
    await expect(bindVerifiedLiveBuild(original.campaign, original.campaign)).rejects.toThrow('LIVE_BUILD_DISTINCT_CAMPAIGNS_REQUIRED')
  })

  it('leaves the target binding untouched when a shared source artifact or owner is altered', async () => {
    const source = await fixture()
    const target = await fixture()
    const targetBefore = await readFile(join(target.campaign.root, 'build-binding.json'))
    const asset = join(source.binding.buildRoot, 'aimy/out/renderer/assets/index.js')
    const bytes = await readFile(asset)
    await writeFile(asset, 'altered source artifact')
    await expect(bindVerifiedLiveBuild(target.campaign, source.campaign)).rejects.toThrow('LIVE_BUILD_ARTIFACT_CHANGED')
    expect(await readFile(join(target.campaign.root, 'build-binding.json'))).toEqual(targetBefore)
    await writeFile(asset, bytes)
    source.binding.buildOwnerCampaignId = target.campaign.manifest.campaignId
    await source.saveBinding()
    await expect(readLiveBuild(source.campaign)).rejects.toThrow('LIVE_BUILD_OWNER_CHANGED')
    await expect(bindVerifiedLiveBuild(target.campaign, source.campaign)).rejects.toThrow('LIVE_BUILD_OWNER_CHANGED')
    expect(await readFile(join(target.campaign.root, 'build-binding.json'))).toEqual(targetBefore)
    await expect(stat(join(target.campaign.root, 'build-binding-archive'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('verifies both artifact trees and bundles without changing campaign accounting', async () => {
    const { campaign, binding } = await fixture()
    const ledger = await readFile(campaign.ledgerPath)
    expect(await readLiveBuild(campaign)).toEqual(binding)
    expect(await readFile(campaign.ledgerPath)).toEqual(ledger)
  })

  it('detects changed renderer assets even when both main entries remain unchanged', async () => {
    const { campaign, binding } = await fixture()
    await writeFile(join(binding.buildRoot, 'aimy/out/renderer/assets/index.js'), 'tampered renderer')
    await expect(readLiveBuild(campaign)).rejects.toThrow('LIVE_BUILD_ARTIFACT_CHANGED')
  })

  it('rejects changed host bundles, driver bundles, and manifest bytes', async () => {
    const { campaign, binding } = await fixture()
    for (const path of [binding.liveHost.path, join(binding.cacheRoot, 'driver/airi.bootstrap.ts'), binding.arms.aimy.manifestPath]) {
      const original = await readFile(path)
      await writeFile(path, `${original.toString()}\n`)
      await expect(readLiveBuild(campaign)).rejects.toThrow()
      await writeFile(path, original)
    }
    await expect(readLiveBuild(campaign)).resolves.toEqual(binding)
  })

  it('rejects extra output files and missing declared artifacts', async () => {
    const { campaign, binding } = await fixture()
    const extra = join(binding.buildRoot, 'airi/out/unexpected.js')
    await writeFile(extra, 'unbound executable')
    await expect(readLiveBuild(campaign)).rejects.toThrow('LIVE_BUILD_UNEXPECTED_ARTIFACT')
    await unlink(extra)
    await unlink(join(binding.buildRoot, 'airi/out/renderer/assets/index.js'))
    await expect(readLiveBuild(campaign)).rejects.toThrow()
  })

  it('rejects output symlinks and dependency links to another location', async () => {
    const { campaign, binding, directory, file } = await fixture()
    const renderer = join(binding.buildRoot, 'airi/out/renderer/assets/index.js')
    const original = await readFile(renderer)
    const outside = await file(join(directory, 'outside.js'), original.toString())
    await unlink(renderer)
    await symlink(outside.path, renderer)
    await expect(readLiveBuild(campaign)).rejects.toThrow()
    await unlink(renderer)
    await writeFile(renderer, original, { mode: 0o600 })
    const dependencies = join(binding.buildRoot, 'airi/node_modules')
    await unlink(dependencies)
    await symlink(directory, dependencies)
    await expect(readLiveBuild(campaign)).rejects.toThrow('LIVE_BUILD_DEPENDENCY_LINK_CHANGED')
  })

  it('rejects manifest traversal even when altered manifest hashes are updated', async () => {
    const { campaign, binding, saveBinding } = await fixture()
    const path = binding.arms.airi.manifestPath
    const manifest = JSON.parse(await readFile(path, 'utf8'))
    manifest.artifacts.entries.push({ path: '../escape.js', type: 'file', kind: 'source', mode: 0o600, bytes: 0, sha256: sha256('') })
    manifest.artifacts.sha256 = sha256(JSON.stringify(manifest.artifacts.entries))
    await writeCampaignJson(path, manifest, true)
    binding.arms.airi.manifestSha256 = sha256(await readFile(path))
    await saveBinding()
    await expect(readLiveBuild(campaign)).rejects.toThrow('LIVE_BUILD_PATH_OUTSIDE_CACHE')
  })

  it('rejects forged bundle output paths and mismatched campaign ownership', async () => {
    const { campaign, binding, saveBinding } = await fixture()
    const bundles = JSON.parse(await readFile(binding.bundles.path, 'utf8'))
    bundles.liveHosts[0].output = '/unrelated/private-file'
    await writeCampaignJson(binding.bundles.path, bundles, true)
    binding.bundles.sha256 = sha256(await readFile(binding.bundles.path))
    await saveBinding()
    await expect(readLiveBuild(campaign)).rejects.toThrow('LIVE_BUILD_PATH_OUTSIDE_CACHE')
    binding.campaignId = '11111111-1111-4111-8111-111111111111'
    await saveBinding()
    await expect(readLiveBuild(campaign)).rejects.toThrow('LIVE_BUILD_CAMPAIGN_CHANGED')
  })

  it('rejects missing installed tools before creating a new cache or changing the binding', async () => {
    const { campaign, directory } = await fixture()
    const before = await readFile(join(campaign.root, 'build-binding.json'))
    const cacheRoot = join(directory, 'new-cache')
    await expect(prepareLiveBuild(campaign, { cacheRoot, pnpmPath: join(directory, 'missing-pnpm') })).rejects.toThrow()
    await expect(stat(cacheRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(campaign.root, 'build-binding.json'))).toEqual(before)
  })

  it('requires a new temporary cache and rejects cache aliases', async () => {
    const { campaign, binding, directory, saveBinding } = await fixture()
    await expect(prepareLiveBuild(campaign, { cacheRoot: binding.cacheRoot, pnpmPath: join(directory, 'unused-pnpm') })).rejects.toThrow('LIVE_BUILD_CACHE_EXISTS')
    await expect(prepareLiveBuild(campaign, { cacheRoot: join(productRoot, 'forbidden-live-cache'), pnpmPath: join(directory, 'unused-pnpm') })).rejects.toThrow('LIVE_BUILD_TEMP_CACHE_REQUIRED')
    await expect(stat(join(productRoot, 'forbidden-live-cache'))).rejects.toMatchObject({ code: 'ENOENT' })
    const alias = join(directory, 'cache-alias')
    await symlink(binding.cacheRoot, alias)
    binding.cacheRoot = alias
    await saveBinding()
    await expect(readLiveBuild(campaign)).rejects.toThrow('LIVE_BUILD_DIRECTORY_ALIAS')
  })
})
