import type { LivePriceObservation } from './live-campaign'

import process from 'node:process'

import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { prepareLiveBuild, readLiveBuild } from './live-build'
import { defaultLiveCampaignRoot, openLiveCampaign, prepareLiveCampaign, readCampaignJson, reviewLivePrice } from './live-campaign'
import { launchLiveSetup, liveAcceptanceStatus, recoverLiveOperation, runLiveAcceptance } from './live-runner'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..')
const pricePath = join(repository, 'docs/02-调研参考/2026-10-16-DeepSeek验收价表.json')

function fail(code: string): never {
  throw new Error(code)
}

/**
 * Preparation and configuration do not execute a model call.
 * Call stack: prepare/configure/status -> durable campaign. run --execute -> explicit shared-budget execution.
 */
async function main() {
  const [command, ...args] = process.argv.slice(2)
  const values = new Map<string, string>()
  let execute = false
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--execute') {
      if (execute)
        fail('LIVE_DUPLICATE_OPTION')
      execute = true
      continue
    }
    const key = args[index]
    if (!['--root', '--cache', '--pnpm', '--price', '--case'].includes(key) || values.has(key) || !args[index + 1])
      fail('LIVE_INVALID_OPTION')
    values.set(key, args[++index])
  }
  const root = values.get('--root') ?? defaultLiveCampaignRoot()
  if (!isAbsolute(root))
    fail('LIVE_ABSOLUTE_ROOT_REQUIRED')
  // Official preparation has one stable location. Alternate roots are explicit existing-campaign operations, never fresh budgets.
  if (command === 'prepare') {
    if (resolve(root) !== resolve(defaultLiveCampaignRoot()))
      fail('LIVE_OFFICIAL_ROOT_FIXED')
    const price = await readCampaignJson(values.get('--price') ?? pricePath) as LivePriceObservation
    const campaign = await prepareLiveCampaign({ root, repository, datasetPath: join(repository, 'docs/04-验证记录/2026-10-15-首批增量开发/acceptance/cases.json'), purpose: 'official', price })
    const cacheRoot = values.get('--cache') ?? join(tmpdir(), `aimy-live-build-${randomUUID()}`)
    const pnpmPath = values.get('--pnpm')
    if (!pnpmPath || !isAbsolute(pnpmPath))
      fail('LIVE_INSTALLED_PNPM_PATH_REQUIRED')
    const builds = await prepareLiveBuild(campaign, { cacheRoot, pnpmPath })
    console.info(JSON.stringify({ prepared: true, campaignRoot: campaign.root, cacheRoot: builds.cacheRoot, budgetYuan: 10, modelCalls: 0 }))
    return
  }
  if (command === 'status') {
    console.info(JSON.stringify(await liveAcceptanceStatus(root)))
    return
  }
  if (command === 'configure') {
    const campaign = await openLiveCampaign(root)
    if (campaign.manifest.purpose !== 'official')
      fail('LIVE_OFFICIAL_CAMPAIGN_REQUIRED')
    const setup = await launchLiveSetup(campaign, await readLiveBuild(campaign))
    console.info(JSON.stringify({ configurationWindowOpened: true, pid: setup.pid, remoteDebugEnabled: false, automaticExecution: false }))
    const exit = await setup.closed
    console.info(JSON.stringify({ configurationWindowClosed: true, ...exit, status: await liveAcceptanceStatus(root) }))
    return
  }
  if (command === 'run') {
    if (!execute)
      fail('LIVE_EXPLICIT_EXECUTION_REQUIRED')
    const result = await runLiveAcceptance({ campaignRoot: root, execute: true, onlyCase: values.get('--case') })
    console.info(JSON.stringify({ status: result.status, scored: false, realModelCalls: result.realModelCalls }))
    return
  }
  if (command === 'review-price') {
    if (!values.has('--price'))
      fail('LIVE_VERIFIED_PRICE_FILE_REQUIRED')
    await reviewLivePrice(await openLiveCampaign(root), await readCampaignJson(values.get('--price')!) as LivePriceObservation)
    console.info(JSON.stringify({ priceReviewUpdated: true, budgetReset: false }))
    return
  }
  if (command === 'recover') {
    console.info(JSON.stringify(await recoverLiveOperation(root)))
    return
  }
  fail('LIVE_COMMAND_REQUIRED')
}

void main().catch((error: unknown) => {
  console.error(JSON.stringify({ ok: false, code: error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'LIVE_COMMAND_FAILED' }))
  process.exitCode = 1
})
