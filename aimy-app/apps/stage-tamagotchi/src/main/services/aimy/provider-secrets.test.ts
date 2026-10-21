import type { ProviderSecretStorage } from '@proj-airi/stage-ui/services/provider-secret-storage'

import { Buffer } from 'node:buffer'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { providerSecretsAccessStatus, providerSecretsRead, providerSecretsRetryAccess } from '../../../shared/eventa/aimy-provider-secrets'
import { ProviderSecretVault, registerProviderSecrets } from './provider-secrets'

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (input: unknown, metadata: unknown) => unknown>(),
}))

vi.mock('electron', () => ({ safeStorage: {} }))
vi.mock('@moeru/eventa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@moeru/eventa')>()
  return {
    ...actual,
    defineInvokeHandler: vi.fn((
      _context: unknown,
      event: { sendEvent: { id: string } },
      handler: (input: unknown, metadata: unknown) => unknown,
    ) => {
      ipc.handlers.set(event.sendEvent.id, handler)
      return () => ipc.handlers.delete(event.sendEvent.id)
    }),
  }
})

const directories: string[] = []

afterEach(async () => {
  ipc.handlers.clear()
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

function fakeEncryption() {
  const key = randomBytes(32)
  return {
    isEncryptionAvailable: vi.fn(() => true),
    getSelectedStorageBackend: () => 'unknown' as const,
    encryptString: vi.fn((plain: string) => {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted])
    }),
    decryptString: vi.fn((encrypted: Buffer) => {
      const decipher = createDecipheriv('aes-256-gcm', key, encrypted.subarray(0, 12))
      decipher.setAuthTag(encrypted.subarray(12, 28))
      return Buffer.concat([decipher.update(encrypted.subarray(28)), decipher.final()]).toString('utf8')
    }),
  }
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'aimy-secret-test-'))
  directories.push(directory)
  const filePath = join(directory, 'provider-secrets.json')
  const encryption = fakeEncryption()
  return { directory, filePath, encryption, vault: new ProviderSecretVault({ filePath, encryption }) }
}

describe('encrypted provider vault', () => {
  it('persists ciphertext, restores it in a new owner, and removes only the requested reference', async () => {
    const { vault, filePath, encryption } = await fixture()
    const secrets = { apiKey: 'synthetic-private-key', token: 'synthetic-bearer' }
    const reference = await vault.write({ providerId: 'provider-one', secrets })
    const unrelated = await vault.write({ providerId: 'provider-two', secrets: { apiKey: 'other-synthetic-key' } })

    const bytes = await readFile(filePath, 'utf8')
    expect(bytes).not.toContain(secrets.apiKey)
    expect(bytes).not.toContain(secrets.token)
    expect((await stat(filePath)).mode & 0o777).toBe(0o600)

    const reopened = new ProviderSecretVault({ filePath, encryption })
    await expect(reopened.read({ providerId: 'provider-one', reference })).resolves.toEqual(secrets)
    await reopened.remove({ providerId: 'provider-one', reference })
    await expect(reopened.read({ providerId: 'provider-one', reference })).rejects.toMatchObject({ code: 'not-found' })
    await expect(reopened.read({ providerId: 'provider-two', reference: unrelated })).resolves.toEqual({ apiKey: 'other-synthetic-key' })
    await expect(reopened.remove({ providerId: 'provider-one', reference })).resolves.toBeUndefined()
  })

  it('keeps previous configuration usable and rejects forged revisions and another provider', async () => {
    const { vault } = await fixture()
    const previous = await vault.write({ providerId: 'provider-one', secrets: { apiKey: 'first' } })
    await expect(vault.read({ providerId: 'provider-two', reference: previous })).rejects.toMatchObject({ code: 'not-found' })
    const reference = await vault.write({ providerId: 'provider-one', previous, secrets: { apiKey: 'second' } })
    expect(reference.revision).toBe(2)
    await expect(vault.read({ providerId: 'provider-one', reference: previous })).resolves.toEqual({ apiKey: 'first' })
    const forged = { ...previous, revision: previous.revision + 1 }
    await expect(vault.write({ providerId: 'provider-one', previous: forged, secrets: { apiKey: 'stale' } })).rejects.toMatchObject({ code: 'conflict' })
    await expect(vault.remove({ providerId: 'provider-one', reference: forged })).rejects.toMatchObject({ code: 'conflict' })
    await expect(vault.read({ providerId: 'provider-one', reference })).resolves.toEqual({ apiKey: 'second' })
  })

  it('keeps concurrent prepared references separate until the configuration owner commits', async () => {
    const { vault } = await fixture()
    const previous = await vault.write({ providerId: 'provider-one', secrets: { apiKey: 'initial' } })
    const results = await Promise.allSettled([
      vault.write({ providerId: 'provider-one', previous, secrets: { apiKey: 'first-update' } }),
      vault.write({ providerId: 'provider-one', previous, secrets: { apiKey: 'second-update' } }),
    ])
    expect(results[0].status).toBe('fulfilled')
    expect(results[1].status).toBe('fulfilled')
    if (results[0].status === 'fulfilled' && results[1].status === 'fulfilled')
      expect(results[0].value.secretRef).not.toBe(results[1].value.secretRef)
    await expect(vault.read({ providerId: 'provider-one', reference: previous })).resolves.toEqual({ apiKey: 'initial' })
  })

  it('pauses queued native requests after failure and resumes only after explicit retry', async () => {
    const { vault, encryption } = await fixture()
    const reference = await vault.write({ providerId: 'provider-one', secrets: { apiKey: 'synthetic-only' } })
    const decrypt = encryption.decryptString.getMockImplementation()!
    encryption.decryptString.mockImplementation(() => {
      throw new Error('native synthetic private detail')
    })
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => vault.read({ providerId: 'provider-one', reference })))
    expect(results.every(result => result.status === 'rejected')).toBe(true)
    expect(encryption.decryptString).toHaveBeenCalledTimes(1)
    expect(await vault.getAccessStatus()).toEqual({ state: 'paused', generation: 1 })
    expect(JSON.stringify(results)).not.toContain('synthetic private detail')
    const encryptionCalls = encryption.encryptString.mock.calls.length
    await expect(vault.write({ providerId: 'provider-two', secrets: { apiKey: 'another-synthetic-key' } })).rejects.toMatchObject({ code: 'access-paused' })
    expect(encryption.encryptString).toHaveBeenCalledTimes(encryptionCalls)
    encryption.decryptString.mockImplementation(decrypt)
    await expect(vault.read({ providerId: 'provider-one', reference })).rejects.toMatchObject({ code: 'access-paused' })
    await vault.retryAccess(1)
    expect(await vault.getAccessStatus()).toEqual({ state: 'ready', generation: 2 })
    await expect(vault.read({ providerId: 'provider-one', reference })).resolves.toEqual({ apiKey: 'synthetic-only' })
    expect(encryption.decryptString).toHaveBeenCalledTimes(2)
    await expect(vault.retryAccess(1)).rejects.toMatchObject({ code: 'conflict' })
  })

  it('writes no file when secure encryption is unavailable', async () => {
    const { vault, filePath, encryption } = await fixture()
    encryption.isEncryptionAvailable.mockReturnValue(false)
    await expect(vault.write({ providerId: 'provider-one', secrets: { apiKey: 'synthetic-only' } })).rejects.toMatchObject({ code: 'unavailable' })
    expect(encryption.encryptString).not.toHaveBeenCalled()
    await expect(stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves corrupt data and redacts native encryption errors', async () => {
    const { vault, filePath, encryption } = await fixture()
    const corrupted = '{"schemaVersion": 99, "private": "synthetic-marker"}'
    await writeFile(filePath, corrupted)
    await expect(vault.write({ providerId: 'provider-one', secrets: { apiKey: 'replacement' } })).rejects.toMatchObject({ message: 'Provider secret storage: storage-failed' })
    expect(await readFile(filePath, 'utf8')).toBe(corrupted)
    expect(await vault.getAccessStatus()).toEqual({ state: 'ready', generation: 0 })
    await rm(filePath)
    encryption.encryptString.mockImplementation(() => {
      throw new Error('native error synthetic-marker')
    })
    await expect(vault.write({ providerId: 'provider-one', secrets: { apiKey: 'synthetic-marker' } })).rejects.toMatchObject({ message: 'Provider secret storage: storage-failed' })
    await expect(stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects an atomic replacement failure and removes its own temporary file', async () => {
    const { vault, directory, filePath, encryption } = await fixture()
    const encrypt = encryption.encryptString.getMockImplementation()!
    encryption.encryptString.mockImplementation((plain) => {
      mkdirSync(filePath)
      return encrypt(plain)
    })
    await expect(vault.write({ providerId: 'provider-one', secrets: { apiKey: 'synthetic-only' } })).rejects.toMatchObject({ code: 'storage-failed' })
    expect(await readdir(directory)).toEqual(['provider-secrets.json'])
    expect((await stat(filePath)).isDirectory()).toBe(true)
  })

  it('rejects oversized IPC values without touching encryption or disk', async () => {
    const { vault, filePath, encryption } = await fixture()
    await expect(vault.write({ providerId: 'provider-one', secrets: { apiKey: 'x'.repeat(16_385) } })).rejects.toMatchObject({ code: 'invalid-input' })
    expect(encryption.encryptString).not.toHaveBeenCalled()
    await expect(stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('provider secret IPC capability', () => {
  it('protects public access controls and rechecks queued retry sender authorization', async () => {
    const { vault, encryption } = await fixture()
    const context = {} as Parameters<typeof registerProviderSecrets>[0]['context']
    let granted = true
    const dispose = registerProviderSecrets({ context, vault, authorizeSender: sender => sender.id === 7 && granted })
    const status = ipc.handlers.get(providerSecretsAccessStatus.sendEvent.id)!
    const retry = ipc.handlers.get(providerSecretsRetryAccess.sendEvent.id)!
    expect(() => status(undefined, undefined)).toThrow('permission-denied')
    await expect(retry(0, undefined)).rejects.toThrow('permission-denied')
    const mainFrame = {}
    const sender = { id: 7, mainFrame, isDestroyed: () => false }
    const metadata = { raw: { ipcMainEvent: { sender, senderFrame: mainFrame } } }
    expect(await status(undefined, metadata)).toEqual({ state: 'ready', generation: 0 })
    const stale = retry(0, metadata)
    granted = false
    await expect(stale).rejects.toThrow('permission-denied')
    expect((await vault.getAccessStatus()).generation).toBe(0)
    granted = true
    await expect(retry(0, metadata)).resolves.toEqual({ state: 'ready', generation: 1 })
    expect(encryption.isEncryptionAvailable).not.toHaveBeenCalled()
    expect(encryption.decryptString).not.toHaveBeenCalled()
    expect(encryption.encryptString).not.toHaveBeenCalled()
    dispose()
  })

  it('rejects missing, foreign, destroyed and subframe senders before resolving a secret', async () => {
    const { vault } = await fixture()
    const reference = await vault.write({ providerId: 'provider-one', secrets: { apiKey: 'synthetic-only' } })
    const read = vi.spyOn(vault, 'read')
    // Electron is the external boundary. Only fields used by sender verification are simulated here.
    const context = {} as Parameters<typeof registerProviderSecrets>[0]['context']
    let capabilityGranted = true
    const dispose = registerProviderSecrets({ context, vault, authorizeSender: sender => sender.id === 7 && capabilityGranted })
    const invoke = ipc.handlers.get(providerSecretsRead.sendEvent.id)!
    const mainFrame = {}
    const sender = { id: 7, mainFrame, isDestroyed: () => false }
    const input: Parameters<ProviderSecretStorage['read']>[0] = { providerId: 'provider-one', reference }

    await expect(invoke(input, undefined)).rejects.toThrow('permission-denied')
    await expect(invoke(input, { raw: { ipcMainEvent: { sender: { ...sender, id: 8 }, senderFrame: mainFrame } } })).rejects.toThrow('permission-denied')
    await expect(invoke(input, { raw: { ipcMainEvent: { sender: { ...sender, isDestroyed: () => true }, senderFrame: mainFrame } } })).rejects.toThrow('permission-denied')
    await expect(invoke(input, { raw: { ipcMainEvent: { sender, senderFrame: {} } } })).rejects.toThrow('permission-denied')
    expect(read).not.toHaveBeenCalled()
    await expect(invoke(input, { raw: { ipcMainEvent: { sender, senderFrame: mainFrame } } })).resolves.toEqual({ apiKey: 'synthetic-only' })
    read.mockImplementationOnce(async () => {
      capabilityGranted = false
      return { apiKey: 'synthetic-only' }
    })
    await expect(invoke(input, { raw: { ipcMainEvent: { sender, senderFrame: mainFrame } } })).rejects.toThrow('permission-denied')
    dispose()
    expect(ipc.handlers.size).toBe(0)
  })
})
