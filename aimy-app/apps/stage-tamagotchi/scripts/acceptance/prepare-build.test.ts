import type { PrepareAcceptanceBuildOptions } from './prepare-build'

import process from 'node:process'

import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'

import * as fs from 'node:fs/promises'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildAcceptanceBuild, prepareAcceptanceBuild } from './prepare-build'

// The filesystem boundary simulates successful clonefile support with tiny synthetic fixture files.
// A separate native test keeps unsupported host behavior visible. Product code has no ordinary-copy fallback.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const { constants: copyFlags } = await import('node:fs')
  return { ...actual, copyFile: vi.fn<typeof actual.copyFile>(async (source, destination, flags) => {
    if (flags !== (copyFlags.COPYFILE_FICLONE_FORCE | copyFlags.COPYFILE_EXCL))
      throw new Error('The product stopped requesting exclusive forced COW')
    await actual.copyFile(source, destination, copyFlags.COPYFILE_EXCL)
  }) }
})

let directory: string
let options: PrepareAcceptanceBuildOptions
const clockPath = 'packages/stage-ui/src/services/conversation-clock.ts'
const chatPath = 'packages/stage-ui/src/stores/chat.ts'
const mainPath = 'apps/stage-tamagotchi/src/renderer/main.ts'
const bootstrapPath = 'apps/stage-tamagotchi/src/renderer/acceptance.bootstrap.ts'
const originalMain = 'import { createApp } from \'vue\'\nvoid createApp\n'
const originalChat = 'import { createChatOrchestratorRuntime } from \'@proj-airi/core-agent\'\nconst runtime = createChatOrchestratorRuntime({\n  session: {},\n})\n'
const shim = 'export function conversationNow(): number { return 1792065600000 }\nexport function conversationClock() { return { now: conversationNow(), timeZone: \'Asia/Shanghai\' } }\n'

async function fixtureFile(path: string, text = 'synthetic offline asset') {
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.writeFile(path, text)
}

async function fixture() {
  directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'aimy-prepare-build-test-')))
  options = { sourceRoot: join(directory, 'source'), workspaceRoot: join(directory, 'workspace'), outputRoot: join(directory, 'output'), clockShimPath: join(directory, 'clock.ts'), arm: 'airi' }
  await fixtureFile(options.clockShimPath, shim)
  const packages = [
    ['package.json', { name: '@proj-airi/root', packageManager: 'pnpm@11.24.0' }],
    ['packages/core-agent/package.json', { name: '@proj-airi/core-agent', exports: { '.': './dist/index.mjs' }, scripts: { build: 'tsdown' } }],
    ['packages/i18n/package.json', { name: '@proj-airi/i18n', exports: { './locales': './dist/locales/index.mjs' }, scripts: { build: 'tsdown' } }],
    ['apps/stage-tamagotchi/package.json', { name: '@proj-airi/stage-tamagotchi', main: './out/main/index.js', scripts: { build: 'electron-vite build' } }],
  ] as const
  for (const [path, value] of packages)
    await fixtureFile(join(options.sourceRoot, path), JSON.stringify(value))
  await fixtureFile(join(options.sourceRoot, chatPath), originalChat)
  await fixtureFile(join(options.sourceRoot, mainPath), originalMain)
  await fixtureFile(join(options.sourceRoot, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
  await fixtureFile(join(options.sourceRoot, 'node_modules/.bin/tsdown'), `#!/bin/sh\nNODE_PATH="${options.sourceRoot}/node_modules"\n`)
  await fs.chmod(join(options.sourceRoot, 'node_modules/.bin/tsdown'), 0o755)
  await fixtureFile(join(options.sourceRoot, 'node_modules/.pnpm/dependency/node_modules/dependency/out/index.js'), 'export const compiled = true\n')
  await fixtureFile(join(options.sourceRoot, 'packages/core-agent/dist/index.mjs'), 'export const compiled = true\n')
  await fixtureFile(join(options.sourceRoot, 'node_modules/tsdown/package.json'), JSON.stringify({ name: 'tsdown', bin: './bin.mjs' }))
  await fixtureFile(join(options.sourceRoot, 'node_modules/tsdown/bin.mjs'), 'console.log("fixture build")\n')
  await fs.mkdir(join(options.sourceRoot, 'node_modules/@proj-airi'))
  await fs.mkdir(join(options.sourceRoot, 'apps/stage-tamagotchi/node_modules'))
  await fixtureFile(join(options.sourceRoot, 'apps/stage-tamagotchi/node_modules/electron-vite/package.json'), JSON.stringify({ name: 'electron-vite', bin: { 'electron-vite': './bin.mjs' } }))
  await fixtureFile(join(options.sourceRoot, 'apps/stage-tamagotchi/node_modules/electron-vite/bin.mjs'), 'console.log("fixture desktop build")\n')
  await fs.symlink('../../packages/core-agent', join(options.sourceRoot, 'node_modules/@proj-airi/core-agent'))
  await fs.symlink(join(options.sourceRoot, 'packages/i18n'), join(options.sourceRoot, 'node_modules/absolute-i18n'))
  for (const path of [
    '.cache/live2d/models/hiyori_free_zh.zip',
    '.cache/live2d/models/hiyori_pro_zh.zip',
    '.cache/vrm/models/AvatarSample-A/AvatarSample_A.vrm',
    '.cache/vrm/models/AvatarSample-B/AvatarSample_B.vrm',
    'apps/stage-tamagotchi/src/renderer/.cache/assets/js/CubismSdkForWeb-5-r.3/Core/live2dcubismcore.min.js',
    'apps/stage-tamagotchi/src/renderer/.cache/assets/js/CubismSdkForWeb-5-r.3/Framework/src/live2dcubismframework.ts',
  ]) {
    await fixtureFile(join(options.sourceRoot, path))
  }
}

beforeEach(fixture)
afterEach(async () => {
  vi.clearAllMocks()
  await fs.rm(directory, { recursive: true, force: true })
})

describe.skipIf(process.platform !== 'darwin')('controlled acceptance build preparation', () => {
  it('creates independent files through the COW boundary, relocates links and adapts only the baseline clock', async () => {
    const prepared = await prepareAcceptanceBuild(options)
    const original = await fs.stat(join(options.sourceRoot, chatPath))
    const cloned = await fs.stat(join(prepared.workspaceRoot, chatPath))
    expect(cloned.ino).not.toBe(original.ino)
    expect(await fs.readFile(join(options.sourceRoot, chatPath), 'utf8')).toBe(originalChat)
    expect(await fs.readFile(join(prepared.workspaceRoot, chatPath), 'utf8')).toBe(`import { conversationNow } from '../services/conversation-clock'\n${originalChat.replace('createChatOrchestratorRuntime({', 'createChatOrchestratorRuntime({\n    now: conversationNow,')}`)
    expect(await fs.readFile(join(prepared.workspaceRoot, clockPath), 'utf8')).toBe(shim)
    expect(await fs.readlink(join(prepared.workspaceRoot, 'node_modules/@proj-airi/core-agent'))).toBe('../../packages/core-agent')
    expect(await fs.readlink(join(prepared.workspaceRoot, 'node_modules/absolute-i18n'))).toBe(join(prepared.workspaceRoot, 'packages/i18n'))
    expect(await fs.readFile(join(prepared.workspaceRoot, 'node_modules/.bin/tsdown'), 'utf8')).toContain(`${prepared.workspaceRoot}/node_modules`)
    expect((await fs.stat(join(prepared.workspaceRoot, 'node_modules/.bin/tsdown'))).mode & 0o777).toBe(0o755)
    await fs.writeFile(join(prepared.workspaceRoot, 'packages/core-agent/dist/index.mjs'), 'changed clone')
    expect(await fs.readFile(join(options.sourceRoot, 'packages/core-agent/dist/index.mjs'), 'utf8')).toBe('export const compiled = true\n')
    const manifest = JSON.parse(await fs.readFile(prepared.manifestPath, 'utf8'))
    expect(manifest.lineage.upstreamCommit).toBeNull()
    expect(manifest.lineage.repositoryImportCommit).toBe('bf4190376ebfc1df932c61f2b2f832387505e70d')
    expect(manifest.status).toBe('prepared')
    expect(manifest.commands.map((command: { package: string }) => command.package)).toEqual(['@proj-airi/core-agent', '@proj-airi/i18n', '@proj-airi/stage-tamagotchi'])
    expect(manifest.commands[2].args).toEqual([join(prepared.workspaceRoot, 'apps/stage-tamagotchi/node_modules/electron-vite/bin.mjs'), 'build', '--outDir', join(prepared.outputRoot, 'out')])
    expect(manifest.commands.every((command: { runner: string }) => command.runner === 'direct-node-bin')).toBe(true)
    expect(manifest.source.entries).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'packages/core-agent/dist/index.mjs', kind: 'workspace-dist' })]))
    expect(await fs.readFile(join(prepared.workspaceRoot, 'node_modules/.pnpm/dependency/node_modules/dependency/out/index.js'), 'utf8')).toContain('compiled')
    await expect(fs.stat(join(prepared.outputRoot, 'out'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('omits credentials, run data and unapproved caches while retaining named offline assets', async () => {
    const omitted = ['.git/config', '.env', '.env.local', '.npmrc', 'profiles/test/data.json', 'logs/runtime.log', 'apps/stage-tamagotchi/out/main/index.js', '.cache/unapproved/session.json', 'provider-secrets.json']
    for (const path of omitted)
      await fixtureFile(join(options.sourceRoot, path), 'synthetic private canary')
    const prepared = await prepareAcceptanceBuild(options)
    for (const path of omitted)
      await expect(fs.lstat(join(prepared.workspaceRoot, path))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readFile(join(prepared.workspaceRoot, '.cache/live2d/models/hiyori_free_zh.zip'), 'utf8')).toBe('synthetic offline asset')
    expect(await fs.readFile(prepared.manifestPath, 'utf8')).not.toContain('synthetic private canary')
  })

  it('requires new separate destinations and rejects relative paths or unknown options', async () => {
    await expect(prepareAcceptanceBuild({ ...options, outputRoot: options.sourceRoot })).rejects.toThrow('OVERLAPPING_BUILD_PATHS')
    await expect(prepareAcceptanceBuild({ ...options, outputRoot: join(options.workspaceRoot, 'out') })).rejects.toThrow('OVERLAPPING_BUILD_PATHS')
    await expect(prepareAcceptanceBuild({ ...options, outputRoot: './out' })).rejects.toThrow('ABSOLUTE_PATH_REQUIRED')
    const unknown = { ...options, arbitraryPatch: { path: 'package.json', text: 'changed' } }
    await expect(prepareAcceptanceBuild(unknown)).rejects.toThrow('INVALID_PREPARATION_OPTIONS')
    await fs.mkdir(options.outputRoot)
    await expect(prepareAcceptanceBuild(options)).rejects.toThrow('TARGET_MUST_BE_NEW')
  })

  it('rejects destinations hidden inside the source through a directory alias', async () => {
    const alias = join(directory, 'alias')
    await fs.symlink(options.sourceRoot, alias)
    await expect(prepareAcceptanceBuild({ ...options, workspaceRoot: join(alias, 'workspace') })).rejects.toThrow('OVERLAPPING_BUILD_PATHS')
  })

  it.each(['relative', 'absolute'])('rejects a %s dependency link into another workspace', async (kind) => {
    const other = join(directory, 'other-product')
    await fixtureFile(join(other, 'package.json'), '{}')
    const link = join(options.sourceRoot, 'node_modules/escaped')
    await fs.symlink(kind === 'absolute' ? other : relative(dirname(link), other), link)
    await expect(prepareAcceptanceBuild(options)).rejects.toThrow('LINK_ESCAPES_SOURCE')
    await expect(fs.lstat(options.workspaceRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a link that reaches excluded profile data', async () => {
    await fixtureFile(join(options.sourceRoot, 'profiles/synthetic/state.json'))
    await fs.symlink('../profiles/synthetic', join(options.sourceRoot, 'node_modules/profile'))
    await expect(prepareAcceptanceBuild(options)).rejects.toThrow('LINK_TARGET_EXCLUDED')
  })

  it('rejects missing offline assets without building or fetching them', async () => {
    await fs.unlink(join(options.sourceRoot, '.cache/live2d/models/hiyori_free_zh.zip'))
    await expect(prepareAcceptanceBuild(options)).rejects.toThrow('OFFLINE_ASSETS_MISSING')
    await expect(fs.lstat(options.outputRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('requires an exact baseline factory and refuses an already adapted baseline', async () => {
    await fs.writeFile(join(options.sourceRoot, chatPath), `${originalChat}\n${originalChat}`)
    await expect(prepareAcceptanceBuild(options)).rejects.toThrow('CHAT_FACTORY_NOT_UNIQUE')
    await fs.writeFile(join(options.sourceRoot, chatPath), `import { conversationNow } from '../services/conversation-clock'\n${originalChat}`)
    await expect(prepareAcceptanceBuild(options)).rejects.toThrow('BASELINE_ALREADY_ADAPTED')
  })

  it('overrides only the existing Aimy clock service after its production seam is present', async () => {
    await expect(prepareAcceptanceBuild({ ...options, arm: 'aimy' })).rejects.toThrow('AIMY_CLOCK_SEAM_REQUIRED')
    const chat = `import { conversationNow } from '../services/conversation-clock'\n${originalChat.replace('createChatOrchestratorRuntime({', 'createChatOrchestratorRuntime({\n    now: conversationNow,')}`
    await fs.writeFile(join(options.sourceRoot, chatPath), chat)
    await fixtureFile(join(options.sourceRoot, clockPath), 'export function conversationNow() { return Date.now() }\n')
    const prepared = await prepareAcceptanceBuild({ ...options, arm: 'aimy' })
    expect(await fs.readFile(join(prepared.workspaceRoot, chatPath), 'utf8')).toBe(chat)
    expect(await fs.readFile(join(prepared.workspaceRoot, clockPath), 'utf8')).toBe(shim)
  })

  it('fails closed when COW cloning fails and never retries with plain copying', async () => {
    const copy = vi.mocked(fs.copyFile).mockRejectedValueOnce(new Error('synthetic clone unsupported'))
    await expect(prepareAcceptanceBuild(options)).rejects.toThrow('COW_CLONE_FAILED_NO_COPY_FALLBACK')
    expect(copy).toHaveBeenCalled()
    expect(copy.mock.calls.every(([, , flags]) => flags === (constants.COPYFILE_FICLONE_FORCE | constants.COPYFILE_EXCL))).toBe(true)
    expect(await fs.readFile(join(options.sourceRoot, chatPath), 'utf8')).toBe(originalChat)
  })

  it('prepares a real small workspace with forced COW or direct native clonefile after ENOSYS', async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    const copy = vi.mocked(fs.copyFile)
    let nativeFailure: string | undefined
    copy.mockImplementation(async (...args) => {
      try {
        await actual.copyFile(...args)
      }
      catch (error) {
        nativeFailure = error instanceof Error && 'code' in error ? String(error.code) : 'UNKNOWN'
        throw error
      }
    })
    const prepared = await prepareAcceptanceBuild(options)
    const before = await actual.stat(join(options.sourceRoot, chatPath))
    const after = await actual.stat(join(prepared.workspaceRoot, chatPath))
    expect(after.ino).not.toBe(before.ino)
    await actual.appendFile(join(prepared.workspaceRoot, chatPath), '\n// isolated clone edit\n')
    expect(await actual.readFile(join(options.sourceRoot, chatPath), 'utf8')).toBe(originalChat)
    const manifest = JSON.parse(await actual.readFile(prepared.manifestPath, 'utf8'))
    expect(manifest.cloning.backend).toBe(nativeFailure === 'ENOSYS' ? 'darwin-clonefile' : 'node-ficlone-force')
    console.info(`Real small preparation passed: ${manifest.cloning.backend}`)
    expect(copy.mock.calls.every(([, , flags]) => flags === (constants.COPYFILE_FICLONE_FORCE | constants.COPYFILE_EXCL))).toBe(true)
    copy.mockImplementation(async (source, destination, flags) => {
      if (flags !== (constants.COPYFILE_FICLONE_FORCE | constants.COPYFILE_EXCL))
        throw new Error('The product stopped requesting exclusive forced COW')
      await actual.copyFile(source, destination, constants.COPYFILE_EXCL)
    })
  })

  it('stops when the native clonefile command fails without starting the workspace copy', async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(fs.copyFile).mockImplementationOnce(async (_source, destination) => {
      await actual.rm(dirname(String(destination)), { recursive: true, force: true })
      throw Object.assign(new Error('synthetic Node COW unavailable'), { code: 'ENOSYS' })
    })
    await expect(prepareAcceptanceBuild(options)).rejects.toThrow('NATIVE_CLONEFILE_FAILED_NO_COPY_FALLBACK')
    await expect(actual.lstat(options.workspaceRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await actual.readFile(join(options.sourceRoot, chatPath), 'utf8')).toBe(originalChat)
  })

  it('rejects changed source, clone and manifest before running any build', async () => {
    const prepared = await prepareAcceptanceBuild(options)
    await fs.writeFile(join(options.sourceRoot, chatPath), `${originalChat}\n// changed\n`)
    await expect(buildAcceptanceBuild(prepared, { pnpmPath: '/missing/pnpm' })).rejects.toThrow('ORIGINAL_SOURCE_CHANGED')
    await fs.writeFile(join(options.sourceRoot, chatPath), originalChat)
    await fs.writeFile(join(prepared.workspaceRoot, clockPath), `${shim}\n// changed\n`)
    await expect(buildAcceptanceBuild(prepared, { pnpmPath: '/missing/pnpm' })).rejects.toThrow('PREPARED_WORKSPACE_CHANGED')
    await fs.appendFile(prepared.manifestPath, '\n')
    await expect(buildAcceptanceBuild(prepared, { pnpmPath: '/missing/pnpm' })).rejects.toThrow('PREPARATION_MANIFEST_CHANGED')
    await expect(fs.lstat(join(prepared.outputRoot, 'build-logs'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('executes only installed build bins and never enters a package manager auto-install path', async () => {
    const sentinel = join(directory, 'package-manager-was-executed')
    const pnpmPath = join(directory, 'package-manager/bin/pnpm.mjs')
    await fixtureFile(join(directory, 'package-manager/package.json'), JSON.stringify({ name: 'pnpm', version: '11.24.0' }))
    await fixtureFile(pnpmPath, `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(sentinel)}, 'unexpected')\nprocess.exit(19)\n`)
    await fs.chmod(pnpmPath, 0o755)
    await fixtureFile(join(options.sourceRoot, 'apps/stage-tamagotchi/resources/icon.txt'), 'fixture icon')
    await fixtureFile(join(options.sourceRoot, 'apps/stage-tamagotchi/node_modules/electron-vite/bin.mjs'), `import { mkdirSync, writeFileSync } from 'node:fs'\nimport { join } from 'node:path'\nconst output = process.argv[process.argv.indexOf('--outDir') + 1]\nmkdirSync(join(output, 'main'), {recursive:true})\nwriteFileSync(join(output,'main/index.js'), 'export {}')\n`)
    const prepared = await prepareAcceptanceBuild(options)
    const result = await buildAcceptanceBuild(prepared, { pnpmPath })
    expect(result.status).toBe('built')
    expect(result.toolchain?.packageManagerExecuted).toBe(false)
    expect(result.commands.every(command => command.exitCode === 0)).toBe(true)
    await expect(fs.lstat(sentinel)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(['airi', 'aimy'] as const)('injects a single task-owned renderer bootstrap into the %s clone and records its source chain', async (arm) => {
    if (arm === 'aimy') {
      await fs.writeFile(join(options.sourceRoot, chatPath), `import { conversationNow } from '../services/conversation-clock'\n${originalChat.replace('createChatOrchestratorRuntime({', 'createChatOrchestratorRuntime({\n    now: conversationNow,')}`)
      await fixtureFile(join(options.sourceRoot, clockPath), 'export function conversationNow() { return Date.now() }\n')
    }
    const rendererBootstrapPath = join(directory, 'driver', `${arm}.bootstrap.ts`)
    const driver = 'import { createPinia } from \'pinia\'\nvoid createPinia\n'
    await fixtureFile(rendererBootstrapPath, driver)
    const prepared = await prepareAcceptanceBuild({ ...options, arm, rendererBootstrapPath })
    expect(await fs.readFile(join(prepared.workspaceRoot, bootstrapPath), 'utf8')).toBe(driver)
    expect(await fs.readFile(join(prepared.workspaceRoot, mainPath), 'utf8')).toBe(`import './acceptance.bootstrap'\n${originalMain}`)
    expect(await fs.readFile(join(options.sourceRoot, mainPath), 'utf8')).toBe(originalMain)
    await expect(fs.lstat(join(options.sourceRoot, bootstrapPath))).rejects.toMatchObject({ code: 'ENOENT' })
    const manifest = JSON.parse(await fs.readFile(prepared.manifestPath, 'utf8'))
    expect(manifest.rendererBootstrap).toMatchObject({ inputPath: rendererBootstrapPath, targetPath: bootstrapPath, mainPath, originalMain, provenance: 'caller-generated-single-file-driver' })
    expect(manifest.rendererBootstrap.inputSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(manifest.rendererBootstrap.originalMainSha256).not.toBe(manifest.rendererBootstrap.adaptedMainSha256)
    expect(manifest.adapter.changes).toEqual(expect.arrayContaining([expect.objectContaining({ path: mainPath, reason: 'single-renderer-bootstrap-import' })]))
  })

  it('rejects unsafe, nonregular and source-owned bootstrap paths before cloning', async () => {
    await expect(prepareAcceptanceBuild({ ...options, rendererBootstrapPath: './driver.ts' })).rejects.toThrow('ABSOLUTE_PATH_REQUIRED')
    await expect(prepareAcceptanceBuild({ ...options, rendererBootstrapPath: directory })).rejects.toThrow('INVALID_RENDERER_BOOTSTRAP')
    await expect(prepareAcceptanceBuild({ ...options, rendererBootstrapPath: join(options.sourceRoot, mainPath) })).rejects.toThrow('BOOTSTRAP_NOT_TASK_OWNED')
    const symbolic = join(directory, 'driver.ts')
    await fs.symlink(options.clockShimPath, symbolic)
    await expect(prepareAcceptanceBuild({ ...options, rendererBootstrapPath: symbolic })).rejects.toThrow('INVALID_RENDERER_BOOTSTRAP')
    expect(vi.mocked(fs.copyFile)).not.toHaveBeenCalled()
    await expect(fs.lstat(options.workspaceRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a duplicate renderer bootstrap import or an existing bootstrap file', async () => {
    const rendererBootstrapPath = join(directory, 'driver.ts')
    await fixtureFile(rendererBootstrapPath, 'export {}\n')
    await fs.writeFile(join(options.sourceRoot, mainPath), `import './acceptance.bootstrap'\n${originalMain}`)
    await expect(prepareAcceptanceBuild({ ...options, rendererBootstrapPath })).rejects.toThrow('RENDERER_BOOTSTRAP_IMPORT_EXISTS')
    await fs.writeFile(join(options.sourceRoot, mainPath), originalMain)
    await fixtureFile(join(options.sourceRoot, bootstrapPath), 'export {}\n')
    await expect(prepareAcceptanceBuild({ ...options, rendererBootstrapPath })).rejects.toThrow('RENDERER_BOOTSTRAP_ALREADY_PRESENT')
    expect(vi.mocked(fs.copyFile)).not.toHaveBeenCalled()
  })
})
