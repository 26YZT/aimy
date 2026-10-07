import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSettingsStore } from './settings-store'

const secretStorage = { isEncryptionAvailable: () => true, encryptString: (key: string) => Buffer.from(key.split('').reverse().join('')), decryptString: (buffer: Buffer) => buffer.toString().split('').reverse().join('') }
const input = { model: 'test-model', visionModel: 'vision-model', baseUrl: 'http://127.0.0.1:1234/v1', api: 'chat-completions' as const, apiKey: 'unique-fake-test-key' }
describe('desktop private settings', () => {
  it('encrypts keys, never returns them, and restores config in a new owner', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aimy-settings-'))
    try {
      const store = await createSettingsStore(dir, secretStorage)
      expect((await store.save(input)).ok).toBe(true)
      expect(JSON.stringify(store.publicSettings())).not.toContain(input.apiKey)
      expect(await readFile(join(dir, 'settings-v1.json'), 'utf8')).not.toContain(input.apiKey)
      const restored = await createSettingsStore(dir, secretStorage)
      expect(restored.privateSettings().apiKey).toBe(input.apiKey)
      expect(restored.publicSettings().configured).toBe(true)
      await restored.save({ ...input, model: 'changed', apiKey: '' })
      expect(restored.privateSettings().apiKey).toBe(input.apiKey)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('serializes config and bounds without losing an awaited key write', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aimy-settings-'))
    try {
      const store = await createSettingsStore(dir, secretStorage)
      await Promise.all([store.save(input), store.setBounds({ x: 3, y: 4, width: 1000, height: 720 })])
      const restored = await createSettingsStore(dir, secretStorage)
      expect(restored.publicSettings().configured).toBe(true)
      expect(restored.bounds()?.x).toBe(3)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('refuses plaintext fallback when system encryption is unavailable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aimy-settings-'))
    try {
      const store = await createSettingsStore(dir, { ...secretStorage, isEncryptionAvailable: () => false })
      expect((await store.save(input)).ok).toBe(false)
      expect(store.publicSettings().configured).toBe(false)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('keeps corrupted config and creates a backup only on user save', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aimy-settings-'))
    try {
      await writeFile(join(dir, 'settings-v1.json'), 'corrupted')
      const store = await createSettingsStore(dir, secretStorage)
      expect(store.publicSettings().notice).toBeTruthy()
      expect(await readFile(join(dir, 'settings-v1.json'), 'utf8')).toBe('corrupted')
      await store.setBounds({ x: 3, y: 4, width: 1000, height: 720 })
      expect(await readFile(join(dir, 'settings-v1.json'), 'utf8')).toBe('corrupted')
      await expect(readFile(join(dir, 'settings-v1.json.bak'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      expect(store.publicSettings().notice).toBeTruthy()
      await store.save(input)
      expect(await readFile(join(dir, 'settings-v1.json.bak'), 'utf8')).toBe('corrupted')
      expect((await createSettingsStore(dir, secretStorage)).bounds()?.x).toBe(3)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('keeps chat, ASR and TTS credentials independent across concurrent saves and reload', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aimy-settings-audio-'))
    try {
      const store = await createSettingsStore(dir, secretStorage)
      await store.save(input)
      await store.saveAudio({ kind: 'asr', model: 'asr-fixture', baseUrl: 'http://127.0.0.1:1235/v1/', apiKey: '' })
      expect(store.publicSettings().asr?.configured).toBe(false)
      expect(store.privateMediaSettings('asr').apiKey).toBe('')
      await Promise.all([
        store.saveAudio({ kind: 'asr', model: 'asr-fixture', baseUrl: 'http://127.0.0.1:1235/v1/', apiKey: 'fake-asr-independent' }),
        store.saveAudio({ kind: 'tts', model: 'tts-fixture', baseUrl: 'http://127.0.0.1:1236/v1/', voice: 'fixture-voice', apiKey: 'fake-tts-independent' }),
        store.setBounds({ x: 4, y: 7, width: 900, height: 700 }),
      ])
      const restored = await createSettingsStore(dir, secretStorage)
      expect(restored.privateSettings().apiKey).toBe(input.apiKey)
      expect(restored.privateMediaSettings('asr').apiKey).toBe('fake-asr-independent')
      expect(restored.privateMediaSettings('tts').apiKey).toBe('fake-tts-independent')
      expect(restored.publicSettings().asr?.configured).toBe(true)
      expect(restored.publicSettings().tts?.configured).toBe(true)
      const publicAndDisk = JSON.stringify(restored.publicSettings()) + await readFile(join(dir, 'settings-v1.json'), 'utf8')
      for (const fake of [input.apiKey, 'fake-asr-independent', 'fake-tts-independent']) expect(publicAndDisk).not.toContain(fake)
      await restored.saveAudio({ kind: 'tts', model: 'tts-changed', baseUrl: '', voice: 'fixture-next', apiKey: '' })
      expect(restored.privateMediaSettings('tts').apiKey).toBe('fake-tts-independent')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('does not save audio configuration with missing voice or credentials in URL', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aimy-settings-audio-'))
    try {
      const store = await createSettingsStore(dir, secretStorage)
      expect((await store.saveAudio({ kind: 'tts', model: 'm', baseUrl: '', apiKey: 'fake-audio-key' })).ok).toBe(false)
      expect((await store.saveAudio({ kind: 'asr', model: 'm', baseUrl: 'https://user:pass@fixture.invalid/v1/', apiKey: 'fake-audio-key' })).ok).toBe(false)
      expect((await store.saveAudio({ kind: 'asr', model: 'm', baseUrl: 'https://fixture.invalid/v1/?key=x', apiKey: 'fake-audio-key' })).ok).toBe(false)
      expect(store.publicSettings().asr?.configured).toBe(false)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})
