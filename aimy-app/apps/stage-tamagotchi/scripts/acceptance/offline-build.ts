import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'vite'

import { sha256 } from './dataset'
import { buildAcceptanceBuild, prepareAcceptanceBuild } from './prepare-build'

const directory = fileURLToPath(new URL('.', import.meta.url))
const productRoot = resolve(directory, '../../../..')

/** Bundles tool internals, leaving product imports to the controlled app's own Vite graph. */
export async function bundleOfflineTools(taskRoot: string) {
  const driver = join(taskRoot, 'driver')
  const host = join(taskRoot, 'host')
  await mkdir(driver, { recursive: true })
  await mkdir(host, { recursive: true })
  const provenance: Array<{ entry: string, sha256: string, output: string, outputSha256: string }> = []
  for (const arm of ['airi', 'aimy'] as const) {
    const entry = join(directory, `driver-${arm}.ts`)
    await build({ configFile: false, root: directory, envFile: false, logLevel: 'warn', build: {
      outDir: driver,
      emptyOutDir: false,
      minify: false,
      lib: { entry, formats: ['es'], fileName: () => `${arm}.bootstrap.mjs` },
      rollupOptions: { external: id => !id.startsWith('.') && !isAbsolute(id) },
    } })
    const output = join(driver, `${arm}.bootstrap.ts`)
    await rename(join(driver, `${arm}.bootstrap.mjs`), output)
    provenance.push({ entry, sha256: sha256(await readFile(entry)), output, outputSha256: sha256(await readFile(output)) })
  }
  const entry = join(directory, 'offline-host.ts')
  await build({ configFile: false, root: directory, envFile: false, logLevel: 'warn', build: {
    outDir: host,
    emptyOutDir: false,
    minify: false,
    target: 'node24',
    lib: { entry, formats: ['es'], fileName: () => 'offline-host.mjs' },
    rollupOptions: { external: id => id === 'electron' || id.startsWith('node:') },
  } })
  provenance.push({ entry, sha256: sha256(await readFile(entry)), output: join(host, 'offline-host.mjs'), outputSha256: sha256(await readFile(join(host, 'offline-host.mjs'))) })
  const inputs = ['driver-common.ts', 'offline-events.ts', 'offline-network.ts', 'baseline-renderer-fetch.ts', 'transport-events.ts', 'baseline-transport.ts', 'airi-baseline-adapter.ts']
  await writeFile(join(taskRoot, 'tool-bundles.json'), JSON.stringify({ mode: 'offline-fixture', generatedAt: new Date().toISOString(), provenance, sharedInputs: await Promise.all(inputs.map(async name => ({ path: join(directory, name), sha256: sha256(await readFile(join(directory, name))) }))), externalProductModules: true, noProductionEntryModified: true }, null, 2))
}

export async function prepareOfflineComparison(taskRoot: string, pnpmPath: string, arm: 'airi' | 'aimy') {
  await mkdir(join(taskRoot, 'workspaces'), { recursive: true })
  await mkdir(join(taskRoot, 'builds'), { recursive: true })
  const prepared = await prepareAcceptanceBuild({
    sourceRoot: arm === 'aimy' ? productRoot : resolve(productRoot, '../.baseline/airi-evaluation-2026-10-10/source'),
    workspaceRoot: join(taskRoot, 'workspaces', arm),
    outputRoot: join(taskRoot, 'builds', arm),
    arm,
    clockShimPath: join(directory, 'fixtures/scenario-clock.ts'),
    rendererBootstrapPath: join(taskRoot, 'driver', `${arm}.bootstrap.ts`),
  })
  await writeFile(join(taskRoot, `prepared-${arm}.json`), JSON.stringify(prepared, null, 2))
  return buildAcceptanceBuild(prepared, { pnpmPath })
}
