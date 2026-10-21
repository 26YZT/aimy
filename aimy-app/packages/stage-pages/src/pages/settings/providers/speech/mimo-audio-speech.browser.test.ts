import type { ProviderSecretStorage } from '@proj-airi/stage-ui/services/provider-secret-storage'

import en from '@proj-airi/i18n/locales/en'

import { PiniaColada } from '@pinia/colada'
import { configureLocalOnly } from '@proj-airi/stage-ui/services/local-data-policy'
import { configureProviderSecretStorage } from '@proj-airi/stage-ui/services/provider-secret-storage'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import MimoSpeechPage from './mimo-audio-speech.vue'

import 'virtual:uno.css'

const providerId = 'mimo-audio-speech'
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
      throw new Error('Synthetic storage is unavailable')
    return { ...record }
  },
  async remove(input) {
    records.delete(input.reference.secretRef)
  },
}

configureLocalOnly()
configureProviderSecretStorage(platform)
const secretRead = vi.spyOn(platform, 'read')

async function renderPage(pinia: ReturnType<typeof createPinia>) {
  await page.viewport(1100, 1100)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
  await router.push('/')
  const screen = await render(MimoSpeechPage, {
    global: {
      plugins: [pinia, PiniaColada, router, createI18n({ legacy: false, locale: 'en', messages: { en } })],
      directives: { motion: {} },
    },
  })
  await useProviderStore(pinia).initializeProvider(providerId)
  return screen
}

function expectNoStoredKey(pinia: ReturnType<typeof createPinia>, key: string) {
  expect(JSON.stringify(pinia.state.value)).not.toContain(key)
  expect(JSON.stringify(localStorage)).not.toContain(key)
}

describe('mimo speech with secure provider storage', () => {
  const stores: Array<ReturnType<typeof createPinia>> = []

  function createStore() {
    const pinia = createPinia()
    stores.push(pinia)
    return pinia
  }

  beforeEach(() => {
    localStorage.clear()
    records.clear()
    secretRead.mockClear()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => {
      throw new Error('Unexpected network request')
    }))
  })

  afterEach(() => {
    for (const pinia of stores.splice(0))
      disposePinia(pinia)
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  // The public configuration deliberately omits the key. The previous page
  // checked that public field, so a successful secure save kept Test Voice disabled.
  it('enables the playground after saving a key without putting it in shared state', async () => {
    const pinia = createStore()
    const screen = await renderPage(pinia)
    const testVoice = screen.getByRole('button', { name: 'Test Voice', exact: true })
    await expect.element(testVoice).toBeDisabled()
    await page.getByPlaceholder('API Key', { exact: true }).fill('synthetic-mimo-key')
    await expect.poll(() => useProviderConfigStore(pinia).getProvider(providerId)?.secretReference).toBeDefined()
    await expect.element(testVoice).toBeEnabled()
    await expect.element(screen.getByText('Please enter an API key to test the voice.')).not.toBeInTheDocument()
    expect(useProviderConfigStore(pinia).getProviderConfig(providerId)?.apiKey).toBeUndefined()
    expectNoStoredKey(pinia, 'synthetic-mimo-key')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('restores the playground from the saved reference after recreating the stores', async () => {
    const original = createStore()
    const first = await renderPage(original)
    const config = useProviderConfigStore(original)
    await config.patchProviderConfig(providerId, { apiKey: 'synthetic-restart-key' })
    await first.unmount()
    disposePinia(original)
    stores.splice(stores.indexOf(original), 1)

    secretRead.mockClear()
    const restarted = createStore()
    const second = await renderPage(restarted)
    await expect.element(second.getByRole('button', { name: 'Test Voice', exact: true })).toBeEnabled()
    expect(secretRead).not.toHaveBeenCalled()
    expectNoStoredKey(restarted, 'synthetic-restart-key')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  // Opening this page previously refreshed every provider catalog and decrypted unrelated saved keys.
  // The page now loads only MiMo's public catalogs.
  it('does not unlock or query another configured provider when opening the static MiMo catalogs', async () => {
    const pinia = createStore()
    const config = useProviderConfigStore(pinia)
    await config.ensureProvider(providerId, providerId, { baseUrl: 'https://api.xiaomimimo.com/v1/', model: 'mimo-v2.5-tts' })
    await config.ensureProvider('deepseek', 'deepseek', { baseUrl: 'https://synthetic.invalid/v1/' })
    await config.patchProviderConfig('deepseek', { apiKey: 'synthetic-other-provider-key' })
    config.setProviderStatus('deepseek', 'configured')
    expect(config.getProvider('deepseek')?.secretReference).toBeDefined()
    secretRead.mockClear()

    await renderPage(pinia)
    await expect.poll(() => useProviderStore(pinia).getModelsForProvider(providerId).length).toBe(3)

    expect(secretRead).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expectNoStoredKey(pinia, 'synthetic-other-provider-key')
  })

  it('preserves a saved voice style until the explicit replacement button is clicked', async () => {
    const pinia = createStore()
    const config = useProviderConfigStore(pinia)
    await config.ensureProvider(providerId, providerId, { baseUrl: 'https://api.xiaomimimo.com/v1/', model: 'mimo-v2.5-tts', stylePrompt: 'Keep my existing voice direction.' })
    const screen = await renderPage(pinia)
    const style = screen.getByPlaceholder('Describe the tone, pacing, emotion, and delivery style...')
    await expect.element(style).toHaveValue('Keep my existing voice direction.')
    expect(config.getProviderConfig(providerId)?.stylePrompt).toBe('Keep my existing voice direction.')
    await screen.getByRole('button', { name: 'Use conversational suggestion (replace current style)', exact: true }).click()
    await expect.element(style).toHaveValue(expect.stringContaining('Speak like a relaxed conversation'))
    expect(secretRead).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('does not unlock storage to display a saved reference and fails an actual preview safely', async () => {
    const pinia = createStore()
    const first = await renderPage(pinia)
    await useProviderConfigStore(pinia).patchProviderConfig(providerId, { apiKey: 'synthetic-lost-key' })
    await first.unmount()
    records.clear()
    secretRead.mockClear()
    const reopened = await renderPage(pinia)
    const testVoice = reopened.getByRole('button', { name: 'Test Voice', exact: true })
    await expect.element(testVoice).toBeEnabled()
    expect(secretRead).not.toHaveBeenCalled()
    await testVoice.click()
    await expect.poll(() => secretRead.mock.calls.length).toBe(1)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expectNoStoredKey(pinia, 'synthetic-lost-key')
  })

  it('uses the saved secret in the real MiMo request adapter', async () => {
    const pinia = createStore()
    const screen = await renderPage(pinia)
    await useProviderConfigStore(pinia).patchProviderConfig(providerId, { apiKey: 'synthetic-request-key', stylePrompt: 'Speak gently.' })
    const request = vi.mocked(globalThis.fetch)
    request.mockResolvedValue(Response.json({ choices: [{ message: { audio: { data: 'UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQIAAACAgA==' } } }] }))
    const testVoice = screen.getByRole('button', { name: 'Test Voice', exact: true })
    await expect.element(testVoice).toBeEnabled()
    await testVoice.click()
    await expect.poll(() => request.mock.calls.length).toBe(1)
    const [url, init] = request.mock.calls[0]
    expect(String(url)).toBe('https://api.xiaomimimo.com/v1/chat/completions')
    expect(new Headers(init?.headers).get('api-key')).toBe('synthetic-request-key')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'mimo-v2.5-tts',
      audio: { voice: 'mimo_default', format: 'wav' },
      messages: [{ role: 'user', content: 'Speak gently.' }, { role: 'assistant', content: 'Hello! This is a test of the Xiaomi MiMo Speech.' }],
    })
    expectNoStoredKey(pinia, 'synthetic-request-key')
  })
})
