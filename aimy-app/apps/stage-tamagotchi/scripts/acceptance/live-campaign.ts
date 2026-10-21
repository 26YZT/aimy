import type { AcceptanceCampaign } from '@proj-airi/stage-ui/stores/memory/budget'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import * as v from 'valibot'

import { AcceptanceBudgetLedger } from '../../src/main/services/aimy/acceptance-budget'
import { loadAcceptanceDataset, projectDataset, sha256 } from './dataset'

const hex = v.pipe(v.string(), v.regex(/^[a-f\d]{64}$/))
const instant = v.pipe(v.string(), v.check(value => Number.isFinite(Date.parse(value))))
const priceUrl = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/'
const priceSchema = v.strictObject({
  observedAt: instant,
  sourceUrl: v.literal(priceUrl),
  sourceSha256: hex,
  modelVersion: v.literal('DeepSeek-V4.1-Flash'),
  inputMicroYuanPerMillion: v.literal(2_000_000),
  cachedInputMicroYuanPerMillion: v.literal(40_000),
  outputMicroYuanPerMillion: v.literal(8_000_000),
})
const manifestSchema = v.strictObject({
  schemaVersion: v.literal(1),
  kind: v.literal('aimy-first-memory-live-acceptance'),
  purpose: v.picklist(['official', 'qualification']),
  campaignId: v.pipe(v.string(), v.uuid()),
  createdAt: instant,
  datasetSha256: hex,
  sourceSha256: hex,
  approvedCaseIds: v.pipe(v.array(v.string()), v.length(8)),
  price: priceSchema,
  budgetMicroYuan: v.literal(10_000_000),
  modelId: v.literal('deepseek-flash'),
  providerId: v.literal('deepseek'),
  mode: v.literal('non-thinking'),
  baseUrl: v.literal('https://api.deepseek.com/'),
})

export type LiveCampaignManifest = v.InferOutput<typeof manifestSchema>
export type LivePriceObservation = v.InferOutput<typeof priceSchema>
export interface LiveCampaign {
  root: string
  manifest: LiveCampaignManifest
  campaign: AcceptanceCampaign
  ledgerPath: string
  budgetConfigPath: string
  setupProfile: string
  bindingPath: string
  datasetPath: string
}

export class LiveCampaignError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'LiveCampaignError'
  }
}

function check(value: unknown, code: string): asserts value {
  if (!value)
    throw new LiveCampaignError(code)
}

async function canonicalDirectory(directory: string) {
  const normalized = resolve(directory)
  const info = await lstat(normalized)
  check(info.isDirectory() && !info.isSymbolicLink(), 'LIVE_DIRECTORY_ALIAS_REJECTED')
  const canonical = await realpath(normalized)
  // macOS exposes system temp directories through /var and /tmp. User-created aliases remain rejected.
  const systemTempAlias = process.platform === 'darwin'
    && (normalized === '/var' || normalized.startsWith('/var/') || normalized === '/tmp' || normalized.startsWith('/tmp/'))
    && canonical === `/private${normalized}`
  check(canonical === normalized || systemTempAlias, 'LIVE_DIRECTORY_ALIAS_REJECTED')
  return canonical
}

async function readCampaignBytes(path: string, maxBytes: number): Promise<Buffer> {
  check(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 8 * 1024 * 1024, 'LIVE_INVALID_FILE_LIMIT')
  await canonicalDirectory(dirname(path))
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const info = await handle.stat()
    check(info.isFile() && info.size > 0 && info.size <= maxBytes, 'LIVE_INVALID_FILE')
    const buffer = Buffer.alloc(info.size + 1)
    let length = 0
    while (length < buffer.length) {
      const chunk = await handle.read(buffer, length, buffer.length - length, length)
      if (!chunk.bytesRead)
        break
      length += chunk.bytesRead
    }
    check(length === info.size, 'LIVE_INVALID_FILE')
    return buffer.subarray(0, length)
  }
  finally { await handle.close() }
}

function requireCurrentPrice(price: LivePriceObservation) {
  const now = Date.now()
  const observedAt = Date.parse(price.observedAt)
  check(observedAt <= now && now - observedAt < 24 * 60 * 60_000, 'LIVE_PRICE_REVIEW_EXPIRED')
}

export function defaultLiveCampaignRoot() {
  return join(homedir(), 'Library', 'Application Support', 'Aimy-Acceptance', 'first-memory-v1')
}

/** Only explicit campaign-owned files enter command state. No credential discovery takes place. */
export async function readCampaignJson(path: string, maxBytes = 64 * 1024): Promise<unknown> {
  const content = await readCampaignBytes(path, maxBytes)
  try {
    return JSON.parse(content.toString('utf8'))
  }
  catch { throw new LiveCampaignError('LIVE_INVALID_JSON') }
}

export async function writeCampaignJson(path: string, value: unknown, replace = false) {
  await canonicalDirectory(dirname(path))
  if (replace) {
    try {
      const info = await lstat(path)
      check(info.isFile() && !info.isSymbolicLink(), 'LIVE_INVALID_FILE')
    }
    catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT')
        throw error
    }
  }
  const content = `${JSON.stringify(value, null, 2)}\n`
  check(Buffer.byteLength(content) <= 8 * 1024 * 1024, 'LIVE_INVALID_FILE')
  const target = replace ? `${path}.${randomUUID()}.tmp` : path
  const handle = await open(target, 'wx', 0o600)
  try {
    await handle.writeFile(content)
    await handle.sync()
  }
  finally { await handle.close() }
  if (replace)
    await rename(target, path)
  const directory = await open(dirname(path), constants.O_RDONLY)
  try {
    await directory.sync()
  }
  finally { await directory.close() }
}

function budget(manifest: LiveCampaignManifest): AcceptanceCampaign {
  return {
    campaignId: manifest.campaignId,
    maxCostMicroYuan: manifest.budgetMicroYuan,
    price: {
      id: 'deepseek-flash-peak-20261016',
      currency: 'CNY',
      providerId: 'deepseek',
      modelId: 'deepseek-flash',
      mode: 'non-thinking',
      inputMicroYuanPerMillion: manifest.price.inputMicroYuanPerMillion,
      cachedInputMicroYuanPerMillion: manifest.price.cachedInputMicroYuanPerMillion,
      outputMicroYuanPerMillion: manifest.price.outputMicroYuanPerMillion,
      verifiedAt: manifest.price.observedAt,
      sourceUrl: priceUrl,
    },
  }
}

/** Existing campaigns always retain their identity, budget configuration and ledger. */
export async function openLiveCampaign(directory: string): Promise<LiveCampaign> {
  check(isAbsolute(directory), 'LIVE_ABSOLUTE_ROOT_REQUIRED')
  const root = await canonicalDirectory(directory)
  const manifest = v.parse(manifestSchema, await readCampaignJson(join(root, 'live-campaign.json')))
  const datasetPath = join(root, 'cases.json')
  const dataset = await readCampaignBytes(datasetPath, 512 * 1024)
  check(sha256(dataset) === manifest.datasetSha256, 'LIVE_DATASET_CHANGED')
  const source = await readCampaignBytes(join(root, 'user-v2-source.md'), 512 * 1024)
  check(sha256(source) === manifest.sourceSha256, 'LIVE_SOURCE_CHANGED')
  const cases = projectDataset(JSON.parse(dataset.toString('utf8')), source)
  check(JSON.stringify(cases.cases.map(item => item.caseId)) === JSON.stringify(manifest.approvedCaseIds), 'LIVE_CASES_CHANGED')
  const campaign = budget(manifest)
  const ledgerPath = join(root, 'ledger.json')
  const budgetConfigPath = join(root, 'budget.json')
  const config = await readCampaignJson(budgetConfigPath)
  check(JSON.stringify(config) === JSON.stringify({ ledgerPath, campaign }), 'LIVE_BUDGET_CONFIG_CHANGED')
  // Opening must never call ledger.status(): it creates a missing ledger and would reset the campaign's spend.
  const ledger = v.parse(v.object({ schemaVersion: v.literal(1), campaign: v.unknown(), paused: v.boolean(), records: v.record(v.string(), v.unknown()) }), await readCampaignJson(ledgerPath, 8 * 1024 * 1024))
  check(JSON.stringify(ledger.campaign) === JSON.stringify(campaign), 'LIVE_LEDGER_CAMPAIGN_CHANGED')
  const setupProfile = join(root, 'setup-profile')
  await canonicalDirectory(setupProfile)
  const profile = await readCampaignJson(join(setupProfile, '.aimy-acceptance-profile.json'))
  check(JSON.stringify(profile) === JSON.stringify({ schemaVersion: 1, campaignId: manifest.campaignId, kind: 'setup' }), 'LIVE_SETUP_PROFILE_CHANGED')
  return { root, manifest, campaign, ledgerPath, budgetConfigPath, setupProfile, bindingPath: join(root, 'credential-binding.json'), datasetPath }
}

/**
 * Prepares one durable budget before any configuration window or network request.
 * Call stack: CLI prepare -> prepareLiveCampaign -> source validation -> one ledger.
 */
export async function prepareLiveCampaign(options: { root: string, repository: string, datasetPath: string, purpose: LiveCampaignManifest['purpose'], price: LivePriceObservation }): Promise<LiveCampaign> {
  check(isAbsolute(options.root), 'LIVE_ABSOLUTE_ROOT_REQUIRED')
  const price = v.parse(priceSchema, options.price)
  const now = Date.now()
  requireCurrentPrice(price)
  check(isAbsolute(options.datasetPath) && isAbsolute(options.repository), 'LIVE_ABSOLUTE_SOURCE_REQUIRED')
  const dataset = await readCampaignBytes(options.datasetPath, 512 * 1024)
  const sourcePath = v.parse(v.object({ sources: v.object({ user_v2_md: v.object({ path: v.string() }) }) }), JSON.parse(dataset.toString('utf8'))).sources.user_v2_md.path
  const absoluteSource = resolve(options.repository, sourcePath)
  const sourceWithin = relative(options.repository, absoluteSource)
  check(sourceWithin && !isAbsolute(sourceWithin) && sourceWithin !== '..' && !sourceWithin.startsWith(`..${sep}`), 'LIVE_SOURCE_OUTSIDE_REPOSITORY')
  const source = await readCampaignBytes(absoluteSource, 512 * 1024)
  const data = await loadAcceptanceDataset(options.datasetPath, options.repository)
  check(sha256(dataset) === data.datasetSha256, 'LIVE_DATASET_CHANGED')
  check(sha256(source) === data.sourceSha256, 'LIVE_SOURCE_CHANGED')
  projectDataset(JSON.parse(dataset.toString('utf8')), source)
  await mkdir(dirname(options.root), { recursive: true, mode: 0o700 })
  const root = join(await canonicalDirectory(dirname(options.root)), basename(options.root))
  try {
    await mkdir(root, { mode: 0o700 })
  }
  catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST')
      throw error
    const existing = await openLiveCampaign(root)
    check(existing.manifest.purpose === options.purpose && existing.manifest.datasetSha256 === data.datasetSha256, 'LIVE_EXISTING_CAMPAIGN_MISMATCH')
    return existing
  }
  const manifest: LiveCampaignManifest = {
    schemaVersion: 1,
    kind: 'aimy-first-memory-live-acceptance',
    purpose: options.purpose,
    campaignId: randomUUID(),
    createdAt: new Date(now).toISOString(),
    datasetSha256: data.datasetSha256,
    sourceSha256: data.sourceSha256,
    approvedCaseIds: data.cases.map(item => item.caseId),
    price,
    budgetMicroYuan: 10_000_000,
    modelId: 'deepseek-flash',
    providerId: 'deepseek',
    mode: 'non-thinking',
    baseUrl: 'https://api.deepseek.com/',
  }
  await writeCampaignJson(join(root, 'live-campaign.json'), manifest)
  const datasetHandle = await open(join(root, 'cases.json'), 'wx', 0o600)
  try {
    await datasetHandle.writeFile(dataset)
    await datasetHandle.sync()
  }
  finally { await datasetHandle.close() }
  const sourceHandle = await open(join(root, 'user-v2-source.md'), 'wx', 0o600)
  try {
    await sourceHandle.writeFile(source)
    await sourceHandle.sync()
  }
  finally { await sourceHandle.close() }
  const campaign = budget(manifest)
  const ledgerPath = join(root, 'ledger.json')
  await writeCampaignJson(join(root, 'budget.json'), { ledgerPath, campaign })
  const setup = join(root, 'setup-profile')
  await mkdir(setup, { mode: 0o700 })
  await writeCampaignJson(join(setup, '.aimy-acceptance-profile.json'), { schemaVersion: 1, campaignId: manifest.campaignId, kind: 'setup' })
  await new AcceptanceBudgetLedger({ filePath: ledgerPath, campaign }).status()
  return openLiveCampaign(root)
}

/** A renewed review changes no recorded costs or frozen campaign prices. */
export async function reviewLivePrice(campaign: LiveCampaign, price: LivePriceObservation) {
  const checked = v.parse(priceSchema, price)
  check(checked.inputMicroYuanPerMillion <= campaign.campaign.price.inputMicroYuanPerMillion
    && checked.outputMicroYuanPerMillion <= campaign.campaign.price.outputMicroYuanPerMillion
    && checked.cachedInputMicroYuanPerMillion <= (campaign.campaign.price.cachedInputMicroYuanPerMillion ?? 0), 'LIVE_PRICE_INCREASE_REQUIRES_REVIEW')
  requireCurrentPrice(checked)
  await writeCampaignJson(join(campaign.root, 'price-review.json'), checked, true)
}

export async function assertLivePriceCurrent(campaign: LiveCampaign) {
  let price = campaign.manifest.price
  try {
    price = v.parse(priceSchema, await readCampaignJson(join(campaign.root, 'price-review.json')))
  }
  catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT')
      throw error
  }
  requireCurrentPrice(price)
}

/** Setup and execution never overlap. A stale lock needs an explicit recovery review, not automatic budget reset. */
export async function lockLiveCampaign(campaign: LiveCampaign, operation: 'setup' | 'run') {
  const path = join(campaign.root, 'operation.lock')
  const token = randomUUID()
  await writeCampaignJson(path, { pid: process.pid, operation, token, createdAt: new Date().toISOString() })
  return async () => {
    const current = v.parse(v.object({ token: v.string() }), await readCampaignJson(path))
    check(current.token === token, 'LIVE_LOCK_CHANGED')
    await unlink(path)
  }
}

export async function assertCampaignChild(campaign: LiveCampaign, path: string) {
  const target = await canonicalDirectory(path)
  const inside = relative(campaign.root, target)
  check(inside && !isAbsolute(inside) && inside !== '..' && !inside.startsWith(`..${sep}`), 'LIVE_PATH_OUTSIDE_CAMPAIGN')
  return target
}
