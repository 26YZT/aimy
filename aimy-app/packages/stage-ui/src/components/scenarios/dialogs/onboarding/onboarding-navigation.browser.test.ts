import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'
import type { App } from 'vue'

import en from '@proj-airi/i18n/locales/en'

import { PiniaColada } from '@pinia/colada'
import { createPinia, disposePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'

import OnboardingScreen from './onboarding.vue'
import StepUserProfile from './step-user-profile.vue'

import { configureLocalOnly } from '../../../../services/local-data-policy'
import { configureProviderSecretStorage } from '../../../../services/provider-secret-storage'
import { useMemoryStore } from '../../../../stores/memory'
import { useAiriCardStore } from '../../../../stores/modules/airi-card'
import { useConsciousnessStore } from '../../../../stores/modules/consciousness'
import { useSpeechStore } from '../../../../stores/modules/speech'
import { useProviderConfigStore } from '../../../../stores/providers/config'
import { useProviderStore } from '../../../../stores/providers/provider'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

let releaseWrite: (() => void) | undefined
let rejectWrite: (() => void) | undefined
let writeCount = 0
const secrets = new Map<string, Record<string, string>>()
configureLocalOnly()
configureProviderSecretStorage({
  async write(input) {
    writeCount++
    await new Promise<void>((resolve, reject) => {
      releaseWrite = resolve
      rejectWrite = () => reject(new Error('synthetic-secret-error-canary'))
    })
    const secretRef = crypto.randomUUID()
    secrets.set(secretRef, input.secrets)
    return { secretRef, revision: 1 }
  },
  async read(input) {
    const value = secrets.get(input.reference.secretRef)
    if (!value)
      throw new Error('Synthetic secret not found')
    return value
  },
  async remove(input) {
    secrets.delete(input.reference.secretRef)
  },
})

const contexts: Array<{ app: App, pinia: ReturnType<typeof createPinia>, runtime: SyncedPiniaRuntime }> = []

function testI18n() {
  return createI18n({ legacy: false, locale: 'en', messages: { en } })
}

async function createStoreContext() {
  const pinia = createPinia()
  const runtime = createSyncedPiniaPlugin({ namespace: `onboarding-nav:${crypto.randomUUID()}`, leadership: 'leader-only', callTimeout: 3000 })
  pinia.use(runtime.plugin)
  const app = createApp({
    setup() {
      useProviderStore()
      useProviderConfigStore()
      useConsciousnessStore()
      useSpeechStore()
      useMemoryStore()
      return () => null
    },
  })
  app.use(testI18n()).use(pinia).use(PiniaColada).mount(document.createElement('div'))
  contexts.push({ app, pinia, runtime })
  await expect.poll(() => runtime.isLeader()).toBe(true)
  const cards = useAiriCardStore(pinia)
  await cards.initialize()
  return { pinia, cards }
}

function disposeContexts() {
  for (const item of contexts.splice(0)) {
    item.app.unmount()
    item.runtime.dispose()
    disposePinia(item.pinia)
  }
}

async function mountOnboarding() {
  const { pinia } = await createStoreContext()
  const configured = vi.fn()
  const screen = await render(OnboardingScreen, {
    props: { localOnly: true, afterModelSteps: [{ id: 'user-profile', component: StepUserProfile }], onConfigured: configured },
    global: { plugins: [pinia, PiniaColada, testI18n()] },
  })
  await screen.getByRole('button', { name: 'Setup with your provider' }).click()
  await screen.getByText('OpenAI Compatible', { exact: true }).first().click()
  await screen.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByPlaceholder('API Key').fill('synthetic-key')
  const ping = screen.getByRole('switch')
  await expect.element(ping).toBeVisible()
  await ping.click()
  return { screen, configured, pinia }
}

beforeEach(() => {
  localStorage.clear()
  writeCount = 0
  releaseWrite = undefined
  rejectWrite = undefined
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.includes('chat/completions')) {
      return Response.json({ id: 'synthetic-response', object: 'chat.completion', model: 'synthetic-chat', choices: [{ index: 0, message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }] })
    }
    return Response.json({ object: 'list', data: [{ id: 'synthetic-chat' }] })
  })
})

afterEach(() => {
  cleanup()
  disposeContexts()
  vi.restoreAllMocks()
  secrets.clear()
  localStorage.clear()
})

describe('onboarding navigation ownership', () => {
  // ROOT CAUSE:
  // Onboarding only changed runtime selections. Empty persisted card defaults replaced them during startup.
  // Save the confirmed selection through the card action before advancing.
  it('restores the selected model through the card after a fresh store context reads the same profile', async () => {
    const { screen, pinia } = await mountOnboarding()
    expect(useAiriCardStore(pinia).moduleDefaults?.consciousness).toEqual({ provider: '', model: '' })
    await screen.getByRole('button', { name: 'Next', exact: true }).click()
    await expect.poll(() => writeCount).toBe(1)
    releaseWrite?.()
    await expect.element(screen.getByText('synthetic-chat', { exact: true }).first()).toBeVisible()
    await screen.getByText('synthetic-chat', { exact: true }).first().click()
    await screen.getByRole('button', { name: 'Save and continue', exact: false }).click()
    await expect.element(screen.getByRole('heading', { name: 'Let me get to know you' })).toBeVisible()
    expect(useConsciousnessStore(pinia).activeProvider).toBe('openai-compatible')
    expect(useConsciousnessStore(pinia).activeModel).toBe('synthetic-chat')
    await expect.poll(() => localStorage.getItem('settings/consciousness/active-model')).toBe('synthetic-chat')

    // Keep native localStorage, but replace every live store and synchronization participant.
    cleanup()
    disposeContexts()
    const restored = await createStoreContext()
    expect(useConsciousnessStore(restored.pinia).activeProvider).toBe('openai-compatible')
    expect(useConsciousnessStore(restored.pinia).activeModel).toBe('synthetic-chat')
    expect(restored.cards.getModules(restored.cards.activeCardId).consciousness).toEqual({ provider: 'openai-compatible', model: 'synthetic-chat' })
    await restored.cards.activateCard(restored.cards.activeCardId)
    expect(useConsciousnessStore(restored.pinia).activeModel).toBe('synthetic-chat')
  })

  it('keeps next disabled through delayed secure save and advances only to model selection after repeated clicks', async () => {
    const { screen, configured, pinia } = await mountOnboarding()
    const next = screen.getByRole('button', { name: 'Next', exact: true })
    await next.click()
    await expect.poll(() => writeCount).toBe(1)
    await expect.element(next).toBeDisabled()
    next.element().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    next.element().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(writeCount).toBe(1)
    expect(configured).not.toHaveBeenCalled()
    releaseWrite?.()
    await expect.element(screen.getByText('synthetic-chat', { exact: true }).first()).toBeVisible()
    const save = screen.getByRole('button', { name: 'Save and continue', exact: false })
    await expect.element(save).toBeDisabled()
    expect(useConsciousnessStore(pinia).activeModel).toBe('')
    expect(configured).not.toHaveBeenCalled()
    await expect.element(screen.getByRole('heading', { name: 'Let me get to know you' })).not.toBeInTheDocument()
    await screen.getByText('synthetic-chat', { exact: true }).first().click()
    await save.click()
    await expect.element(screen.getByRole('heading', { name: 'Let me get to know you' })).toBeVisible()
    expect(configured).not.toHaveBeenCalled()
    await screen.getByRole('button', { name: 'Start chatting without saving these details' }).click()
    await expect.poll(() => configured.mock.calls.length).toBe(1)
  })

  it('can return from models and reuse a saved key without revealing it or writing another secret', async () => {
    const { screen, configured } = await mountOnboarding()
    await screen.getByRole('button', { name: 'Next', exact: true }).click()
    await expect.poll(() => writeCount).toBe(1)
    releaseWrite?.()
    await expect.element(screen.getByText('synthetic-chat', { exact: true }).first()).toBeVisible()
    await screen.getByRole('button').first().click()
    const keyField = page.getByPlaceholder('Securely saved · leave blank to reuse')
    await expect.element(keyField).toHaveValue('')
    await expect.element(screen.getByRole('button', { name: 'Next', exact: true })).toBeEnabled()
    const ping = screen.getByRole('switch')
    await expect.element(ping).toBeVisible()
    await ping.click()
    await screen.getByRole('button', { name: 'Next', exact: true }).click()
    await expect.element(screen.getByText('synthetic-chat', { exact: true }).first()).toBeVisible()
    expect(writeCount).toBe(1)
    expect(configured).not.toHaveBeenCalled()
  })

  it('keeps the configuration draft after a delayed save failure without exposing the raw error', async () => {
    const { screen, configured } = await mountOnboarding()
    await screen.getByRole('button', { name: 'Next', exact: true }).click()
    await expect.poll(() => writeCount).toBe(1)
    rejectWrite?.()
    await expect.element(screen.getByText('Could not finish validating or saving this configuration. Your input is still here. Retry when the connection is ready.')).toBeVisible()
    await expect.element(page.getByPlaceholder('API Key')).toHaveValue('synthetic-key')
    await expect.element(screen.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled()
    expect(document.body.textContent).not.toContain('synthetic-secret-error-canary')
    expect(configured).not.toHaveBeenCalled()
  })
})
