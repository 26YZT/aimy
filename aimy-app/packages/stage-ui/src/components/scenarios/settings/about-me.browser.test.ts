import type { LeadershipMode, SyncedPiniaRuntime } from 'pinia-plugin-synced'
import type { App } from 'vue'

import en from '@proj-airi/i18n/locales/en'
import zhHans from '@proj-airi/i18n/locales/zh-Hans'

import { PiniaColada } from '@pinia/colada'
import { createPinia, disposePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createApp, toRaw } from 'vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import StepUserProfile from '../dialogs/onboarding/step-user-profile.vue'
import StepWelcome from '../dialogs/onboarding/step-welcome.vue'
import AboutMe from './about-me.vue'

import { memoryRepository } from '../../../database/repos/memory.repo'
import { storage } from '../../../database/storage'
import { useMemoryStore } from '../../../stores/memory'
import { useAiriCardStore } from '../../../stores/modules/airi-card'
import { useSpeechStore } from '../../../stores/modules/speech'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'
import '../../../../../../apps/stage-tamagotchi/src/renderer/styles/main.css'

const contexts: Array<{
  app: App
  pinia: ReturnType<typeof createPinia>
  runtime: SyncedPiniaRuntime
  memory: ReturnType<typeof useMemoryStore>
}> = []

function i18n(locale = 'en') {
  return createI18n({ legacy: false, locale, messages: { en, 'zh-Hans': zhHans } })
}

async function context(initialize = true, leadership: LeadershipMode = 'leader-only', namespace = `memory-ui:${crypto.randomUUID()}`) {
  const pinia = createPinia()
  const runtime = createSyncedPiniaPlugin({ namespace, leadership, callTimeout: 3000 })
  pinia.use(runtime.plugin)
  let memory: ReturnType<typeof useMemoryStore> | undefined
  let cards: ReturnType<typeof useAiriCardStore> | undefined
  const app = createApp({
    setup() {
      memory = useMemoryStore()
      cards = useAiriCardStore()
      useSpeechStore()
      return () => null
    },
  })
  app.use(i18n()).use(pinia).use(PiniaColada).mount(document.createElement('div'))
  if (!memory || !cards)
    throw new Error('Memory test stores did not initialize')
  if (leadership === 'leader-only') {
    await expect.poll(() => runtime.isLeader()).toBe(true)
    const characterId = await cards.addCard(structuredClone(toRaw(cards.builtInCard)), 'duplicate')
    await cards.activateCard(characterId)
  }
  const result = { app, pinia, runtime, memory, namespace }
  contexts.push(result)
  if (initialize)
    await memory.initialize(runtime)
  return result
}

beforeEach(() => {
  localStorage.clear()
  document.body.style.backgroundColor = 'var(--bg-color)'
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ data: [], object: 'list' }))
})

afterEach(async () => {
  cleanup()
  for (const item of contexts.splice(0)) {
    const savedScope = item.memory.scope
    await item.memory.dispose()
    item.app.unmount()
    item.runtime.dispose()
    disposePinia(item.pinia)
    if (savedScope)
      await storage.removeItem(`local:memory/v1/${encodeURIComponent(savedScope.principalId)}/${encodeURIComponent(savedScope.characterId)}`)
  }
  vi.restoreAllMocks()
  localStorage.clear()
  document.documentElement.classList.remove('dark')
  document.body.style.removeProperty('background-color')
})

describe('about me and first profile', () => {
  it('keeps a draft while the owner prepares and only continues after durable profile save', async () => {
    await page.viewport(700, 850)
    const item = await context(false)
    const next = vi.fn()
    const screen = await render(StepUserProfile, { props: { onNext: next }, global: { plugins: [item.pinia, PiniaColada, i18n()] } })
    const name = screen.getByRole('textbox', { name: 'What can I call you?' })
    await name.fill('团团')
    await expect.element(screen.getByRole('button', { name: 'Save and start chatting' })).toBeDisabled()
    await item.memory.initialize(item.runtime)
    await expect.element(name).toHaveValue('团团')
    await expect.element(screen.getByRole('button', { name: 'Save and start chatting' })).toBeEnabled()
    await page.screenshot({ path: '__screenshots__/first-profile.png' })
    await screen.getByRole('button', { name: 'Save and start chatting' }).click()
    await expect.poll(() => next.mock.calls.length).toBe(1)
    if (!item.memory.scope)
      throw new Error('No memory scope')
    const persisted = await memoryRepository.read(item.memory.scope)
    expect(persisted?.profile.state).toBe('submitted')
    expect(persisted?.facts[0].text).toContain('团团')
    expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes('chat/completions'))).toBe(false)
  })

  it('can skip profile input without marking a draft as saved', async () => {
    const item = await context(false)
    const next = vi.fn()
    const screen = await render(StepUserProfile, { props: { onNext: next }, global: { plugins: [item.pinia, PiniaColada, i18n()] } })
    await screen.getByRole('textbox', { name: 'What can I call you?' }).fill('未提交名字')
    await screen.getByRole('button', { name: 'Start chatting without saving these details' }).click()
    expect(next).toHaveBeenCalledOnce()
    expect(item.memory.profileState).toBe('unanswered')
    expect(item.memory.facts).toEqual([])
  })

  it('keeps maintenance folded, opens source on demand, and removes only the selected fact', async () => {
    const item = await context()
    await page.viewport(900, 1000)
    await item.memory.submitProfile({ submissionId: 'test-profile', preferredName: '团团', chatPreference: 'listen-first', recentMatter: '', skipped: false })
    const router = createRouter({ history: createMemoryHistory(), routes: [] })
    const screen = await render(AboutMe, { global: { plugins: [item.pinia, PiniaColada, i18n(), router] }, attrs: { style: 'width: 760px; max-width: 100%; padding: 20px;' } })
    await expect.element(screen.getByText('用户希望被称为团团。', { exact: true }).first()).toBeVisible()
    await expect.element(screen.getByRole('button', { name: 'Correct', exact: true, includeHidden: true }).first()).not.toBeVisible()
    await screen.getByRole('button', { name: 'View source' }).first().click()
    await expect.element(screen.getByText('团团', { exact: true })).toBeVisible()
    await screen.getByText('Profile maintenance', { exact: true }).click()
    await expect.element(screen.getByRole('button', { name: 'Correct', exact: true }).first()).toBeVisible()
    await page.screenshot({ path: '__screenshots__/about-me-light.png' })
    await screen.getByRole('button', { name: 'Remove from memory', exact: true }).first().click()
    await expect.poll(() => item.memory.facts.length).toBe(1)
    expect(item.memory.facts[0].category).toBe('boundary')
    await expect.element(screen.getByText('This memory was removed from future recall. Your original chat remains.')).toBeVisible()
  })

  it('persists the pause switch and keeps an existing name readable in a narrow dark view', async () => {
    await page.viewport(390, 860)
    document.documentElement.classList.add('dark')
    const item = await context()
    await item.memory.submitProfile({ submissionId: 'pause-profile', preferredName: '阿言', chatPreference: '', recentMatter: '', skipped: false })
    const router = createRouter({ history: createMemoryHistory(), routes: [] })
    const screen = await render(AboutMe, { global: { plugins: [item.pinia, PiniaColada, i18n('zh-Hans'), router] }, attrs: { style: 'width: 390px; max-width: 100%; padding: 16px;' } })
    const toggle = screen.getByRole('switch', { name: '自动整理新聊天' })
    await toggle.click()
    await expect.poll(() => item.memory.enabled).toBe(false)
    await expect.element(toggle).not.toBeChecked()
    await expect.element(screen.getByText('用户希望被称为阿言。', { exact: true }).first()).toBeVisible()
    await page.screenshot({ path: '__screenshots__/about-me-dark-narrow.png' })
  })

  it('keeps a stale correction draft and does not overwrite a newer fact from another window', async () => {
    const item = await context()
    await item.memory.submitProfile({ submissionId: 'conflict-profile', preferredName: '团团', chatPreference: '', recentMatter: '', skipped: false })
    const router = createRouter({ history: createMemoryHistory(), routes: [] })
    const screen = await render(AboutMe, { global: { plugins: [item.pinia, PiniaColada, i18n(), router] } })
    await screen.getByText('Profile maintenance', { exact: true }).click()
    await screen.getByRole('button', { name: 'Correct', exact: true }).click()
    const draft = screen.getByRole('textbox', { name: 'What is correct now?' })
    await draft.fill('阿言')
    const fact = item.memory.facts[0]
    await item.memory.correctFact({ operationId: 'other-window', factId: fact.factId, expectedFactRevision: fact.revision, text: '小圆' })
    await screen.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.element(screen.getByRole('alert')).toBeVisible()
    await expect.element(draft).toHaveValue('阿言')
    expect(item.memory.facts[0].text).toBe('小圆')
  })

  it.each(['automatic', 'model'] as const)('api-close keeps the same %s policy command after a native storage failure', async (kind) => {
    const item = await context()
    const commands: unknown[] = []
    const unhook = item.memory.$onAction(({ name, args }) => {
      if (name === (kind === 'automatic' ? 'setEnabled' : 'setModelPolicy'))
        commands.push(structuredClone(args[1]))
    })
    const router = createRouter({ history: createMemoryHistory(), routes: [] })
    const screen = await render(AboutMe, { global: { plugins: [item.pinia, PiniaColada, i18n(), router] } })
    const nativePut = IDBObjectStore.prototype.put
    const fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (String(key).includes('memory:v1:'))
        throw new DOMException('Synthetic policy quota fault', 'QuotaExceededError')
      return nativePut.call(this, value, key)
    })
    if (kind === 'model')
      await screen.getByText('Memory organization model', { exact: true }).click()
    const save = kind === 'automatic'
      ? screen.getByRole('switch', { name: 'Organize new chats automatically' })
      : screen.getByRole('button', { name: 'Save memory model' })
    await save.click()
    await expect.element(screen.getByRole('alert')).toBeVisible()
    fault.mockRestore()
    await save.click()
    await expect.element(screen.getByRole('alert')).not.toBeInTheDocument()
    if (kind === 'automatic')
      await expect.poll(() => item.memory.enabled).toBe(false)
    expect(commands).toHaveLength(2)
    expect(commands[0]).toMatchObject({ operationId: expect.any(String), expectedRevision: expect.any(Number), expectedScope: item.memory.scope })
    expect(commands[1]).toEqual(commands[0])
    unhook()
  })

  it('routes profile input from a follower window to the existing memory owner', async () => {
    const leader = await context()
    const follower = await context(false, 'follower-only', leader.namespace)
    await expect.poll(() => follower.runtime.getLeaderId()).toBe(leader.runtime.participantId)
    await expect.poll(() => follower.memory.ready).toBe(true)
    const next = vi.fn()
    const screen = await render(StepUserProfile, { props: { onNext: next }, global: { plugins: [follower.pinia, PiniaColada, i18n()] } })
    await screen.getByRole('textbox', { name: 'What can I call you?' }).fill('朋友')
    await screen.getByRole('button', { name: 'Save and start chatting' }).click()
    await expect.poll(() => next.mock.calls.length).toBe(1)
    await expect.poll(() => leader.memory.facts[0]?.text).toContain('朋友')
    await expect.poll(() => follower.memory.facts[0]?.text).toContain('朋友')
    expect(follower.runtime.isLeader()).toBe(false)
  })

  it('desktop welcome exposes BYOK setup without the upstream account or pricing entry', async () => {
    const item = await context(false)
    const next = vi.fn()
    const screen = await render(StepWelcome, { props: { customProviderSetupEnabled: true, localOnly: true, onNext: next }, global: { plugins: [item.pinia, PiniaColada, i18n()] } })
    await expect.element(screen.getByRole('button', { name: 'Sign in', exact: true })).not.toBeInTheDocument()
    await expect.element(screen.getByRole('link', { name: 'Pricing' })).not.toBeInTheDocument()
    await screen.getByRole('button', { name: 'Setup with your provider' }).click()
    expect(next).toHaveBeenCalledOnce()
  })
})
