import type { LiveCampaignManifest, LivePriceObservation } from './live-campaign'

import { mkdir, mkdtemp, readFile, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { AcceptanceBudgetLedger } from '../../src/main/services/aimy/acceptance-budget'
import { assertCampaignChild, assertLivePriceCurrent, lockLiveCampaign, openLiveCampaign, prepareLiveCampaign, readCampaignJson, reviewLivePrice, writeCampaignJson } from './live-campaign'

const directories: string[] = []
const repository = resolve(import.meta.dirname, '../../../../..')
const datasetPath = join(repository, 'docs/04-验证记录/2026-10-15-首批增量开发/acceptance/cases.json')
function price(observedAt = new Date(Date.now() - 1000).toISOString()): LivePriceObservation {
  return { observedAt, sourceUrl: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/', sourceSha256: 'a'.repeat(64), modelVersion: 'DeepSeek-V4.1-Flash', inputMicroYuanPerMillion: 2_000_000, cachedInputMicroYuanPerMillion: 40_000, outputMicroYuanPerMillion: 8_000_000 }
}
async function options() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'aimy-live-campaign-test-')))
  directories.push(directory)
  return { root: join(directory, 'campaign'), repository, datasetPath, purpose: 'qualification' as const, price: price() }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('durable live campaign', () => {
  it('reopens the same identity and retains paid accounting when prepare repeats', async () => {
    const input = await options()
    const campaign = await prepareLiveCampaign(input)
    const ledger = new AcceptanceBudgetLedger({ filePath: campaign.ledgerPath, campaign: campaign.campaign })
    const reservation = await ledger.reserve({ attemptId: 'synthetic-paid', requestId: 'request-paid', runId: 'test-run', caseId: 'USER-V2-01', arm: 'aimy', purpose: 'chat', providerId: 'deepseek', modelId: 'deepseek-flash', mode: 'non-thinking', protocol: 'chat-completions', priceVersion: campaign.campaign.price.id, inputTokensUpperBound: 100, maxOutputTokens: 100 })
    await ledger.started(reservation)
    await ledger.settle({ reservation, usage: { inputTokens: 30, outputTokens: 15 } })
    const before = await readFile(campaign.ledgerPath, 'utf8')
    const reopened = await prepareLiveCampaign(input)
    expect(reopened.manifest.campaignId).toBe(campaign.manifest.campaignId)
    expect(reopened.ledgerPath).toBe(campaign.ledgerPath)
    expect(await readFile(campaign.ledgerPath, 'utf8')).toBe(before)
    expect((await ledger.status()).accountedMicroYuan).toBeGreaterThan(0)
    expect(await readFile(join(campaign.root, 'user-v2-source.md'), 'utf8')).toContain('团团')
  })

  it('never recreates a missing ledger under an existing campaign', async () => {
    const input = await options()
    const campaign = await prepareLiveCampaign(input)
    await unlink(campaign.ledgerPath)
    await expect(openLiveCampaign(campaign.root)).rejects.toThrow()
    await expect(prepareLiveCampaign(input)).rejects.toThrow()
    await expect(readFile(campaign.ledgerPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a changed source hash, case list, dataset, and budget', async () => {
    const input = await options()
    const campaign = await prepareLiveCampaign(input)
    const manifestPath = join(campaign.root, 'live-campaign.json')
    const originalManifest = await readFile(manifestPath)
    for (const change of [{ sourceSha256: 'b'.repeat(64) }, { approvedCaseIds: Array.from({ length: 8 }).fill('USER-V2-01') }]) {
      await writeCampaignJson(manifestPath, { ...campaign.manifest, ...change }, true)
      await expect(openLiveCampaign(campaign.root)).rejects.toThrow()
      await writeFile(manifestPath, originalManifest)
    }
    const originalData = await readFile(campaign.datasetPath)
    await writeFile(campaign.datasetPath, `${originalData.toString()}\n`)
    await expect(openLiveCampaign(campaign.root)).rejects.toThrow('LIVE_DATASET_CHANGED')
    await writeFile(campaign.datasetPath, originalData)
    const sourcePath = join(campaign.root, 'user-v2-source.md')
    const source = await readFile(sourcePath)
    await writeFile(sourcePath, 'changed synthetic source')
    await expect(openLiveCampaign(campaign.root)).rejects.toThrow('LIVE_SOURCE_CHANGED')
    await writeFile(sourcePath, source)
    const originalLedger = await readCampaignJson(campaign.ledgerPath) as { campaign: unknown }
    await writeCampaignJson(campaign.ledgerPath, { ...originalLedger, campaign: { ...campaign.campaign, maxCostMicroYuan: 9_000_000 } }, true)
    await expect(openLiveCampaign(campaign.root)).rejects.toThrow('LIVE_LEDGER_CAMPAIGN_CHANGED')
    await writeCampaignJson(campaign.ledgerPath, originalLedger, true)
    await writeCampaignJson(campaign.budgetConfigPath, { ledgerPath: campaign.ledgerPath, campaign: { ...campaign.campaign, maxCostMicroYuan: 9_000_000 } }, true)
    await expect(openLiveCampaign(campaign.root)).rejects.toThrow('LIVE_BUDGET_CONFIG_CHANGED')
  })

  it('rejects unknown folders and symlink aliases without changing their contents', async () => {
    const input = await options()
    const unknown = join(input.root, '..', 'unknown')
    await mkdir(unknown)
    const privateFile = join(unknown, 'private-old-data.txt')
    await writeFile(privateFile, 'synthetic-old-data')
    await expect(prepareLiveCampaign({ ...input, root: unknown })).rejects.toThrow()
    expect(await readFile(privateFile, 'utf8')).toBe('synthetic-old-data')
    const campaign = await prepareLiveCampaign(input)
    const alias = join(input.root, '..', 'alias')
    await symlink(campaign.root, alias)
    await expect(openLiveCampaign(alias)).rejects.toThrow()
    await expect(prepareLiveCampaign({ ...input, root: alias })).rejects.toThrow()
    const parentAlias = join(input.root, '..', 'parent-alias')
    await symlink(campaign.root, parentAlias)
    await expect(prepareLiveCampaign({ ...input, root: join(parentAlias, 'new-campaign') })).rejects.toThrow()
    await expect(readFile(join(campaign.root, 'new-campaign', 'live-campaign.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    const childAlias = join(campaign.root, 'profile-alias')
    await symlink(campaign.setupProfile, childAlias)
    await expect(assertCampaignChild(campaign, childAlias)).rejects.toThrow()
  })

  it('rejects future and expired price reviews without changing the frozen ledger', async () => {
    const input = await options()
    for (const observedAt of [new Date(Date.now() + 30_000).toISOString(), new Date(Date.now() - 25 * 60 * 60_000).toISOString()])
      await expect(prepareLiveCampaign({ ...input, price: price(observedAt) })).rejects.toThrow('LIVE_PRICE_REVIEW_EXPIRED')
    const campaign = await prepareLiveCampaign(input)
    const before = await readFile(campaign.ledgerPath)
    await reviewLivePrice(campaign, price())
    await expect(assertLivePriceCurrent(campaign)).resolves.toBeUndefined()
    for (const observedAt of [new Date(Date.now() + 30_000).toISOString(), new Date(Date.now() - 25 * 60 * 60_000).toISOString()]) {
      await expect(reviewLivePrice(campaign, price(observedAt))).rejects.toThrow('LIVE_PRICE_REVIEW_EXPIRED')
      await writeCampaignJson(join(campaign.root, 'price-review.json'), price(observedAt), true)
      await expect(assertLivePriceCurrent(campaign)).rejects.toThrow('LIVE_PRICE_REVIEW_EXPIRED')
    }
    expect(await readFile(campaign.ledgerPath)).toEqual(before)
  })

  it('keeps setup and run mutually exclusive and never removes a replaced lock', async () => {
    const campaign = await prepareLiveCampaign(await options())
    const release = await lockLiveCampaign(campaign, 'setup')
    await expect(lockLiveCampaign(campaign, 'run')).rejects.toThrow()
    await release()
    const releaseRun = await lockLiveCampaign(campaign, 'run')
    const lockPath = join(campaign.root, 'operation.lock')
    await writeCampaignJson(lockPath, { token: 'another-owner' }, true)
    await expect(releaseRun()).rejects.toThrow('LIVE_LOCK_CHANGED')
    expect(await readCampaignJson(lockPath)).toEqual({ token: 'another-owner' })
  })

  it('gives only one simultaneous setup or run command the campaign lock', async () => {
    const campaign = await prepareLiveCampaign(await options())
    const locks = await Promise.allSettled([lockLiveCampaign(campaign, 'setup'), lockLiveCampaign(campaign, 'run')])
    expect(locks.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(locks.filter(result => result.status === 'rejected')).toHaveLength(1)
    const winner = locks.find(result => result.status === 'fulfilled')
    if (winner?.status !== 'fulfilled')
      throw new Error('Expected one lock owner')
    await winner.value()
    await expect(readFile(join(campaign.root, 'operation.lock'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects symlink dataset inputs before creating a campaign directory', async () => {
    const input = await options()
    const alias = join(input.root, '..', 'cases-alias.json')
    await symlink(datasetPath, alias)
    await expect(prepareLiveCampaign({ ...input, datasetPath: alias })).rejects.toThrow()
    await expect(readFile(join(input.root, 'live-campaign.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects symlink and non-regular files and does not replace a symlink target', async () => {
    const input = await options()
    const campaign = await prepareLiveCampaign(input)
    const linked = join(campaign.root, 'linked.json')
    await symlink(campaign.budgetConfigPath, linked)
    await expect(readCampaignJson(linked)).rejects.toThrow()
    await expect(readCampaignJson(campaign.setupProfile)).rejects.toThrow()
    await expect(writeCampaignJson(linked, { bad: true }, true)).rejects.toThrow()
    const original = await readFile(campaign.budgetConfigPath, 'utf8')
    expect(original).not.toContain('"bad"')
    await expect(readCampaignJson(campaign.datasetPath, 10)).rejects.toThrow('LIVE_INVALID_FILE')
    const manifest: LiveCampaignManifest = campaign.manifest
    expect(manifest.budgetMicroYuan).toBe(10_000_000)
  })
})
