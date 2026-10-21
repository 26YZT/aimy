import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it } from 'vitest'

import { loadAcceptanceLedger } from './acceptance-config'

const roots: string[] = []
const campaign = { campaignId: 'synthetic-config', maxCostMicroYuan: 10_000_000, price: { id: 'synthetic', currency: 'CNY', providerId: 'synthetic', modelId: 'synthetic', mode: 'synthetic', inputMicroYuanPerMillion: 100, outputMicroYuanPerMillion: 200, sourceUrl: 'https://example.invalid/synthetic', verifiedAt: 'synthetic-fixture' } }

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'aimy-budget-config-'))
  roots.push(root)
  const profile = join(root, 'profile')
  await mkdir(profile)
  return { root, profile, config: join(root, 'acceptance.json') }
}

afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true })
})

it('leaves normal product startup without an acceptance ledger', async () => {
  expect(await loadAcceptanceLedger(undefined, '/unused-synthetic-profile')).toBeUndefined()
})

it('rejects a two-dot directory that is still inside the profile', async () => {
  const { profile, config } = await fixture()
  await writeFile(config, JSON.stringify({ ledgerPath: join(profile, '..campaign', 'ledger.json'), campaign }))
  await expect(loadAcceptanceLedger(config, profile)).rejects.toMatchObject({ code: 'invalid-input' })
})

it('rejects a parent symlink back into the profile', async () => {
  const { root, profile, config } = await fixture()
  await symlink(profile, join(root, 'alias'))
  await writeFile(config, JSON.stringify({ ledgerPath: join(root, 'alias', 'ledger.json'), campaign }))
  await expect(loadAcceptanceLedger(config, profile)).rejects.toMatchObject({ code: 'invalid-input' })
})

it('uses a shared canonical location outside either profile', async () => {
  const { root, profile, config } = await fixture()
  await writeFile(config, JSON.stringify({ ledgerPath: join(root, 'campaign', 'ledger.json'), campaign }))
  const ledger = await loadAcceptanceLedger(config, profile)
  expect(ledger?.info()).toEqual(campaign)
  expect((await ledger?.status())?.attempts).toBe(0)
})
