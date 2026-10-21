import type { ChildProcess } from 'node:child_process'

import process from 'node:process'

import { execFile, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { constants, createReadStream, createWriteStream } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import * as fs from 'node:fs/promises'

import * as v from 'valibot'

export type AcceptanceArm = 'airi' | 'aimy'

export interface PrepareAcceptanceBuildOptions {
  sourceRoot: string
  workspaceRoot: string
  outputRoot: string
  arm: AcceptanceArm
  clockShimPath: string
  rendererBootstrapPath?: string
}

type FileKind = 'source' | 'dependency' | 'workspace-dist' | 'offline-asset'
type CloneBackend = 'node-ficlone-force' | 'darwin-clonefile'
interface ClonePair { source: string, destination: string, expectedSha256?: string }
interface Entry {
  path: string
  type: 'file' | 'symlink'
  kind: FileKind
  mode: number
  bytes?: number
  sha256?: string
  target?: string
  targetPath?: string
}

interface Snapshot {
  sha256: string
  entries: Entry[]
  excluded: string[]
}

export interface PreparedAcceptanceBuild {
  schemaVersion: 1
  preparationId: string
  sourceRoot: string
  workspaceRoot: string
  outputRoot: string
  arm: AcceptanceArm
  manifestPath: string
  manifestSha256: string
}

export interface AcceptanceBuildManifest {
  schemaVersion: 1
  preparationId: string
  arm: AcceptanceArm
  status: 'prepared' | 'built' | 'failed'
  cloning: { backend: CloneBackend, nodeForceFailure?: string, nativeProgramSha256?: string }
  lineage: { repositoryImportCommit: string, upstreamCommit: null }
  paths: { sourceRoot: string, workspaceRoot: string, outputRoot: string }
  source: Snapshot
  prepared: Snapshot
  adapter: { inputSha256: string, servicePath: string, changes: Array<{ path: string, before: string | null, after: string, reason: string }> }
  rendererBootstrap?: {
    inputPath: string
    inputSha256: string
    targetPath: string
    mainPath: string
    originalMain: string
    originalMainSha256: string
    adaptedMainSha256: string
    importLine: string
    provenance: 'caller-generated-single-file-driver'
  }
  offlineAssets: string[]
  commands: Array<{ package: string, runner: 'direct-node-bin', cwd: string, toolPath: string, toolSha256: string, args: string[], exitCode?: number | null, signal?: string | null, logPath?: string, logSha256?: string }>
  createdAt: string
  toolchain?: { node: string, nodeSha256: string, pnpm: string, pnpmVersion: string, pnpmSha256: string, packageManagerExecuted: false }
  builtAt?: string
  artifacts?: Snapshot
  workspaceAfterBuild?: Snapshot
  entry?: string
  failure?: string
}

const optionSchema = v.strictObject({
  sourceRoot: v.pipe(v.string(), v.minLength(1)),
  workspaceRoot: v.pipe(v.string(), v.minLength(1)),
  outputRoot: v.pipe(v.string(), v.minLength(1)),
  arm: v.picklist(['airi', 'aimy']),
  clockShimPath: v.pipe(v.string(), v.minLength(1)),
  rendererBootstrapPath: v.optional(v.pipe(v.string(), v.minLength(1))),
})
const chatPath = 'packages/stage-ui/src/stores/chat.ts'
const clockPath = 'packages/stage-ui/src/services/conversation-clock.ts'
const rendererMainPath = 'apps/stage-tamagotchi/src/renderer/main.ts'
const bootstrapTargetPath = 'apps/stage-tamagotchi/src/renderer/acceptance.bootstrap.ts'
const bootstrapImport = 'import \'./acceptance.bootstrap\''
const factory = 'const runtime = createChatOrchestratorRuntime({'
const clockImport = 'import { conversationNow } from \'../services/conversation-clock\''
const workspaceMarker = '.aimy-acceptance-workspace.json'
const outputMarker = '.aimy-acceptance-output.json'
const importCommit = 'bf4190376ebfc1df932c61f2b2f832387505e70d'
const installedPathMetadata = /(?:^|\/)node_modules\/(?:\.bin\/[^/]+|\.modules\.yaml|\.package-map\.json|\.pnpm-workspace-state-v1\.json)$/
// /bin/cp -c documents a copyfile fallback. Call clonefile directly, once per approved batch, instead.
const nativeCloneProgram = `import ctypes, errno, json, os, stat, sys
library = ctypes.CDLL(None, use_errno=True)
clone = library.clonefile
clone.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
clone.restype = ctypes.c_int
pairs = json.load(sys.stdin)
for index, pair in enumerate(pairs):
    source, target = pair
    if not os.path.isabs(source) or not os.path.isabs(target) or not stat.S_ISREG(os.lstat(source).st_mode):
        print(json.dumps({'failedAt': index, 'errno': errno.EINVAL}))
        sys.exit(1)
    if os.path.lexists(target):
        print(json.dumps({'failedAt': index, 'errno': errno.EEXIST}))
        sys.exit(1)
    # CLONE_NOFOLLOW. An unsupported filesystem returns an error. There is no data-copy branch.
    if clone(os.fsencode(source), os.fsencode(target), 1) != 0:
        print(json.dumps({'failedAt': index, 'errno': ctypes.get_errno()}))
        sys.exit(1)
print(json.dumps({'cloned': len(pairs)}))
`
const sdkCache = 'apps/stage-tamagotchi/src/renderer/.cache/assets/js/CubismSdkForWeb-5-r.3'
const offlineFiles = [
  '.cache/live2d/models/hiyori_free_zh.zip',
  '.cache/live2d/models/hiyori_pro_zh.zip',
  '.cache/vrm/models/AvatarSample-A/AvatarSample_A.vrm',
  '.cache/vrm/models/AvatarSample-B/AvatarSample_B.vrm',
]
const requiredOfflineFiles = [...offlineFiles, `${sdkCache}/Core/live2dcubismcore.min.js`, `${sdkCache}/Framework/src/live2dcubismframework.ts`]
const ignoredDirectories = new Set(['.git', '.agents', '.claude', '.codex', '.cursor', '.gemini', '.vscode', '.zed', '.ssh', '.aws', '.kube', '.turbo', '.vite', '.vite-temp', '.cache', 'cache', 'Cache', 'Code Cache', 'GPUCache', 'out', 'logs', 'log', 'profiles', 'user-data', 'userData', 'userdata', 'IndexedDB', 'Local Storage', 'Session Storage', '__screenshots__', 'test-results', 'playwright-report'])
const ignoredFiles = new Set(['.git', '.npmrc', '.yarnrc', '.yarnrc.yml', '.netrc', '.pnpmfile.cjs', 'pnpmfile.cjs', '.DS_Store', workspaceMarker, outputMarker])

const entrySchema = v.strictObject({
  path: v.string(),
  type: v.picklist(['file', 'symlink']),
  kind: v.picklist(['source', 'dependency', 'workspace-dist', 'offline-asset']),
  mode: v.number(),
  bytes: v.optional(v.number()),
  sha256: v.optional(v.string()),
  target: v.optional(v.string()),
  targetPath: v.optional(v.string()),
})
const snapshotSchema = v.strictObject({ sha256: v.string(), entries: v.array(entrySchema), excluded: v.array(v.string()) })
const manifestSchema: v.GenericSchema<AcceptanceBuildManifest> = v.strictObject({
  schemaVersion: v.literal(1),
  preparationId: v.string(),
  arm: v.picklist(['airi', 'aimy']),
  status: v.picklist(['prepared', 'built', 'failed']),
  cloning: v.strictObject({ backend: v.picklist(['node-ficlone-force', 'darwin-clonefile']), nodeForceFailure: v.optional(v.string()), nativeProgramSha256: v.optional(v.string()) }),
  lineage: v.strictObject({ repositoryImportCommit: v.string(), upstreamCommit: v.null() }),
  paths: v.strictObject({ sourceRoot: v.string(), workspaceRoot: v.string(), outputRoot: v.string() }),
  source: snapshotSchema,
  prepared: snapshotSchema,
  adapter: v.strictObject({ inputSha256: v.string(), servicePath: v.string(), changes: v.array(v.strictObject({ path: v.string(), before: v.nullable(v.string()), after: v.string(), reason: v.string() })) }),
  rendererBootstrap: v.optional(v.strictObject({
    inputPath: v.string(),
    inputSha256: v.string(),
    targetPath: v.string(),
    mainPath: v.string(),
    originalMain: v.string(),
    originalMainSha256: v.string(),
    adaptedMainSha256: v.string(),
    importLine: v.string(),
    provenance: v.literal('caller-generated-single-file-driver'),
  })),
  offlineAssets: v.array(v.string()),
  commands: v.array(v.strictObject({ package: v.string(), runner: v.literal('direct-node-bin'), cwd: v.string(), toolPath: v.string(), toolSha256: v.string(), args: v.array(v.string()), exitCode: v.optional(v.nullable(v.number())), signal: v.optional(v.nullable(v.string())), logPath: v.optional(v.string()), logSha256: v.optional(v.string()) })),
  createdAt: v.string(),
  toolchain: v.optional(v.strictObject({ node: v.string(), nodeSha256: v.string(), pnpm: v.string(), pnpmVersion: v.string(), pnpmSha256: v.string(), packageManagerExecuted: v.literal(false) })),
  builtAt: v.optional(v.string()),
  artifacts: v.optional(snapshotSchema),
  workspaceAfterBuild: v.optional(snapshotSchema),
  entry: v.optional(v.string()),
  failure: v.optional(v.string()),
})

class BuildPreparationError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

function check(condition: unknown, code: string): asserts condition {
  if (!condition)
    throw new BuildPreparationError(code)
}

function within(parent: string, child: string) {
  const path = relative(parent, child)
  return !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`)
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

async function hashFile(path: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path))
    hash.update(chunk)
  return hash.digest('hex')
}

async function missing(path: string) {
  try {
    await fs.lstat(path)
    return false
  }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return true
    throw error
  }
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await fs.realpath(path)
  }
  catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT')
      throw error
    const parent = dirname(path)
    check(parent !== path, 'UNKNOWN_PATH_OWNERSHIP')
    return join(await canonicalPath(parent), basename(path))
  }
}

function approvedCache(path: string) {
  return path === sdkCache || path.startsWith(`${sdkCache}/`) || offlineFiles.includes(path)
}

function cacheAncestor(path: string) {
  return [sdkCache, ...offlineFiles].some(allowed => allowed.startsWith(`${path}/`))
}

function excluded(path: string, directory: boolean) {
  const name = basename(path)
  if (name.startsWith('.env') || ignoredFiles.has(name) || /(?:^|[-_.])(?:credentials?|secrets?)(?:\.(?:json|ya?ml|toml|txt)|$)/i.test(name)
    || /\.(?:pem|p12|pfx|key|keychain-db|sqlite3?|db|ldb|log)$/i.test(name) || /^id_(?:rsa|ed25519|ecdsa)(?:\.pub)?$/.test(name)) {
    return true
  }
  if (approvedCache(path) || (directory && cacheAncestor(path)))
    return false
  if (path.split('/').includes('.cache'))
    return true
  // Installed packages can ship executable code in out, cache or log directories.
  if (path.split('/').includes('node_modules'))
    return directory && ['.git', '.cache', '.vite', '.vite-temp'].includes(name)
  return directory && ignoredDirectories.has(name)
}

function entryKind(path: string): FileKind {
  if (approvedCache(path))
    return 'offline-asset'
  if (path.split('/').includes('node_modules'))
    return 'dependency'
  if (path.split('/').includes('dist'))
    return 'workspace-dist'
  return 'source'
}

async function concurrent<T>(items: T[], work: (item: T) => Promise<void>) {
  let index = 0
  const results = await Promise.allSettled(Array.from({ length: Math.min(8, items.length) }, async () => {
    while (index < items.length)
      await work(items[index++])
  }))
  const failure = results.find(result => result.status === 'rejected')
  if (failure?.status === 'rejected')
    throw failure.reason
}

/** Inventories regular files and links without following directory links or reading excluded data. */
async function snapshot(root: string, artifacts = false): Promise<Snapshot> {
  const entries: Entry[] = []
  const omitted: string[] = []
  const directories = ['']
  while (directories.length) {
    const parent = directories.pop()!
    for (const item of await fs.readdir(join(root, parent), { withFileTypes: true })) {
      const path = parent ? `${parent}/${item.name}` : item.name
      if ((!artifacts && excluded(path, item.isDirectory())) || (artifacts && [outputMarker, 'prepare-manifest.json', 'build-manifest.json', 'build-logs', '.build-config'].includes(path))) {
        omitted.push(path)
        continue
      }
      const fullPath = join(root, path)
      const info = await fs.lstat(fullPath)
      if (info.isDirectory()) {
        directories.push(path)
      }
      else if (info.isSymbolicLink()) {
        const target = await fs.readlink(fullPath)
        const lexical = resolve(dirname(fullPath), target)
        check(within(root, lexical), 'LINK_ESCAPES_SOURCE')
        const resolved = await canonicalPath(lexical)
        check(within(root, resolved), 'LINK_ESCAPES_SOURCE')
        check(!relative(root, resolved).split(sep).some(part => part.startsWith('.env') || ['.git', 'userData', 'profiles', 'IndexedDB'].includes(part))
          && !excluded(relative(root, resolved), false), 'LINK_TARGET_EXCLUDED')
        entries.push({ path, type: 'symlink', kind: entryKind(path), mode: info.mode & 0o777, target, targetPath: relative(root, lexical) })
      }
      else {
        check(info.isFile(), 'UNSUPPORTED_SOURCE_ENTRY')
        entries.push({ path, type: 'file', kind: entryKind(path), mode: info.mode & 0o777, bytes: info.size })
      }
    }
  }
  await concurrent(entries.filter(entry => entry.type === 'file'), async (entry) => {
    entry.sha256 = await hashFile(join(root, entry.path))
  })
  entries.sort((left, right) => left.path.localeCompare(right.path))
  return { sha256: digest(JSON.stringify(entries)), entries, excluded: omitted.sort() }
}

async function verifyClone({ source, destination, expectedSha256 }: ClonePair) {
  check((await fs.lstat(destination)).isFile(), 'CLONED_FILE_MUST_BE_REGULAR')
  const [original, cloned] = await Promise.all([fs.stat(source), fs.stat(destination)])
  check(original.dev !== cloned.dev || original.ino !== cloned.ino, 'SHARED_SOURCE_INODE')
  await fs.chmod(destination, original.mode & 0o777)
  if (expectedSha256)
    check(await hashFile(destination) === expectedSha256, 'SOURCE_CHANGED_DURING_CLONE')
}

async function nativeCloneFiles(pairs: ClonePair[]) {
  check(process.platform === 'darwin', 'MACOS_COW_REQUIRED')
  await new Promise<void>((accept, reject) => {
    const child = execFile('/usr/bin/python3', ['-I', '-S', '-c', nativeCloneProgram], {
      encoding: 'utf8',
      timeout: 10 * 60_000,
      maxBuffer: 64 * 1024,
      env: { PATH: '/usr/bin:/bin' },
    }, (error, stdout) => {
      if (error) {
        reject(new BuildPreparationError('NATIVE_CLONEFILE_FAILED_NO_COPY_FALLBACK'))
        return
      }
      try {
        const result: unknown = JSON.parse(stdout)
        check(result && typeof result === 'object' && 'cloned' in result && result.cloned === pairs.length, 'NATIVE_CLONEFILE_RECEIPT_MISMATCH')
        accept()
      }
      catch {
        reject(new BuildPreparationError('NATIVE_CLONEFILE_RECEIPT_MISMATCH'))
      }
    })
    child.stdin?.on('error', () => {
      // The exit callback owns failures when a native batch stops before its input drains.
    })
    child.stdin?.end(JSON.stringify(pairs.map(pair => [pair.source, pair.destination])))
  })
}

async function cloneFiles(pairs: ClonePair[], backend: CloneBackend) {
  await concurrent(pairs, async (pair) => {
    check((await fs.lstat(pair.source)).isFile(), 'CLONE_SOURCE_MUST_BE_REGULAR')
    check(await missing(pair.destination), 'CLONE_DESTINATION_EXISTS')
    await fs.mkdir(dirname(pair.destination), { recursive: true })
  })
  if (backend === 'darwin-clonefile') {
    await nativeCloneFiles(pairs)
  }
  else {
    await concurrent(pairs, async (pair) => {
      try {
        await fs.copyFile(pair.source, pair.destination, constants.COPYFILE_FICLONE_FORCE | constants.COPYFILE_EXCL)
      }
      catch {
        throw new BuildPreparationError('COW_CLONE_FAILED_NO_COPY_FALLBACK')
      }
    })
  }
  await concurrent(pairs, verifyClone)
}

async function probeClone(source: string, parent: string): Promise<AcceptanceBuildManifest['cloning']> {
  const probeDirectory = await fs.mkdtemp(join(parent, '.aimy-cow-check-'))
  const sourceHash = await hashFile(source)
  let destination = join(probeDirectory, 'node-clone.ts')
  const cloning: AcceptanceBuildManifest['cloning'] = { backend: 'node-ficlone-force' }
  try {
    try {
      await fs.copyFile(source, destination, constants.COPYFILE_FICLONE_FORCE | constants.COPYFILE_EXCL)
    }
    catch (error) {
      check(error instanceof Error && 'code' in error && error.code === 'ENOSYS', 'COW_CLONE_FAILED_NO_COPY_FALLBACK')
      destination = join(probeDirectory, 'native-clone.ts')
      await nativeCloneFiles([{ source, destination }])
      cloning.backend = 'darwin-clonefile'
      cloning.nodeForceFailure = 'ENOSYS'
      cloning.nativeProgramSha256 = digest(nativeCloneProgram)
    }
    await verifyClone({ source, destination, expectedSha256: sourceHash })
    await fs.appendFile(destination, '\n// synthetic COW isolation probe\n')
    check(await hashFile(source) === sourceHash && await hashFile(destination) !== sourceHash, 'COW_ISOLATION_FAILED')
    return cloning
  }
  finally {
    await fs.rm(probeDirectory, { recursive: true, force: true })
  }
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  const info = await fs.lstat(path)
  check(info.isFile() && !info.isSymbolicLink() && info.size <= 512 * 1024 * 1024, 'INVALID_METADATA')
  const value: unknown = JSON.parse(await fs.readFile(path, 'utf8'))
  check(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_METADATA')
  return value as Record<string, unknown>
}

async function fixedBuildPlan(root: string, outputRoot: string) {
  const specifications = [
    { path: 'packages/core-agent/package.json', name: '@proj-airi/core-agent', script: 'tsdown', tool: 'tsdown', toolMetadata: 'node_modules/tsdown/package.json' },
    { path: 'packages/i18n/package.json', name: '@proj-airi/i18n', script: 'tsdown', tool: 'tsdown', toolMetadata: 'node_modules/tsdown/package.json' },
    { path: 'apps/stage-tamagotchi/package.json', name: '@proj-airi/stage-tamagotchi', script: 'electron-vite build', tool: 'electron-vite', toolMetadata: 'apps/stage-tamagotchi/node_modules/electron-vite/package.json' },
  ]
  const commands: AcceptanceBuildManifest['commands'] = []
  for (const specification of specifications) {
    const data = await readJson(join(root, specification.path))
    const scripts = data.scripts
    check(data.name === specification.name && scripts && typeof scripts === 'object'
      && 'build' in scripts && scripts.build === specification.script
      && !('prebuild' in scripts) && !('postbuild' in scripts), 'UNEXPECTED_BUILD_SCRIPT')
    const metadataPath = await fs.realpath(join(root, specification.toolMetadata))
    check(within(root, metadataPath), 'BUILD_TOOL_OUTSIDE_WORKSPACE')
    const metadata = await readJson(metadataPath)
    const bin = typeof metadata.bin === 'string'
      ? metadata.bin
      : metadata.bin && typeof metadata.bin === 'object' && specification.tool in metadata.bin
        ? Reflect.get(metadata.bin, specification.tool) as unknown
        : undefined
    check(metadata.name === specification.tool && typeof bin === 'string' && !isAbsolute(bin), 'INSTALLED_BUILD_TOOL_REQUIRED')
    const toolPath = await fs.realpath(resolve(dirname(metadataPath), bin))
    check(within(root, toolPath) && (await fs.lstat(toolPath)).isFile() && /\.(?:mjs|cjs|js)$/.test(toolPath), 'BUILD_TOOL_OUTSIDE_WORKSPACE')
    commands.push({
      package: specification.name,
      runner: 'direct-node-bin',
      cwd: dirname(join(root, specification.path)),
      toolPath,
      toolSha256: await hashFile(toolPath),
      args: [toolPath, ...(specification.tool === 'electron-vite' ? ['build', '--outDir', join(outputRoot, 'out')] : [])],
    })
  }
  return commands
}

async function jsonWrite(path: string, value: unknown) {
  await fs.writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
}

/**
 * Creates an independent COW workspace. This function never builds or starts an application.
 * Call stack: prepareAcceptanceBuild -> snapshot -> cloneFiles -> fixed clock adaptation -> manifest.
 */
export async function prepareAcceptanceBuild(input: PrepareAcceptanceBuildOptions): Promise<PreparedAcceptanceBuild> {
  check(process.platform === 'darwin', 'MACOS_COW_REQUIRED')
  const parsed = v.safeParse(optionSchema, input)
  check(parsed.success, 'INVALID_PREPARATION_OPTIONS')
  const options = parsed.output
  for (const path of [options.sourceRoot, options.workspaceRoot, options.outputRoot, options.clockShimPath, ...(options.rendererBootstrapPath ? [options.rendererBootstrapPath] : [])])
    check(isAbsolute(path) && !/[\0\r\n]/.test(path), 'ABSOLUTE_PATH_REQUIRED')
  const sourceRoot = await fs.realpath(options.sourceRoot)
  check((await fs.lstat(options.sourceRoot)).isDirectory(), 'SOURCE_DIRECTORY_REQUIRED')
  const workspaceRoot = await canonicalPath(options.workspaceRoot)
  const outputRoot = await canonicalPath(options.outputRoot)
  const roots = [sourceRoot, workspaceRoot, outputRoot]
  for (let index = 0; index < roots.length; index++) {
    for (let other = index + 1; other < roots.length; other++)
      check(!within(roots[index], roots[other]) && !within(roots[other], roots[index]), 'OVERLAPPING_BUILD_PATHS')
  }
  check(await missing(workspaceRoot) && await missing(outputRoot), 'TARGET_MUST_BE_NEW')
  check(!within(join(homedir(), 'Library', 'Application Support'), sourceRoot), 'USER_DATA_SOURCE_FORBIDDEN')
  const sourcePackage = await readJson(join(sourceRoot, 'package.json'))
  check(sourcePackage.name === '@proj-airi/root', 'AIRI_WORKSPACE_REQUIRED')
  check((await fs.lstat(join(sourceRoot, 'node_modules'))).isDirectory(), 'INSTALLED_DEPENDENCIES_REQUIRED')
  const shimInfo = await fs.lstat(options.clockShimPath)
  check(shimInfo.isFile() && !shimInfo.isSymbolicLink() && shimInfo.size > 0 && shimInfo.size <= 128 * 1024
    && options.clockShimPath.endsWith('.ts') && !excluded(basename(options.clockShimPath), false), 'INVALID_CLOCK_SHIM')
  const shim = await fs.readFile(options.clockShimPath, 'utf8')
  check(/export\s+(?:function\s+conversationNow\b|const\s+conversationNow\s*=)/.test(shim), 'CLOCK_EXPORT_REQUIRED')
  let rendererBootstrap: { text: string, evidence: NonNullable<AcceptanceBuildManifest['rendererBootstrap']> } | undefined
  if (options.rendererBootstrapPath) {
    const info = await fs.lstat(options.rendererBootstrapPath)
    check(info.isFile() && !info.isSymbolicLink() && info.size > 0 && info.size <= 512 * 1024
      && options.rendererBootstrapPath.endsWith('.ts') && !excluded(basename(options.rendererBootstrapPath), false), 'INVALID_RENDERER_BOOTSTRAP')
    const inputPath = await fs.realpath(options.rendererBootstrapPath)
    let taskDirectory = dirname(workspaceRoot)
    while (!within(taskDirectory, outputRoot) || !within(taskDirectory, inputPath)) {
      const parent = dirname(taskDirectory)
      check(parent !== taskDirectory, 'BOOTSTRAP_NOT_TASK_OWNED')
      taskDirectory = parent
    }
    const temporaryRoots = await Promise.all(['/tmp', tmpdir()].map(path => fs.realpath(path)))
    check(temporaryRoots.some(root => taskDirectory !== root && within(root, taskDirectory))
      && !within(sourceRoot, inputPath), 'BOOTSTRAP_NOT_TASK_OWNED')
    check(await missing(join(sourceRoot, bootstrapTargetPath)), 'RENDERER_BOOTSTRAP_ALREADY_PRESENT')
    const mainPath = join(sourceRoot, rendererMainPath)
    check((await fs.lstat(mainPath)).isFile() && await fs.realpath(mainPath) === mainPath, 'RENDERER_MAIN_MUST_BE_REGULAR')
    const originalMain = await fs.readFile(mainPath, 'utf8')
    check(!originalMain.includes('./acceptance.bootstrap'), 'RENDERER_BOOTSTRAP_IMPORT_EXISTS')
    const text = await fs.readFile(inputPath, 'utf8')
    rendererBootstrap = {
      text,
      evidence: {
        inputPath,
        inputSha256: digest(text),
        targetPath: bootstrapTargetPath,
        mainPath: rendererMainPath,
        originalMain,
        originalMainSha256: digest(originalMain),
        adaptedMainSha256: digest(`${bootstrapImport}\n${originalMain}`),
        importLine: bootstrapImport,
        provenance: 'caller-generated-single-file-driver',
      },
    }
  }
  await fixedBuildPlan(sourceRoot, outputRoot)
  // Reject unsupported COW before hashing or cloning the installed dependency tree.
  const cloning = await probeClone(options.clockShimPath, dirname(workspaceRoot))
  const source = await snapshot(sourceRoot)
  for (const path of requiredOfflineFiles)
    check(source.entries.some(entry => entry.path === path && entry.type === 'file'), 'OFFLINE_ASSETS_MISSING')
  const originalChat = await fs.readFile(join(sourceRoot, chatPath), 'utf8')
  check(originalChat.split(factory).length === 2, 'CHAT_FACTORY_NOT_UNIQUE')
  if (options.arm === 'airi')
    check(!originalChat.includes('conversationNow') && !originalChat.includes('../services/conversation-clock'), 'BASELINE_ALREADY_ADAPTED')
  else
    check(originalChat.includes(clockImport) && originalChat.includes('now: conversationNow,'), 'AIMY_CLOCK_SEAM_REQUIRED')
  const preparationId = randomUUID()
  await fs.mkdir(workspaceRoot, { recursive: false, mode: 0o700 })
  await fs.mkdir(outputRoot, { recursive: false, mode: 0o700 })
  const ownership = { schemaVersion: 1, purpose: 'aimy-controlled-acceptance-build', preparationId, sourceRoot, workspaceRoot, outputRoot }
  await jsonWrite(join(workspaceRoot, workspaceMarker), ownership)
  await jsonWrite(join(outputRoot, outputMarker), ownership)
  await cloneFiles(source.entries.filter(entry => entry.type === 'file').map(entry => ({ source: join(sourceRoot, entry.path), destination: join(workspaceRoot, entry.path), expectedSha256: entry.sha256 })), cloning.backend)
  await concurrent(source.entries.filter(entry => entry.type === 'symlink'), async (entry) => {
    const destination = join(workspaceRoot, entry.path)
    await fs.mkdir(dirname(destination), { recursive: true })
    await fs.symlink(isAbsolute(entry.target!) ? join(workspaceRoot, entry.targetPath!) : entry.target!, destination)
  })
  const changes: AcceptanceBuildManifest['adapter']['changes'] = []
  for (const entry of source.entries.filter(item => item.type === 'file' && installedPathMetadata.test(item.path))) {
    const target = join(workspaceRoot, entry.path)
    const text = await fs.readFile(target, 'utf8')
    let relocated = text
    for (const prefix of [...new Set([sourceRoot, options.sourceRoot])].sort((a, b) => b.length - a.length))
      relocated = relocated.split(`${prefix}/`).join(`${workspaceRoot}/`)
    if (relocated !== text) {
      await fs.writeFile(target, relocated)
      changes.push({ path: entry.path, before: entry.sha256!, after: digest(relocated), reason: 'installed-wrapper-path-relocation' })
    }
  }
  if (options.arm === 'airi') {
    const adapted = `${clockImport}\n${originalChat.replace(factory, `${factory}\n    now: conversationNow,`)}`
    await fs.writeFile(join(workspaceRoot, chatPath), adapted)
    changes.push({ path: chatPath, before: digest(originalChat), after: digest(adapted), reason: 'baseline-conversation-clock-only' })
  }
  const previousClock = source.entries.find(entry => entry.path === clockPath)
  check(!previousClock || previousClock.type === 'file', 'CLOCK_SERVICE_MUST_BE_REGULAR')
  await fs.mkdir(dirname(join(workspaceRoot, clockPath)), { recursive: true })
  await fs.writeFile(join(workspaceRoot, clockPath), shim)
  changes.push({ path: clockPath, before: previousClock?.sha256 ?? null, after: digest(shim), reason: 'shared-scenario-clock-shim' })
  if (rendererBootstrap) {
    const { text, evidence } = rendererBootstrap
    await fs.writeFile(join(workspaceRoot, bootstrapTargetPath), text, { flag: 'wx' })
    await fs.writeFile(join(workspaceRoot, rendererMainPath), `${bootstrapImport}\n${evidence.originalMain}`)
    changes.push({ path: bootstrapTargetPath, before: null, after: evidence.inputSha256, reason: 'shared-renderer-module-driver' })
    changes.push({ path: rendererMainPath, before: evidence.originalMainSha256, after: evidence.adaptedMainSha256, reason: 'single-renderer-bootstrap-import' })
  }
  check((await snapshot(sourceRoot)).sha256 === source.sha256, 'SOURCE_CHANGED_DURING_PREPARATION')
  const prepared = await snapshot(workspaceRoot)
  const manifest: AcceptanceBuildManifest = {
    schemaVersion: 1,
    preparationId,
    arm: options.arm,
    status: 'prepared',
    cloning,
    lineage: { repositoryImportCommit: importCommit, upstreamCommit: null },
    paths: { sourceRoot, workspaceRoot, outputRoot },
    source,
    prepared,
    adapter: { inputSha256: digest(shim), servicePath: clockPath, changes },
    ...(rendererBootstrap ? { rendererBootstrap: rendererBootstrap.evidence } : {}),
    offlineAssets: source.entries.filter(entry => entry.kind === 'offline-asset').map(entry => entry.path),
    commands: await fixedBuildPlan(workspaceRoot, outputRoot),
    createdAt: new Date().toISOString(),
  }
  const manifestPath = join(outputRoot, 'prepare-manifest.json')
  await jsonWrite(manifestPath, manifest)
  return { schemaVersion: 1, preparationId, sourceRoot, workspaceRoot, outputRoot, arm: options.arm, manifestPath, manifestSha256: await hashFile(manifestPath) }
}

async function killOwned(child: ChildProcess) {
  if (child.pid && child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(-child.pid, 'SIGKILL')
    }
    catch {
      child.kill('SIGKILL')
    }
  }
}

async function buildCommand(command: AcceptanceBuildManifest['commands'][number], manifest: AcceptanceBuildManifest) {
  const sourceRoot = manifest.paths.sourceRoot
  const outputRoot = manifest.paths.outputRoot
  const logPath = join(outputRoot, 'build-logs', `${command.package.split('/').at(-1)}.log`)
  command.logPath = logPath
  const log = createWriteStream(logPath, { flags: 'wx', mode: 0o600 })
  const environment: NodeJS.ProcessEnv = {}
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL']) {
    if (process.env[key])
      environment[key] = process.env[key]
  }
  Object.assign(environment, {
    PATH: `${dirname(process.execPath)}:${environment.PATH ?? '/usr/bin:/bin:/usr/sbin'}`,
    CI: 'true',
    npm_config_offline: 'true',
    npm_config_update_notifier: 'false',
    npm_config_manage_package_manager_versions: 'false',
    npm_config_userconfig: join(outputRoot, '.build-config', 'empty.npmrc'),
    npm_config_globalconfig: join(outputRoot, '.build-config', 'empty.npmrc'),
  })
  const policy = `(version 1)(allow default)(deny network*)(deny file-write* (subpath ${JSON.stringify(sourceRoot)}))`
  // pnpm 11 run/exec defaults to verifyDepsBeforeRun=install. Direct installed bins never enter that package-manager path.
  const child = spawn('/usr/bin/sandbox-exec', ['-p', policy, process.execPath, ...command.args], { cwd: command.cwd, env: environment, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    void killOwned(child)
  }, 15 * 60_000)
  child.stdout?.pipe(log, { end: false })
  child.stderr?.pipe(log, { end: false })
  try {
    const result = await new Promise<{ code: number | null, signal: string | null }>((accept, reject) => {
      child.once('error', () => reject(new BuildPreparationError('BUILD_SPAWN_FAILED')))
      child.once('close', (code, signal) => accept({ code, signal }))
      log.once('error', () => {
        void killOwned(child)
        reject(new BuildPreparationError('BUILD_LOG_FAILED'))
      })
    })
    command.exitCode = result.code
    command.signal = result.signal
    check(!timedOut && result.code === 0 && !result.signal, timedOut ? 'BUILD_TIMEOUT' : 'OFFLINE_BUILD_FAILED')
  }
  finally {
    clearTimeout(timeout)
    await new Promise<void>(accept => log.end(accept))
    command.logSha256 = await hashFile(logPath)
  }
}

/**
 * Runs three fixed builds only after the caller explicitly invokes this function.
 * Call stack: buildAcceptanceBuild -> verify preparation -> installed Node build bins -> fingerprint output.
 */
export async function buildAcceptanceBuild(prepared: PreparedAcceptanceBuild, options: { pnpmPath: string }): Promise<AcceptanceBuildManifest> {
  check(process.platform === 'darwin' && isAbsolute(options.pnpmPath), 'MACOS_INSTALLED_PNPM_REQUIRED')
  check(prepared.manifestPath === join(prepared.outputRoot, 'prepare-manifest.json') && await hashFile(prepared.manifestPath) === prepared.manifestSha256, 'PREPARATION_MANIFEST_CHANGED')
  const manifest = v.parse(manifestSchema, await readJson(prepared.manifestPath))
  check(manifest.schemaVersion === 1 && manifest.status === 'prepared' && manifest.preparationId === prepared.preparationId
    && manifest.paths.sourceRoot === prepared.sourceRoot && manifest.paths.workspaceRoot === prepared.workspaceRoot
    && manifest.paths.outputRoot === prepared.outputRoot && manifest.arm === prepared.arm, 'PREPARATION_IDENTITY_MISMATCH')
  for (const [root, name] of [[prepared.workspaceRoot, workspaceMarker], [prepared.outputRoot, outputMarker]]) {
    const ownership = await readJson(join(root, name))
    check(ownership.preparationId === prepared.preparationId && ownership.workspaceRoot === prepared.workspaceRoot
      && ownership.outputRoot === prepared.outputRoot && ownership.sourceRoot === prepared.sourceRoot, 'BUILD_OWNERSHIP_MISMATCH')
  }
  check((await snapshot(prepared.sourceRoot)).sha256 === manifest.source.sha256, 'ORIGINAL_SOURCE_CHANGED')
  check((await snapshot(prepared.workspaceRoot)).sha256 === manifest.prepared.sha256, 'PREPARED_WORKSPACE_CHANGED')
  const plan = await fixedBuildPlan(prepared.workspaceRoot, prepared.outputRoot)
  check(JSON.stringify(plan) === JSON.stringify(manifest.commands), 'BUILD_COMMANDS_CHANGED')
  const pnpm = await fs.realpath(options.pnpmPath)
  const pnpmPackage = await readJson(resolve(dirname(pnpm), '../package.json'))
  const rootPackage = await readJson(join(prepared.workspaceRoot, 'package.json'))
  check(pnpmPackage.name === 'pnpm' && rootPackage.packageManager === `pnpm@${pnpmPackage.version}`
    && basename(pnpm) === 'pnpm.mjs', 'UNEXPECTED_PNPM_EXECUTABLE')
  await fs.access('/usr/bin/sandbox-exec', constants.X_OK)
  await fs.access(pnpm, constants.X_OK)
  manifest.toolchain = { node: process.execPath, nodeSha256: await hashFile(process.execPath), pnpm, pnpmVersion: String(pnpmPackage.version), pnpmSha256: await hashFile(pnpm), packageManagerExecuted: false }
  await fs.mkdir(join(prepared.outputRoot, 'build-logs'))
  await fs.mkdir(join(prepared.outputRoot, '.build-config'))
  await fs.writeFile(join(prepared.outputRoot, '.build-config', 'empty.npmrc'), '', { flag: 'wx', mode: 0o600 })
  try {
    for (const command of manifest.commands)
      await buildCommand(command, manifest)
    check((await snapshot(prepared.sourceRoot)).sha256 === manifest.source.sha256, 'ORIGINAL_SOURCE_CHANGED_DURING_BUILD')
    const resources = await snapshot(join(prepared.workspaceRoot, 'apps/stage-tamagotchi/resources'))
    const copies: ClonePair[] = [{ source: join(prepared.workspaceRoot, 'apps/stage-tamagotchi/package.json'), destination: join(prepared.outputRoot, 'package.json') }]
    for (const entry of resources.entries) {
      check(entry.type === 'file', 'UNEXPECTED_RESOURCE_LINK')
      copies.push({ source: join(prepared.workspaceRoot, 'apps/stage-tamagotchi/resources', entry.path), destination: join(prepared.outputRoot, 'resources', entry.path), expectedSha256: entry.sha256 })
    }
    await cloneFiles(copies, manifest.cloning.backend)
    manifest.artifacts = await snapshot(prepared.outputRoot, true)
    const runtimeDependencies = join(prepared.workspaceRoot, 'apps/stage-tamagotchi/node_modules')
    const dependencyLink = relative(prepared.outputRoot, runtimeDependencies)
    await fs.symlink(dependencyLink, join(prepared.outputRoot, 'node_modules'))
    manifest.artifacts.entries.push({ path: 'node_modules', type: 'symlink', kind: 'dependency', mode: 0o777, target: dependencyLink, targetPath: runtimeDependencies })
    manifest.artifacts.entries.sort((left, right) => left.path.localeCompare(right.path))
    manifest.artifacts.sha256 = digest(JSON.stringify(manifest.artifacts.entries))
    manifest.workspaceAfterBuild = await snapshot(prepared.workspaceRoot)
    manifest.entry = join(prepared.outputRoot, 'out/main/index.js')
    check(manifest.artifacts.entries.some(entry => entry.path === 'out/main/index.js'), 'DESKTOP_ENTRY_MISSING')
    manifest.status = 'built'
  }
  catch (error) {
    manifest.status = 'failed'
    manifest.failure = error instanceof BuildPreparationError ? error.code : 'BUILD_FAILED'
    throw error
  }
  finally {
    manifest.builtAt = new Date().toISOString()
    await jsonWrite(join(prepared.outputRoot, 'build-manifest.json'), manifest)
  }
  return manifest
}
