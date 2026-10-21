import type { LiveCampaign } from './live-campaign'
import type { AcceptanceArm } from './prepare-build'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, lstat, mkdir, open, readdir, readlink, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { build } from 'vite'

import * as v from 'valibot'

import { sha256 } from './dataset'
import { openLiveCampaign, readCampaignJson, writeCampaignJson } from './live-campaign'
import { bundleOfflineTools, prepareOfflineComparison } from './offline-build'

const directory = import.meta.dirname
const productRoot = resolve(directory, '../../../..')
const digest = v.pipe(v.string(), v.regex(/^[a-f\d]{64}$/))
const absolute = v.pipe(v.string(), v.check(isAbsolute))
const fileSchema = v.strictObject({ path: absolute, sha256: digest })
const armSchema = v.strictObject({ manifestPath: absolute, manifestSha256: digest, entry: absolute, entrySha256: digest })
const bindingSchema = v.strictObject({
  schemaVersion: v.literal(1),
  campaignId: v.pipe(v.string(), v.uuid()),
  buildOwnerCampaignId: v.pipe(v.string(), v.uuid()),
  hostRevisionId: v.optional(v.pipe(v.string(), v.uuid())),
  createdAt: v.pipe(v.string(), v.check(value => Number.isFinite(Date.parse(value)))),
  cacheRoot: absolute,
  buildRoot: absolute,
  arms: v.strictObject({ airi: armSchema, aimy: armSchema }),
  liveHost: fileSchema,
  qualificationHost: fileSchema,
  bundles: fileSchema,
})
const artifactSchema = v.strictObject({
  path: v.string(),
  type: v.picklist(['file', 'symlink']),
  kind: v.picklist(['source', 'dependency', 'workspace-dist', 'offline-asset']),
  mode: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(0o777)),
  bytes: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
  sha256: v.optional(digest),
  target: v.optional(v.string()),
  targetPath: v.optional(v.string()),
})
const manifestSchema = v.object({
  schemaVersion: v.literal(1),
  arm: v.picklist(['airi', 'aimy']),
  status: v.literal('built'),
  paths: v.object({ sourceRoot: absolute, workspaceRoot: absolute, outputRoot: absolute }),
  rendererBootstrap: v.object({ inputPath: absolute, inputSha256: digest }),
  artifacts: v.object({ sha256: digest, entries: v.array(artifactSchema), excluded: v.array(v.string()) }),
  entry: absolute,
})
const bundlesSchema = v.object({
  provenance: v.array(v.object({ output: absolute, outputSha256: digest })),
  hostRevisionId: v.optional(v.pipe(v.string(), v.uuid())),
  liveHosts: v.array(v.object({
    entry: absolute,
    sourceSha256: digest,
    output: absolute,
    outputSha256: digest,
    modules: v.optional(v.array(v.strictObject({ id: v.pipe(v.string(), v.minLength(1), v.maxLength(4096)), transformedSha256: digest }))),
    externalModules: v.optional(v.array(v.string())),
  })),
})

export type LiveBuildBinding = v.InferOutput<typeof bindingSchema>

function check(value: unknown, code: string): asserts value {
  if (!value)
    throw new Error(code)
}

function child(root: string, path: string) {
  const subpath = relative(root, path)
  check(subpath && !isAbsolute(subpath) && subpath !== '..' && !subpath.startsWith(`..${sep}`), 'LIVE_BUILD_PATH_OUTSIDE_CACHE')
}

async function cacheDirectory(path: string, allowTempRoot = false) {
  check(isAbsolute(path), 'LIVE_BUILD_ABSOLUTE_PATH_REQUIRED')
  const canonical = await realpath(path)
  const info = await lstat(path)
  const normalized = resolve(path)
  const systemTempAlias = process.platform === 'darwin' && (normalized === '/tmp' || normalized.startsWith('/tmp/') || normalized === '/var' || normalized.startsWith('/var/'))
    && canonical === `/private${normalized}`
  check((info.isDirectory() && !info.isSymbolicLink() && canonical === normalized) || systemTempAlias, 'LIVE_BUILD_DIRECTORY_ALIAS')
  const tempRoots = [await realpath(tmpdir())]
  if (process.platform === 'darwin')
    tempRoots.push(await realpath('/tmp'))
  check(tempRoots.some((root) => {
    const within = relative(root, canonical)
    return (allowTempRoot && !within) || (within && !isAbsolute(within) && within !== '..' && !within.startsWith(`..${sep}`))
  }), 'LIVE_BUILD_TEMP_CACHE_REQUIRED')
  return canonical
}

async function regularFile(root: string, path: string) {
  child(root, path)
  const info = await lstat(path)
  check(info.isFile() && !info.isSymbolicLink() && await realpath(path) === path, 'LIVE_BUILD_FILE_ALIAS')
  return info
}

async function hashFile(root: string, path: string) {
  const info = await regularFile(root, path)
  check(info.size <= 1024 * 1024 * 1024, 'LIVE_BUILD_FILE_TOO_LARGE')
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const hash = createHash('sha256')
    let bytes = 0
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      bytes += chunk.length
      check(bytes <= info.size, 'LIVE_BUILD_FILE_CHANGED')
      hash.update(chunk)
    }
    check(bytes === info.size, 'LIVE_BUILD_FILE_CHANGED')
    return hash.digest('hex')
  }
  finally { await handle.close() }
}

async function largeManifest(root: string, path: string) {
  const info = await regularFile(root, path)
  // Existing manifests include source and dependency inventories. They are about 106 MiB per arm.
  check(info.size > 0 && info.size <= 256 * 1024 * 1024, 'LIVE_BUILD_MANIFEST_SIZE')
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const buffer = Buffer.alloc(info.size + 1)
    let length = 0
    while (length < buffer.length) {
      const next = await handle.read(buffer, length, buffer.length - length, length)
      if (!next.bytesRead)
        break
      length += next.bytesRead
    }
    check(length === info.size, 'LIVE_BUILD_MANIFEST_CHANGED')
    return v.parse(manifestSchema, JSON.parse(buffer.subarray(0, length).toString('utf8')))
  }
  finally { await handle.close() }
}

async function verifyArm(binding: LiveBuildBinding, arm: AcceptanceArm) {
  const bound = binding.arms[arm]
  const outputRoot = join(binding.buildRoot, arm)
  const workspaceRoot = join(binding.cacheRoot, 'workspaces', arm)
  check(await cacheDirectory(outputRoot) === outputRoot, 'LIVE_BUILD_OUTPUT_CHANGED')
  check(await cacheDirectory(workspaceRoot) === workspaceRoot, 'LIVE_BUILD_WORKSPACE_CHANGED')
  check(bound.manifestPath === join(outputRoot, 'build-manifest.json') && bound.entry === join(outputRoot, 'out/main/index.js'), 'LIVE_BUILD_ENTRY_CHANGED')
  check(await hashFile(binding.cacheRoot, bound.manifestPath) === bound.manifestSha256, 'LIVE_BUILD_MANIFEST_CHANGED')
  const manifest = await largeManifest(binding.cacheRoot, bound.manifestPath)
  const sourceRoot = arm === 'aimy' ? productRoot : resolve(productRoot, '../.baseline/airi-evaluation-2026-10-10/source')
  check(manifest.arm === arm && manifest.paths.outputRoot === outputRoot && manifest.paths.workspaceRoot === workspaceRoot
    && manifest.paths.sourceRoot === sourceRoot && manifest.entry === bound.entry, 'LIVE_BUILD_MANIFEST_IDENTITY')
  check(manifest.rendererBootstrap.inputPath === join(binding.cacheRoot, 'driver', `${arm}.bootstrap.ts`)
    && await hashFile(binding.cacheRoot, manifest.rendererBootstrap.inputPath) === manifest.rendererBootstrap.inputSha256, 'LIVE_BUILD_DRIVER_CHANGED')
  check(sha256(JSON.stringify(manifest.artifacts.entries)) === manifest.artifacts.sha256, 'LIVE_BUILD_ARTIFACT_LIST_CHANGED')
  const expected = new Set<string>()
  for (const artifact of manifest.artifacts.entries) {
    const path = join(outputRoot, artifact.path)
    child(outputRoot, path)
    check(relative(outputRoot, path) === artifact.path && !expected.has(artifact.path), 'LIVE_BUILD_ARTIFACT_PATH_INVALID')
    expected.add(artifact.path)
    const info = await lstat(path)
    if (artifact.type === 'file') {
      check((info.mode & 0o777) === artifact.mode, 'LIVE_BUILD_ARTIFACT_MODE_CHANGED')
      check(info.size === artifact.bytes && await hashFile(binding.cacheRoot, path) === artifact.sha256, 'LIVE_BUILD_ARTIFACT_CHANGED')
    }
    else {
      // NOTICE:
      // prepare-build.ts records link mode 0777. macOS creates this link with mode 0755 under the active umask.
      // Link permissions do not grant target access. Validate its exact owned target instead.
      // Remove this exception when the builder records native link modes.
      const dependencies = join(workspaceRoot, 'apps/stage-tamagotchi/node_modules')
      check(artifact.path === 'node_modules' && artifact.kind === 'dependency' && info.isSymbolicLink()
        && artifact.target === relative(outputRoot, dependencies) && artifact.targetPath === dependencies
        && await readlink(path) === artifact.target && await realpath(path) === dependencies, 'LIVE_BUILD_DEPENDENCY_LINK_CHANGED')
    }
  }
  check(expected.has('out/main/index.js') && expected.has('node_modules'), 'LIVE_BUILD_REQUIRED_ARTIFACT_MISSING')
  const ignored = new Set(['.aimy-acceptance-output.json', 'prepare-manifest.json', 'build-manifest.json', 'build-logs', '.build-config'])
  const pending = ['']
  const actual = new Set<string>()
  while (pending.length) {
    const parent = pending.pop()!
    for (const entry of await readdir(join(outputRoot, parent), { withFileTypes: true })) {
      const path = parent ? `${parent}/${entry.name}` : entry.name
      if (!parent && ignored.has(path))
        continue
      if (entry.isDirectory())
        pending.push(path)
      else
        actual.add(path)
    }
  }
  check(actual.size === expected.size && [...actual].every(path => expected.has(path)), 'LIVE_BUILD_UNEXPECTED_ARTIFACT')
  check(await hashFile(binding.cacheRoot, bound.entry) === bound.entrySha256, 'LIVE_BUILD_ENTRY_CHANGED')
}

/** Reads and verifies existing artifacts only. Missing or altered outputs never trigger a build or repair. */
export async function readLiveBuild(campaign: LiveCampaign): Promise<LiveBuildBinding> {
  const current = await openLiveCampaign(campaign.root)
  check(current.manifest.campaignId === campaign.manifest.campaignId, 'LIVE_BUILD_CAMPAIGN_CHANGED')
  const binding = v.parse(bindingSchema, await readCampaignJson(join(current.root, 'build-binding.json')))
  return verifyBinding(current, binding)
}

async function verifyBinding(current: LiveCampaign, binding: LiveBuildBinding): Promise<LiveBuildBinding> {
  check(binding.campaignId === current.manifest.campaignId, 'LIVE_BUILD_CAMPAIGN_CHANGED')
  check(await cacheDirectory(binding.cacheRoot) === binding.cacheRoot && binding.buildRoot === join(binding.cacheRoot, 'builds'), 'LIVE_BUILD_CACHE_CHANGED')
  const marker = await readCampaignJson(join(binding.cacheRoot, '.aimy-live-build.json'))
  check(JSON.stringify(marker) === JSON.stringify({ schemaVersion: 1, campaignId: binding.buildOwnerCampaignId, purpose: 'controlled-live-build' }), 'LIVE_BUILD_OWNER_CHANGED')
  const hostRoot = binding.hostRevisionId ? join(binding.cacheRoot, 'host', 'revisions', binding.hostRevisionId) : join(binding.cacheRoot, 'host')
  for (const [field, name] of [[binding.liveHost, 'live-host-entry.mjs'], [binding.qualificationHost, 'qualification-host-entry.mjs']] as const) {
    check(field.path === join(hostRoot, name) && await hashFile(binding.cacheRoot, field.path) === field.sha256, 'LIVE_BUILD_HOST_CHANGED')
  }
  const bundlesPath = join(binding.hostRevisionId ? hostRoot : binding.cacheRoot, 'tool-bundles.json')
  check(binding.bundles.path === bundlesPath && await hashFile(binding.cacheRoot, binding.bundles.path) === binding.bundles.sha256, 'LIVE_BUILD_BUNDLES_CHANGED')
  const bundles = v.parse(bundlesSchema, await readCampaignJson(binding.bundles.path, 1024 * 1024))
  check(bundles.hostRevisionId === binding.hostRevisionId, 'LIVE_BUILD_HOST_REVISION_CHANGED')
  if (binding.hostRevisionId) {
    for (const host of bundles.liveHosts)
      check(host.modules?.length && host.externalModules && host.modules.some(module => module.id === host.entry), 'LIVE_BUILD_HOST_INPUTS_MISSING')
  }
  const expectedBundles = new Set(['driver/airi.bootstrap.ts', 'driver/aimy.bootstrap.ts', 'host/offline-host.mjs', relative(binding.cacheRoot, binding.liveHost.path), relative(binding.cacheRoot, binding.qualificationHost.path)])
  const actualBundles = new Set<string>()
  for (const item of [...bundles.provenance, ...bundles.liveHosts]) {
    child(binding.cacheRoot, item.output)
    const path = relative(binding.cacheRoot, item.output)
    check(expectedBundles.has(path) && !actualBundles.has(path) && await hashFile(binding.cacheRoot, item.output) === item.outputSha256, 'LIVE_BUILD_BUNDLE_OUTPUT_CHANGED')
    actualBundles.add(path)
  }
  check(actualBundles.size === expectedBundles.size, 'LIVE_BUILD_BUNDLE_OUTPUT_MISSING')
  await verifyArm(binding, 'airi')
  await verifyArm(binding, 'aimy')
  return binding
}

async function compileLiveHosts(cacheRoot: string, outputRoot: string) {
  const hosts = []
  for (const name of ['live-host-entry', 'qualification-host-entry']) {
    const entry = join(directory, `${name}.ts`)
    const modules: Array<{ id: string, transformedSha256: string }> = []
    const externalModules = new Set<string>()
    await build({ configFile: false, root: directory, envDir: false, logLevel: 'warn', plugins: [{
      name: 'aimy-live-host-input-provenance',
      generateBundle() {
        for (const id of this.getModuleIds()) {
          const module = this.getModuleInfo(id)
          if (module?.code !== null && module?.code !== undefined)
            modules.push({ id, transformedSha256: sha256(module.code) })
        }
        modules.sort((left, right) => left.id.localeCompare(right.id))
      },
    }], build: {
      outDir: outputRoot,
      emptyOutDir: false,
      minify: false,
      target: 'node24',
      lib: { entry, formats: ['es'], fileName: () => `${name}.mjs` },
      rollupOptions: { external: (id) => {
        const external = id === 'electron' || id.startsWith('node:')
        if (external)
          externalModules.add(id)
        return external
      } },
    } })
    const output = join(outputRoot, `${name}.mjs`)
    hosts.push({ entry, sourceSha256: await hashFile(productRoot, entry), output, outputSha256: await hashFile(cacheRoot, output), modules, externalModules: [...externalModules].sort() })
  }
  return hosts
}

/**
 * Builds isolated temporary copies with installed tools and binds their final outputs to the existing campaign.
 * Call stack: CLI prepare-build -> bundleOfflineTools -> prepareOfflineComparison (AIRI, Aimy) -> readLiveBuild.
 */
export async function prepareLiveBuild(campaign: LiveCampaign, options: { cacheRoot: string, pnpmPath: string }): Promise<LiveBuildBinding> {
  const current = await openLiveCampaign(campaign.root)
  check(current.manifest.campaignId === campaign.manifest.campaignId, 'LIVE_BUILD_CAMPAIGN_CHANGED')
  check(isAbsolute(options.cacheRoot) && isAbsolute(options.pnpmPath), 'LIVE_BUILD_ABSOLUTE_PATH_REQUIRED')
  const parent = await cacheDirectory(dirname(options.cacheRoot), true)
  const cacheRoot = join(parent, relative(dirname(options.cacheRoot), options.cacheRoot))
  try {
    await lstat(cacheRoot)
    throw new Error('LIVE_BUILD_CACHE_EXISTS')
  }
  catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT')
      throw error
  }
  for (const name of ['live-host-entry.ts', 'qualification-host-entry.ts'])
    check((await lstat(join(directory, name))).isFile(), 'LIVE_BUILD_HOST_SOURCE_MISSING')
  const pnpm = await realpath(options.pnpmPath)
  check((await lstat(pnpm)).isFile(), 'LIVE_BUILD_INSTALLED_PNPM_REQUIRED')
  await access(pnpm, constants.X_OK)
  await mkdir(cacheRoot, { mode: 0o700 })
  await writeCampaignJson(join(cacheRoot, '.aimy-live-build.json'), { schemaVersion: 1, campaignId: current.manifest.campaignId, purpose: 'controlled-live-build' })
  await bundleOfflineTools(cacheRoot)
  const hosts = await compileLiveHosts(cacheRoot, join(cacheRoot, 'host'))
  const bundlePath = join(cacheRoot, 'tool-bundles.json')
  const original = v.parse(v.record(v.string(), v.unknown()), await readCampaignJson(bundlePath, 1024 * 1024))
  await writeCampaignJson(bundlePath, { ...original, liveHosts: hosts }, true)
  const arms = {} as LiveBuildBinding['arms']
  for (const arm of ['airi', 'aimy'] as const) {
    const built = await prepareOfflineComparison(cacheRoot, pnpm, arm)
    check(built.status === 'built' && built.entry, 'LIVE_BUILD_FAILED')
    const manifestPath = join(cacheRoot, 'builds', arm, 'build-manifest.json')
    arms[arm] = { manifestPath, manifestSha256: await hashFile(cacheRoot, manifestPath), entry: built.entry, entrySha256: await hashFile(cacheRoot, built.entry) }
  }
  const binding: LiveBuildBinding = {
    schemaVersion: 1,
    campaignId: current.manifest.campaignId,
    buildOwnerCampaignId: current.manifest.campaignId,
    createdAt: new Date().toISOString(),
    cacheRoot,
    buildRoot: join(cacheRoot, 'builds'),
    arms,
    liveHost: { path: hosts[0].output, sha256: hosts[0].outputSha256 },
    qualificationHost: { path: hosts[1].output, sha256: hosts[1].outputSha256 },
    bundles: { path: bundlePath, sha256: await hashFile(cacheRoot, bundlePath) },
  }
  return persistBinding(current, binding)
}

/**
 * Recompiles only host entrypoints into a fresh revision after verifying the entire currently bound build.
 * Desktop outputs and driver bundles stay immutable. No campaign budget, profile, or credentials are shared or changed.
 * Call stack: explicit revise -> readLiveBuild -> Vite host compilation -> verify and archive target binding.
 */
export async function reviseLiveHostBuild(campaign: LiveCampaign): Promise<LiveBuildBinding> {
  const previous = await readLiveBuild(campaign)
  const current = await openLiveCampaign(campaign.root)
  check(current.manifest.campaignId === previous.campaignId, 'LIVE_BUILD_CAMPAIGN_CHANGED')
  const revisions = join(previous.cacheRoot, 'host', 'revisions')
  await mkdir(revisions, { recursive: true, mode: 0o700 })
  check(await cacheDirectory(revisions) === revisions, 'LIVE_BUILD_DIRECTORY_ALIAS')
  const hostRevisionId = randomUUID()
  const hostRoot = join(revisions, hostRevisionId)
  await mkdir(hostRoot, { mode: 0o700 })
  const hosts = await compileLiveHosts(previous.cacheRoot, hostRoot)
  const bundlesPath = join(hostRoot, 'tool-bundles.json')
  const original = v.parse(v.record(v.string(), v.unknown()), await readCampaignJson(previous.bundles.path, 1024 * 1024))
  await writeCampaignJson(bundlesPath, { ...original, hostRevisionId, previousBundles: previous.bundles, liveHosts: hosts })
  const binding: LiveBuildBinding = {
    ...previous,
    createdAt: new Date().toISOString(),
    hostRevisionId,
    liveHost: { path: hosts[0].output, sha256: hosts[0].outputSha256 },
    qualificationHost: { path: hosts[1].output, sha256: hosts[1].outputSha256 },
    bundles: { path: bundlesPath, sha256: await hashFile(previous.cacheRoot, bundlesPath) },
  }
  return persistBinding(current, binding)
}

/**
 * Shares only explicitly selected, fully verified build artifacts across two existing campaigns.
 * Each campaign keeps its own budget, credentials, profiles, and execution purpose.
 * Call stack: explicit bind -> readLiveBuild(source) -> verify target binding -> archive and save binding.
 */
export async function bindVerifiedLiveBuild(targetCampaign: LiveCampaign, sourceCampaign: LiveCampaign): Promise<LiveBuildBinding> {
  const source = await readLiveBuild(sourceCampaign)
  const sourceCurrent = await openLiveCampaign(sourceCampaign.root)
  check(sourceCurrent.manifest.campaignId === source.campaignId, 'LIVE_BUILD_CAMPAIGN_CHANGED')
  const current = await openLiveCampaign(targetCampaign.root)
  check(current.manifest.campaignId === targetCampaign.manifest.campaignId, 'LIVE_BUILD_CAMPAIGN_CHANGED')
  check(current.root !== sourceCurrent.root && current.manifest.campaignId !== sourceCurrent.manifest.campaignId, 'LIVE_BUILD_DISTINCT_CAMPAIGNS_REQUIRED')
  check(current.manifest.datasetSha256 === sourceCurrent.manifest.datasetSha256
    && current.manifest.sourceSha256 === sourceCurrent.manifest.sourceSha256, 'LIVE_BUILD_DATASET_MISMATCH')
  const binding: LiveBuildBinding = { ...source, campaignId: current.manifest.campaignId, createdAt: new Date().toISOString() }
  return persistBinding(current, binding)
}

async function persistBinding(current: LiveCampaign, binding: LiveBuildBinding): Promise<LiveBuildBinding> {
  await verifyBinding(current, binding)
  const bindingPath = join(current.root, 'build-binding.json')
  try {
    const info = await regularFile(current.root, bindingPath)
    check(info.size <= 64 * 1024, 'LIVE_BUILD_BINDING_SIZE')
    const previous = await open(bindingPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    let bytes
    try {
      const buffer = Buffer.alloc(info.size + 1)
      let length = 0
      while (length < buffer.length) {
        const chunk = await previous.read(buffer, length, buffer.length - length, length)
        if (!chunk.bytesRead)
          break
        length += chunk.bytesRead
      }
      bytes = buffer.subarray(0, length)
    }
    finally { await previous.close() }
    check(bytes.length === info.size, 'LIVE_BUILD_BINDING_CHANGED')
    const archive = join(current.root, 'build-binding-archive')
    await mkdir(archive, { recursive: true, mode: 0o700 })
    check(await realpath(archive) === archive && (await lstat(archive)).isDirectory(), 'LIVE_BUILD_ARCHIVE_ALIAS')
    const archived = await open(join(archive, `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}.json`), 'wx', 0o600)
    try {
      await archived.writeFile(bytes)
      await archived.sync()
    }
    finally { await archived.close() }
    const archiveDirectory = await open(archive, constants.O_RDONLY)
    try {
      await archiveDirectory.sync()
    }
    finally { await archiveDirectory.close() }
  }
  catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT')
      throw error
  }
  await writeCampaignJson(bindingPath, binding, true)
  return readLiveBuild(current)
}
