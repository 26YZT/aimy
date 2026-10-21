import type { ProviderSecretStorage } from '@proj-airi/stage-ui/services/provider-secret-storage'

import en from '@proj-airi/i18n/locales/en'

import { PiniaColada } from '@pinia/colada'
import { configureLocalOnly } from '@proj-airi/stage-ui/services/local-data-policy'
import { configureProviderSecretStorage } from '@proj-airi/stage-ui/services/provider-secret-storage'
import { getResourcePolicy, installResourcePolicy, ResourcePolicy } from '@proj-airi/stage-ui/services/resource-policy'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { createPinia, disposePinia } from 'pinia'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import InteractiveArea from '../InteractiveArea.vue'
import MessengerWindow from './messenger-window.vue'

import { chatSessionsRepo } from '../../../../../../packages/stage-ui/src/database/repos/chat-sessions.repo'
import { useScreenSharingStore } from '../../stores/screen-sharing'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

const openSettings = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('@proj-airi/electron-vueuse', async importOriginal => ({
  ...await importOriginal<typeof import('@proj-airi/electron-vueuse')>(),
  useElectronEventaInvoke: () => openSettings,
}))
const platform: ProviderSecretStorage = {
  read: vi.fn(async () => { throw new Error('No credentials in this fixture') }),
  write: vi.fn(async () => { throw new Error('No credentials in this fixture') }),
  remove: vi.fn(async () => {}),
  getAccessStatus: vi.fn(async () => ({ state: 'paused' as const, generation: 7 })),
  retryAccess: vi.fn(async () => ({ state: 'ready' as const, generation: 8 })),
}
configureLocalOnly()
configureProviderSecretStorage(platform)

beforeEach(async () => {
  localStorage.clear()
  await chatSessionsRepo.clear('local')
  vi.clearAllMocks()
  await page.viewport(1050, 800)
})

async function fixture(options: { direct?: boolean } = {}) {
  const pinia = createPinia()
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  await router.push('/')
  const container = document.createElement('div')
  container.style.cssText = 'width: 100vw; height: 100vh;'
  document.body.appendChild(container)
  let directArea: InstanceType<typeof InteractiveArea> | undefined
  const host = defineComponent(() => {
    // App creates runtime stores during setup before card initialization.
    useSpeechStore()
    useScreenSharingStore()
    return () => options.direct
      ? h(InteractiveArea, { ref: (instance) => {
          directArea = (instance ?? undefined) as InstanceType<typeof InteractiveArea> | undefined
        } })
      : h(MessengerWindow)
  })
  const screen = await render(host, { container, global: { plugins: [pinia, PiniaColada, i18n, router] } })
  const sessions = useChatSessionStore(pinia)
  const cards = useAiriCardStore(pinia)
  const sharing = useScreenSharingStore(pinia)
  const stop = vi.spyOn(sharing, 'stop')
  await cards.initialize()
  await sessions.initialize()
  const first = await sessions.createSession('default', { setActive: false, title: 'Synthetic first' })
  const second = await sessions.createSession('default', { setActive: false, title: 'Synthetic second' })
  await sessions.setActiveSession(second)
  const create = vi.spyOn(sessions, 'createSession')
  const t = (key: string) => i18n.global.t(`tamagotchi.messenger.${key}`)
  const avatarText = (key: string) => i18n.global.t(`tamagotchi.avatar.${key}`, { name: cards.activeCard?.name || '' })
  const input = () => screen.container.querySelector<HTMLTextAreaElement>('textarea')!
  await expect.poll(() => input()).not.toBeNull()
  onTestFinished(async () => {
    await screen.unmount()
    await sessions.flushPersistence()
    sessions.dispose()
    disposePinia(pinia)
    container.remove()
    await chatSessionsRepo.clear('local')
    localStorage.clear()
  })
  const writeDraft = async (value: string) => screen.getByPlaceholder(i18n.global.t('stage.message')).fill(value)
  function getDirectArea() {
    if (!directArea)
      throw new Error('Direct composer was not mounted')
    return directArea
  }
  return { pinia, screen, sessions, cards, first, second, create, stop, t, input, sharing, writeDraft, getDirectArea, avatarText }
}

async function avatarFile(color = '#e096ac') {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const painter = canvas.getContext('2d')!
  painter.fillStyle = color
  painter.fillRect(0, 0, 64, 64)
  const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'))
  return new File([blob], 'synthetic-avatar.png', { type: 'image/png' })
}
function chooseAvatar(screen: Awaited<ReturnType<typeof fixture>>['screen'], file: File) {
  const input = screen.container.querySelector<HTMLInputElement>('[role="dialog"] input[type="file"]')
  if (!input)
    throw new Error('Avatar file input is unavailable')
  const transfer = new DataTransfer()
  transfer.items.add(file)
  input.files = transfer.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('messenger original runtime integration', () => {
  it('keeps another focused window as the voice and screen target until this window is used again', async () => {
    const { screen, sessions, first, second, input } = await fixture()
    await page.elementLocator(input()).click()
    await expect.poll(() => sessions.interactionTarget?.sessionId).toBe(second)
    const source = sessions.interactionTarget!.sourceId
    await sessions.setInteractionSession(second, 'other-window')
    // A background local session restore must not steal the interaction target.
    await sessions.setActiveSession(first)
    await expect.poll(() => screen.container.querySelector<HTMLTextAreaElement>('textarea')).not.toBeNull()
    expect(sessions.interactionTarget?.sourceId).toBe('other-window')
    expect(sessions.interactionTarget?.sessionId).toBe(second)
    await page.elementLocator(input()).click()
    await expect.poll(() => sessions.interactionTarget?.sourceId).toBe(source)
    expect(sessions.interactionTarget?.sessionId).toBe(first)
  })

  it('preserves a composer across tabs, reads only public access state and routes original settings', async () => {
    const { screen, t, input, writeDraft } = await fixture()
    await writeDraft('Synthetic unsent thought')
    await screen.getByRole('button', { name: t('me'), exact: true }).click()
    expect(input().value).toBe('Synthetic unsent thought')
    await expect.poll(() => vi.mocked(platform.getAccessStatus!).mock.calls.length).toBe(1)
    expect(platform.read).not.toHaveBeenCalled()
    await screen.getByRole('button', { name: t('retryAccess'), exact: true }).click()
    expect(platform.retryAccess).toHaveBeenCalledWith(7)
    expect(platform.read).not.toHaveBeenCalled()
    await screen.getByRole('button', { name: t('myProfile'), exact: true }).click()
    expect(openSettings).toHaveBeenCalledWith({ route: '/settings/memory' })
    await screen.getByRole('button', { name: t('allSettings'), exact: true }).click()
    expect(openSettings).toHaveBeenCalledWith({ route: '/settings' })
    await screen.getByRole('button', { name: t('chats'), exact: true }).click()
    expect(input().value).toBe('Synthetic unsent thought')
  })

  it('uses original session actions, filters another user and keeps drafts with their conversation', async () => {
    const { screen, sessions, first, second, create, stop, t, input, sharing, writeDraft } = await fixture()
    sessions.sessionMetas.foreign = { sessionId: 'foreign', userId: 'other-user', characterId: 'default', title: 'Other private session', createdAt: 1, updatedAt: 1 }
    await expect.element(screen.getByText('Other private session')).not.toBeInTheDocument()
    await writeDraft('Draft for second only')
    await screen.getByRole('button', { name: /Synthetic first/ }).click()
    await expect.poll(() => sessions.activeSessionId).toBe(first)
    expect(stop).toHaveBeenCalledOnce()
    await expect.poll(() => input().value).toBe('')
    await screen.getByRole('button', { name: /Synthetic second/ }).click()
    await expect.poll(() => sessions.activeSessionId).toBe(second)
    await expect.poll(() => input().value).toBe('Draft for second only')
    await screen.getByRole('button', { name: t('newChat'), exact: true }).click()
    await expect.poll(() => create.mock.calls.length).toBe(1)
    expect(create).toHaveBeenCalledWith('default', { setActive: false })
    await expect.poll(() => sessions.activeSessionId).not.toBe(second)
    await expect.poll(() => input().value).toBe('')
    const selected = sessions.activeSessionId
    sharing.status = 'sharing'
    await screen.getByRole('button', { name: /Synthetic first/ }).click()
    expect(sessions.activeSessionId).toBe(selected)
    await expect.element(screen.getByRole('alert')).toHaveTextContent(t('navigationFailed'))
    sharing.status = 'off'
  })

  it('selects existing character cards and discards drafts at an account boundary', async () => {
    const { pinia, screen, sessions, cards, second, t, input, writeDraft } = await fixture()
    const nova = await cards.addCard({ name: 'Synthetic Nova', version: '1' }, 'scratch')
    await writeDraft('Previous character draft')
    await screen.getByRole('button', { name: t('contacts'), exact: true }).click()
    await screen.getByRole('button', { name: /^Synthetic Nova/ }).click()
    await expect.poll(() => cards.activeCardId).toBe(nova)
    await expect.poll(() => sessions.sessionMetas[sessions.activeSessionId]?.characterId).toBe(nova)
    await expect.poll(() => input().value).toBe('')
    await screen.getByRole('button', { name: /Synthetic second/ }).click()
    await expect.poll(() => sessions.activeSessionId).toBe(second)
    await expect.poll(() => input().value).toBe('Previous character draft')
    const auth = useAuthStore(pinia)
    const otherId = `synthetic-user-${crypto.randomUUID()}`
    auth.user = { id: otherId, name: 'Synthetic user', email: 'synthetic@example.invalid', emailVerified: false, createdAt: new Date(), updatedAt: new Date() }
    await expect.poll(() => sessions.sessionMetas[sessions.activeSessionId]?.userId).toBe(otherId)
    await expect.poll(() => input().value).toBe('')
    auth.user = null
    await expect.poll(() => sessions.sessionMetas[sessions.activeSessionId]?.userId).toBe('local')
    await screen.getByRole('button', { name: /Synthetic second/ }).click()
    await expect.poll(() => sessions.activeSessionId).toBe(second)
    await expect.poll(() => input().value).toBe('')
    await chatSessionsRepo.clear(otherId)
  })

  it('keeps the latest draft after reselecting the same conversation and then switching externally', async () => {
    const { screen, sessions, first, second, input, writeDraft } = await fixture()
    await writeDraft('Before reselecting the same conversation')
    await screen.getByRole('button', { name: /Synthetic second/ }).click()
    await expect.poll(() => screen.container.querySelector('[aria-busy="true"]')).toBeNull()
    await writeDraft('Latest edit after the no-op navigation')
    await sessions.setActiveSession(first)
    await expect.poll(() => input().value).toBe('')
    await sessions.setActiveSession(second)
    await expect.poll(() => input().value).toBe('Latest edit after the no-op navigation')
  })

  it('does not navigate back or write a late automatic draft after the selection changes', async () => {
    const { sessions, first, second, input, getDirectArea } = await fixture({ direct: true })
    const pending = getDirectArea().restoreDraft({ sessionId: second, text: 'Late stale content', attachments: [] }, { navigate: false })
    await sessions.setActiveSession(first)
    await expect(pending).resolves.toBe(false)
    expect(sessions.activeSessionId).toBe(first)
    expect(input().value).toBe('')
    // Existing mode handovers still navigate when the new option is omitted.
    await expect(getDirectArea().restoreDraft({ sessionId: second, text: 'Intentional handover', attachments: [] })).resolves.toBe(true)
    expect(sessions.activeSessionId).toBe(second)
    expect(input().value).toBe('Intentional handover')
  })

  it('edits and removes the original card avatar, and keeps the previous image when persistence fails', async () => {
    const { screen, cards, avatarText } = await fixture()
    const original = structuredClone(JSON.parse(JSON.stringify(cards.activeCard)))
    await screen.getByRole('button', { name: avatarText('edit'), exact: true }).click()
    chooseAvatar(screen, await avatarFile())
    const save = screen.getByRole('button', { name: avatarText('save'), exact: true })
    await expect.element(save).toBeEnabled()
    if (import.meta.env.VITE_AIMY_AVATAR_SCREENSHOTS)
      await page.screenshot({ path: '/tmp/aimy-avatar-21/avatar-editor.png' })
    await save.click()
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
    const saved = cards.activeCard?.metadata?.avatar
    expect(saved).toMatch(/^data:image\/webp;base64,/)
    expect(screen.container.querySelector<HTMLImageElement>('.messenger-header-avatar img')?.src).toBe(saved)
    expect(cards.activeCard?.extensions).toEqual(original.extensions)

    await screen.getByRole('button', { name: avatarText('edit'), exact: true }).click()
    chooseAvatar(screen, await avatarFile('#16354b'))
    await expect.element(save).toBeEnabled()
    const originalSet = Storage.prototype.setItem
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'airi-cards')
        throw new DOMException('Synthetic full storage', 'QuotaExceededError')
      originalSet.call(this, key, value)
    })
    try {
      await save.click()
      await expect.element(screen.getByRole('alert')).toHaveTextContent(avatarText('errors.storage'))
      expect(cards.activeCard?.metadata?.avatar).toBe(saved)
    }
    finally { storage.mockRestore() }
    await screen.getByRole('button', { name: avatarText('cancel'), exact: true }).click()
    await screen.getByRole('button', { name: avatarText('edit'), exact: true }).click()
    await screen.getByRole('button', { name: avatarText('remove'), exact: true }).click()
    await save.click()
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
    expect(cards.activeCard?.metadata?.avatar).toBeUndefined()
    expect(cards.activeCard?.extensions).toEqual(original.extensions)
  })

  it('cancels a pending image when the dialog closes or the character changes', async () => {
    const { screen, cards, avatarText } = await fixture()
    const originalDecode = HTMLImageElement.prototype.decode
    let gate = Promise.withResolvers<void>()
    let started = Promise.withResolvers<void>()
    const decode = vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementationOnce(async function (this: HTMLImageElement) {
      await originalDecode.call(this)
      started.resolve()
      await gate.promise
    })
    await screen.getByRole('button', { name: avatarText('edit'), exact: true }).click()
    chooseAvatar(screen, await avatarFile())
    await started.promise
    await screen.getByRole('button', { name: avatarText('cancel'), exact: true }).click()
    gate.resolve()
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
    expect(cards.activeCard?.metadata?.avatar).toBeUndefined()

    gate = Promise.withResolvers<void>()
    started = Promise.withResolvers<void>()
    decode.mockImplementationOnce(async function (this: HTMLImageElement) {
      await originalDecode.call(this)
      started.resolve()
      await gate.promise
    })
    const alternate = await cards.addCard({ name: 'Avatar switch target', version: '1.0.0' }, 'scratch')
    await screen.getByRole('button', { name: avatarText('edit'), exact: true }).click()
    chooseAvatar(screen, await avatarFile())
    await started.promise
    await cards.activateCard(alternate)
    gate.resolve()
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
    expect(cards.cards.get('default')?.metadata?.avatar).toBeUndefined()
    decode.mockRestore()
  })

  it('cancels an in-flight save and permits a newer save before the old decoder finishes', async () => {
    const { screen, cards, avatarText } = await fixture()
    await screen.getByRole('button', { name: avatarText('edit'), exact: true }).click()
    chooseAvatar(screen, await avatarFile())
    const save = screen.getByRole('button', { name: avatarText('save'), exact: true })
    await expect.element(save).toBeEnabled()
    const gate = Promise.withResolvers<void>()
    const started = Promise.withResolvers<void>()
    const original = HTMLImageElement.prototype.decode
    const decoding = vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementationOnce(async function (this: HTMLImageElement) {
      await original.call(this)
      started.resolve()
      await gate.promise
    })
    const updating = vi.spyOn(cards, 'updateCardAvatar')
    const cancelling = vi.spyOn(cards, 'cancelCardAvatar')
    onTestFinished(() => {
      gate.resolve()
      decoding.mockRestore()
    })
    await save.click()
    await started.promise
    await screen.getByRole('button', { name: avatarText('cancel'), exact: true }).click()
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
    expect(cancelling).toHaveBeenCalledWith(expect.objectContaining({ requestId: updating.mock.calls[0][0].requestId }))
    expect(cards.activeCard?.metadata?.avatar).toBeUndefined()

    await screen.getByRole('button', { name: avatarText('edit'), exact: true }).click()
    chooseAvatar(screen, await avatarFile('#25354a'))
    await expect.element(save).toBeEnabled()
    await save.click()
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
    const latest = cards.activeCard?.metadata?.avatar
    expect(latest).toMatch(/^data:image\/webp;base64,/)
    gate.resolve()
    const firstResult = updating.mock.results[0]
    if (firstResult.type !== 'return')
      throw new Error('Expected the original save promise')
    await expect(firstResult.value).rejects.toThrow('changed')
    expect(cards.activeCard?.metadata?.avatar).toBe(latest)
  })

  it.each(['unmount', 'revoke'] as const)('revokes a submitted avatar before %s completes', async (reason) => {
    if (reason === 'revoke') {
      if (!getResourcePolicy())
        installResourcePolicy(new ResourcePolicy({ setEnabled: async () => getResourcePolicy()!.state }))
      const policy = getResourcePolicy()!
      policy.apply({ ...policy.state, revision: policy.state.revision + 1, appEpoch: policy.state.appEpoch + 1, active: true, reason: 'fixture' })
    }
    const { screen, cards, avatarText } = await fixture()
    await screen.getByRole('button', { name: avatarText('edit'), exact: true }).click()
    chooseAvatar(screen, await avatarFile())
    const save = screen.getByRole('button', { name: avatarText('save'), exact: true })
    await expect.element(save).toBeEnabled()
    const gate = Promise.withResolvers<void>()
    const started = Promise.withResolvers<void>()
    const original = HTMLImageElement.prototype.decode
    const decoding = vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementationOnce(async function (this: HTMLImageElement) {
      await original.call(this)
      started.resolve()
      await gate.promise
    })
    onTestFinished(() => {
      gate.resolve()
      decoding.mockRestore()
    })
    const updating = vi.spyOn(cards, 'updateCardAvatar')
    const cancelling = vi.spyOn(cards, 'cancelCardAvatar')
    await save.click()
    await started.promise
    if (reason === 'unmount') {
      await screen.unmount()
    }
    else {
      const policy = getResourcePolicy()!
      policy.apply({ ...policy.state, revision: policy.state.revision + 1, appEpoch: policy.state.appEpoch + 1, active: false, reason: 'window-hidden' })
    }
    await expect.poll(() => cancelling.mock.calls.length).toBe(1)
    gate.resolve()
    const result = updating.mock.results[0]
    if (result.type !== 'return')
      throw new Error('Expected a pending avatar save')
    await expect(result.value).rejects.toThrow('changed')
    expect(cards.activeCard?.metadata?.avatar).toBeUndefined()
  })

  it('opens a contact avatar without activating it and closes after that card is deleted', async () => {
    const { screen, cards, t } = await fixture()
    const target = await cards.addCard({ name: 'Avatar removable', version: '1.0.0' }, 'scratch')
    const active = cards.activeCardId
    await screen.getByRole('button', { name: t('contacts'), exact: true }).click()
    const row = Array.from(screen.container.querySelectorAll('.messenger-contact-row')).find(item => item.textContent?.includes('Avatar removable'))
    const edit = row?.querySelector<HTMLButtonElement>('.messenger-avatar-edit')
    if (!edit)
      throw new Error('Contact avatar button is unavailable')
    edit.click()
    await expect.element(screen.getByRole('dialog')).toBeVisible()
    expect(cards.activeCardId).toBe(active)
    await cards.removeCard(target)
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
    expect(cards.activeCardId).toBe(active)
  })

  it('renders the original chat and settings at wide and narrow window sizes', async () => {
    const { pinia, screen, sessions, second, t, writeDraft } = await fixture()
    const consciousness = useConsciousnessStore(pinia)
    consciousness.activeProvider = 'openai'
    consciousness.activeModel = 'synthetic-visual-only'
    sessions.appendSessionMessage(second, { id: 'visual-user', role: 'user', content: '今天终于忙完了，想和你聊一会儿。', createdAt: Date.now() })
    sessions.appendSessionMessage(second, { id: 'visual-assistant', role: 'assistant', content: '辛苦啦。先歇一会儿，今天有什么想和我说的？', createdAt: Date.now(), slices: [], tool_results: [] })
    await expect.element(screen.getByTestId('chat-history-layer').getByText('辛苦啦。先歇一会儿，今天有什么想和我说的？', { exact: true })).toBeVisible()
    const composer = screen.container.querySelector('[data-testid="chat-composer-actions"]')!.parentElement!
    expect(composer.getBoundingClientRect().height).toBeLessThan(70)
    await writeDraft('第一行\n第二行\n第三行\n第四行')
    await expect.poll(() => composer.getBoundingClientRect().height).toBeGreaterThan(90)
    await writeDraft('')
    await expect.poll(() => composer.getBoundingClientRect().height).toBeLessThan(70)
    if (import.meta.env.VITE_AIMY_MESSENGER_SCREENSHOTS)
      await page.screenshot({ path: '__screenshots__/mastergo-messenger-wide.png' })
    await screen.getByRole('button', { name: t('me'), exact: true }).click()
    if (import.meta.env.VITE_AIMY_MESSENGER_SCREENSHOTS)
      await page.screenshot({ path: '__screenshots__/mastergo-messenger-me.png' })
    await screen.getByRole('button', { name: t('chats'), exact: true }).click()
    await page.viewport(390, 720)
    await screen.getByRole('button', { name: /Synthetic second/ }).click()
    await expect.element(screen.getByTestId('chat-history-layer').getByText('辛苦啦。先歇一会儿，今天有什么想和我说的？', { exact: true })).toBeVisible()
    await expect.poll(() => screen.container.querySelector('[aria-busy="true"]')).toBeNull()
    await expect.poll(() => [...screen.container.querySelectorAll('.chat-message-item')].every(el => getComputedStyle(el).opacity === '1')).toBe(true)
    if (import.meta.env.VITE_AIMY_MESSENGER_SCREENSHOTS)
      await page.screenshot({ path: '__screenshots__/mastergo-messenger-narrow.png' })
    expect(screen.container.querySelector('[data-testid="voice-input-button"]')).not.toBeNull()
    expect(screen.container.scrollWidth).toBeLessThanOrEqual(391)
    expect(platform.read).not.toHaveBeenCalled()
  })
})
