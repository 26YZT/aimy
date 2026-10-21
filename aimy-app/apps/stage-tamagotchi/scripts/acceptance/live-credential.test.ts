import type { ProviderSecretStorage } from '@proj-airi/stage-ui/services/provider-secret-storage'

import type { LiveCredentialCandidate } from './live-credential-contract'

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { copyBoundCredential, LiveCredentialBindingStore, readLiveCredentialBinding } from './live-credential'

const testHome = vi.hoisted(() => ({ value: undefined as string | undefined }))
vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>()
  return { ...original, homedir: () => testHome.value ?? original.homedir() }
})

const roots: string[] = []
afterEach(async () => {
  testHome.value = undefined
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(libraryPath?: string) {
  const temporary = await mkdtemp(join(tmpdir(), 'aimy-credential-test-'))
  roots.push(temporary)
  const root = libraryPath ? join(temporary, libraryPath) : temporary
  if (libraryPath) {
    testHome.value = temporary
    await mkdir(root, { recursive: true })
  }
  const setupProfile = join(root, 'setup')
  const targetProfile = join(root, 'case')
  await Promise.all([setupProfile, targetProfile].map(path => mkdir(path)))
  const campaignId = 'acceptance-test'
  await writeFile(join(setupProfile, '.aimy-acceptance-profile.json'), JSON.stringify({ schemaVersion: 1, campaignId, kind: 'setup' }))
  await writeFile(join(targetProfile, '.aimy-acceptance-profile.json'), JSON.stringify({ schemaVersion: 1, campaignId, kind: 'case', caseId: 'USER-V2-01' }))
  const secretReference = { secretRef: randomUUID(), revision: 1 }
  const candidate: LiveCredentialCandidate = { providerId: 'acceptance-deepseek', definitionId: 'deepseek', baseUrl: 'https://api.deepseek.com/', modelId: 'deepseek-flash', thinkingMode: 'disable', configurationRevision: 1, secretReference }
  const selected: { providerId: string, revision: number, encrypted: string } = { providerId: candidate.providerId, revision: 1, encrypted: Buffer.from('synthetic ciphertext').toString('base64') }
  const envelope = { schemaVersion: 1, records: { [secretReference.secretRef]: selected, [randomUUID()]: { providerId: 'unrelated', revision: 1, encrypted: Buffer.from('unrelated ciphertext').toString('base64') } } }
  const vaultPath = join(setupProfile, 'provider-secrets.json')
  await writeFile(vaultPath, JSON.stringify(envelope))
  const vault = { read: vi.fn<ProviderSecretStorage['read']>().mockResolvedValue({ config: JSON.stringify({ apiKey: 'synthetic-secret-canary' }) }) }
  const options = { campaignId, setupProfile, bindingPath: join(root, 'credential-binding.json') }
  return { root, targetProfile, candidate, selected, envelope, vaultPath, vault, options, store: new LiveCredentialBindingStore({ ...options, vault }) }
}

describe('dedicated live credential binding', () => {
  it('supports the dedicated persistent Library campaign without admitting other Library profiles', async () => {
    const f = await fixture('Library/Application Support/Aimy-Acceptance/first-memory-v1')
    expect(await f.store.record(f.candidate)).toEqual({ configured: true, configurationRevision: 1 })
    expect((await copyBoundCredential({ ...f.options, targetProfile: f.targetProfile })).secretReference).toEqual(f.candidate.secretReference)
    const unrelated = await fixture('Library/Application Support/Old-Aimy')
    await expect(unrelated.store.record(unrelated.candidate)).rejects.toMatchObject({ code: 'LIVE_CREDENTIAL_PATH_DENIED' })
  })

  it('records public metadata and copies only the selected encrypted record with private permissions', async () => {
    const f = await fixture()
    expect(await f.store.status()).toMatchObject({ configured: false, configurationRevision: 0 })
    expect(await f.store.record(f.candidate)).toEqual({ configured: true, configurationRevision: 1 })
    const binding = await copyBoundCredential({ ...f.options, targetProfile: f.targetProfile })
    expect(binding.secretReference).toEqual(f.candidate.secretReference)
    const target = join(f.targetProfile, 'provider-secrets.json')
    expect(JSON.parse(await readFile(target, 'utf8'))).toEqual({ schemaVersion: 1, records: { [f.candidate.secretReference.secretRef]: f.selected } })
    expect((await stat(target)).mode & 0o777).toBe(0o600)
    expect((await stat(f.options.bindingPath)).mode & 0o777).toBe(0o600)
    expect(await readFile(f.options.bindingPath, 'utf8')).not.toContain('synthetic-secret-canary')
    expect(f.vault.read).toHaveBeenCalledWith({ providerId: f.candidate.providerId, reference: f.candidate.secretReference })
  })
  it('recovers in a fresh owner and verifies an existing matching target', async () => {
    const f = await fixture()
    await f.store.record(f.candidate)
    await copyBoundCredential({ ...f.options, targetProfile: f.targetProfile })
    expect(await new LiveCredentialBindingStore({ ...f.options, vault: f.vault }).status()).toEqual({ configured: true, configurationRevision: 1 })
    expect(await copyBoundCredential({ ...f.options, targetProfile: f.targetProfile })).toEqual(await readLiveCredentialBinding(f.options))
  })
  it('persists invalidation and rejects an equal old save', async () => {
    const f = await fixture()
    await f.store.record(f.candidate)
    await f.store.invalidate(1)
    const reopened = new LiveCredentialBindingStore({ ...f.options, vault: f.vault })
    await expect(reopened.record(f.candidate)).rejects.toMatchObject({ code: 'LIVE_CREDENTIAL_STALE_REVISION' })
    await expect(copyBoundCredential({ ...f.options, targetProfile: f.targetProfile })).rejects.toMatchObject({ code: 'LIVE_CREDENTIAL_NOT_CONFIGURED' })
    expect(await reopened.status()).toMatchObject({ configured: false, configurationRevision: 1 })
  })
  it('rejects late invalidation without deleting a newer save', async () => {
    const f = await fixture()
    await f.store.record({ ...f.candidate, configurationRevision: 3 })
    await expect(f.store.invalidate(2)).rejects.toMatchObject({ code: 'LIVE_CREDENTIAL_STALE_REVISION' })
    expect(await f.store.status()).toEqual({ configured: true, configurationRevision: 3 })
  })
  it('serializes save and invalidation while the native vault is pending', async () => {
    const f = await fixture()
    let release: (() => void) | undefined
    const waiting = new Promise<void>((accept) => {
      release = accept
    })
    f.vault.read.mockImplementationOnce(async () => {
      await waiting
      return { config: '{"apiKey":"synthetic-secret-canary"}' }
    })
    const save = f.store.record(f.candidate)
    const invalidate = f.store.invalidate(2)
    release?.()
    await save
    await invalidate
    expect(await f.store.status()).toMatchObject({ configured: false, configurationRevision: 2 })
  })
  it('detects changed ciphertext with an unchanged reference', async () => {
    const f = await fixture()
    await f.store.record(f.candidate)
    f.selected.encrypted = Buffer.from('tampered ciphertext').toString('base64')
    await writeFile(f.vaultPath, JSON.stringify(f.envelope))
    await expect(readLiveCredentialBinding(f.options)).rejects.toMatchObject({ code: 'LIVE_CREDENTIAL_CHANGED' })
    await expect(copyBoundCredential({ ...f.options, targetProfile: f.targetProfile })).rejects.toMatchObject({ code: 'LIVE_CREDENTIAL_CHANGED' })
  })
  it('rejects binding tampering and wrong campaign markers', async () => {
    const f = await fixture()
    await f.store.record(f.candidate)
    const state = JSON.parse(await readFile(f.options.bindingPath, 'utf8'))
    state.binding.baseUrl = 'https://attacker.invalid/'
    await writeFile(f.options.bindingPath, JSON.stringify(state))
    await expect(readLiveCredentialBinding(f.options)).rejects.toMatchObject({ code: 'LIVE_CREDENTIAL_CHANGED' })
    await writeFile(join(f.options.setupProfile, '.aimy-acceptance-profile.json'), JSON.stringify({ schemaVersion: 1, campaignId: 'another', kind: 'setup' }))
    await expect(readLiveCredentialBinding(f.options)).rejects.toMatchObject({ code: 'LIVE_CREDENTIAL_PROFILE_MISMATCH' })
  })
  it('rejects symlink vaults and target directories', async () => {
    const f = await fixture()
    const alternate = join(f.root, 'vault-alternate')
    await writeFile(alternate, JSON.stringify(f.envelope))
    await rm(f.vaultPath)
    await symlink(alternate, f.vaultPath)
    await expect(f.store.record(f.candidate)).rejects.toMatchObject({ code: 'LIVE_CREDENTIAL_STORAGE_FAILED' })
    await rm(f.vaultPath)
    await writeFile(f.vaultPath, JSON.stringify(f.envelope))
    await f.store.record({ ...f.candidate, configurationRevision: 2 })
    const targetLink = join(f.root, 'linked-case')
    await symlink(f.targetProfile, targetLink)
    await expect(copyBoundCredential({ ...f.options, targetProfile: targetLink })).rejects.toMatchObject({ code: 'LIVE_CREDENTIAL_PATH_DENIED' })
  })
  it('preserves a conflicting target', async () => {
    const f = await fixture()
    await f.store.record(f.candidate)
    const target = join(f.targetProfile, 'provider-secrets.json')
    const original = JSON.stringify({ schemaVersion: 1, records: {} })
    await writeFile(target, original)
    await expect(copyBoundCredential({ ...f.options, targetProfile: f.targetProfile })).rejects.toMatchObject({ code: 'LIVE_CREDENTIAL_TARGET_CONFLICT' })
    expect(await readFile(target, 'utf8')).toBe(original)
  })
  it.each(['', ' ', 'x\r\nAuthorization: secret'])('rejects an invalid decrypted key: %j', async (apiKey) => {
    const f = await fixture()
    f.vault.read.mockResolvedValue({ config: JSON.stringify({ apiKey }) })
    await expect(f.store.record(f.candidate)).rejects.toThrow('LIVE_CREDENTIAL_UNAVAILABLE')
    expect(await f.store.status()).toMatchObject({ configured: false })
  })
  it('revokes the old binding when a newer save cannot read the vault', async () => {
    const f = await fixture()
    await f.store.record(f.candidate)
    f.vault.read.mockRejectedValue(new Error('synthetic-secret-canary'))
    await expect(f.store.record({ ...f.candidate, configurationRevision: 2 })).rejects.toThrow('LIVE_CREDENTIAL_UNAVAILABLE')
    expect(await f.store.status()).toMatchObject({ configured: false, configurationRevision: 2 })
    await expect(readLiveCredentialBinding(f.options)).rejects.toThrow('LIVE_CREDENTIAL_NOT_CONFIGURED')
  })
  it('revokes a repeated binding when secure storage becomes unavailable', async () => {
    const f = await fixture()
    await f.store.record(f.candidate)
    f.vault.read.mockRejectedValue(new Error('native unavailable'))
    await expect(f.store.record(f.candidate)).rejects.toThrow('LIVE_CREDENTIAL_UNAVAILABLE')
    expect(await f.store.status()).toMatchObject({ configured: false, configurationRevision: 1 })
  })
  it('cannot bless changed ciphertext by repeating a committed revision', async () => {
    const f = await fixture()
    await f.store.record(f.candidate)
    f.selected.encrypted = Buffer.from('replacement').toString('base64')
    await writeFile(f.vaultPath, JSON.stringify(f.envelope))
    await expect(f.store.record(f.candidate)).rejects.toThrow('LIVE_CREDENTIAL_CHANGED')
  })
  it('rejects ciphertext replacement during native vault validation', async () => {
    const f = await fixture()
    f.vault.read.mockImplementationOnce(async () => {
      f.selected.encrypted = Buffer.from('changed while awaiting').toString('base64')
      await writeFile(f.vaultPath, JSON.stringify(f.envelope))
      return { config: '{"apiKey":"synthetic-key"}' }
    })
    await expect(f.store.record(f.candidate)).rejects.toThrow('LIVE_CREDENTIAL_CHANGED')
    expect(await f.store.status()).toMatchObject({ configured: false, configurationRevision: 1 })
  })
  it('rejects a record owned by another provider', async () => {
    const f = await fixture()
    f.selected.providerId = 'another-provider'
    await writeFile(f.vaultPath, JSON.stringify(f.envelope))
    await expect(f.store.record(f.candidate)).rejects.toThrow('LIVE_CREDENTIAL_CHANGED')
    expect(f.vault.read).not.toHaveBeenCalled()
  })
  it('rejects a target outside the dedicated campaign', async () => {
    const f = await fixture()
    const other = await fixture()
    await f.store.record(f.candidate)
    await expect(copyBoundCredential({ ...f.options, targetProfile: other.targetProfile })).rejects.toThrow('LIVE_CREDENTIAL_PATH_DENIED')
  })
  it('sanitizes native vault errors', async () => {
    const f = await fixture()
    f.vault.read.mockRejectedValue(new Error('synthetic-secret-canary'))
    await expect(f.store.record(f.candidate)).rejects.toThrow('LIVE_CREDENTIAL_UNAVAILABLE')
  })
  it('rejects candidate secret fields before accessing the vault', async () => {
    const f = await fixture()
    await expect(f.store.record({ ...f.candidate, apiKey: 'not-allowed' } as LiveCredentialCandidate)).rejects.toThrow('LIVE_CREDENTIAL_INVALID_INPUT')
    expect(f.vault.read).not.toHaveBeenCalled()
  })
  it('rejects a competing process and preserves its lock', async () => {
    const f = await fixture()
    await writeFile(`${f.options.bindingPath}.lock`, 'other process')
    await expect(f.store.record(f.candidate)).rejects.toMatchObject({ code: 'LIVE_CREDENTIAL_BUSY' })
    expect(await readFile(`${f.options.bindingPath}.lock`, 'utf8')).toBe('other process')
  })
})
