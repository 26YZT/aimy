import type { ProviderSecretStorage } from '../../services/provider-secret-storage'

import en from '@proj-airi/i18n/locales/en'

import { createPinia, disposePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'

import { configureLocalOnly } from '../../services/local-data-policy'
import { configureProviderSecretStorage } from '../../services/provider-secret-storage'
import { useProviderConfigStore } from './config'
import { useProviderStore } from './provider'

describe('local provider runtime', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('captures nested local voice settings after a configuration patch and lists real adapter voices', async () => {
    localStorage.clear()
    configureLocalOnly()
    const request = vi.fn<typeof fetch>(async () => Response.json([{ name: 'Synthetic voice', styles: [{ id: 3, name: 'Normal' }] }]))
    vi.stubGlobal('fetch', request)
    const pinia = createPinia()
    let runtime: ReturnType<typeof useProviderStore> | undefined
    let configuration: ReturnType<typeof useProviderConfigStore> | undefined
    const app = createApp({ setup() {
      runtime = useProviderStore()
      configuration = useProviderConfigStore()
      return () => null
    } })
    app.use(createI18n({ legacy: false, locale: 'en', messages: { en } })).use(pinia).mount(document.createElement('div'))
    if (!runtime || !configuration)
      throw new Error('Provider stores were not created')
    try {
      await runtime.initializeProvider('voicevox')
      await configuration.patchProviderConfig('voicevox', { baseUrl: 'http://127.0.0.1:50021/' })
      const captured = runtime.getVoiceCatalogConfiguration('voicevox')
      expect(captured.config.voiceSettings).toEqual({ intonation: 1, pitch: 0, speed: 1, volume: 1 })
      const voices = await runtime.listProviderVoices('voicevox', 'default', captured)
      expect(voices).toEqual([expect.objectContaining({ id: '3', name: 'Synthetic voice / Normal' })])
      expect(String(request.mock.calls.at(-1)?.[0])).toBe('http://127.0.0.1:50021/speakers')
    }
    finally {
      app.unmount()
      disposePinia(pinia)
    }
  })

  it('resolves secure keys for the existing factory, validation and catalog without storing them in runtime state', async () => {
    localStorage.clear()
    configureLocalOnly()
    const records = new Map<string, Record<string, string>>()
    const platform: ProviderSecretStorage = {
      async write(input) {
        const reference = { secretRef: crypto.randomUUID(), revision: (input.previous?.revision ?? 0) + 1 }
        records.set(reference.secretRef, { ...input.secrets })
        return reference
      },
      async read(input) {
        const record = records.get(input.reference.secretRef)
        if (!record)
          throw new Error('Missing synthetic key')
        return { ...record }
      },
      async remove(input) {
        records.delete(input.reference.secretRef)
      },
    }
    configureProviderSecretStorage(platform)
    const request = vi.fn<typeof fetch>(async () => Response.json({ object: 'list', data: [{ id: 'deepseek-flash' }] }))
    vi.stubGlobal('fetch', request)
    const pinia = createPinia()
    let runtime: ReturnType<typeof useProviderStore> | undefined
    let configuration: ReturnType<typeof useProviderConfigStore> | undefined
    const app = createApp({
      setup() {
        configuration = useProviderConfigStore()
        runtime = useProviderStore()
        return () => null
      },
    })
    app.use(createI18n({ legacy: false, locale: 'en', messages: { en } })).use(pinia).mount(document.createElement('div'))
    if (!runtime || !configuration)
      throw new Error('Provider stores were not created')
    try {
      await runtime.initializeProvider('deepseek')
      await configuration.patchProviderConfig('deepseek', { apiKey: 'synthetic-key-first', baseUrl: 'https://example.invalid/v1/' })
      const firstRevision = configuration.getProviderConfigRevision('deepseek')
      const read = vi.spyOn(platform, 'read')
      const provider = await runtime.getChatProviderInstance('deepseek', { reasoning: 'disabled' })
      const readsAfterCreate = read.mock.calls.length
      await runtime.getChatProviderInstance('deepseek', { reasoning: 'disabled' })
      expect(read).toHaveBeenCalledTimes(readsAfterCreate)
      expect(provider.generation('deepseek-flash').config.apiKey).toBe('synthetic-key-first')
      expect(provider.generation('deepseek-flash').config.model).toBe('deepseek-flash')
      await runtime.validateProvider('deepseek')
      await runtime.fetchModelsForProvider('deepseek')
      expect(runtime.getModelsForProvider('deepseek').map(model => model.id)).toContain('deepseek-flash')
      expect(JSON.stringify(pinia.state.value)).not.toContain('synthetic-key-first')
      expect(JSON.stringify(localStorage)).not.toContain('synthetic-key-first')

      await configuration.patchProviderConfig('deepseek', { apiKey: 'synthetic-key-second' })
      expect(configuration.getProviderConfigRevision('deepseek')).toBeGreaterThan(firstRevision)
      const refreshed = await runtime.getChatProviderInstance('deepseek', { reasoning: 'enabled' })
      expect(refreshed.generation('deepseek-flash').config.apiKey).toBe('synthetic-key-second')
      expect(JSON.stringify(pinia.state.value)).not.toContain('synthetic-key-second')
      expect(request).toHaveBeenCalled()
      const errors = vi.spyOn(console, 'error')
      request.mockRejectedValue(new Error('SDK URL contained synthetic-key-second'))
      await runtime.fetchModelsForProvider('deepseek')
      expect(JSON.stringify(pinia.state.value)).not.toContain('synthetic-key-second')
      expect(JSON.stringify(errors.mock.calls)).not.toContain('synthetic-key-second')
      errors.mockRestore()
    }
    finally {
      app.unmount()
      disposePinia(pinia)
    }
  })
})
