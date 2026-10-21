import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'

import { PiniaColada } from '@pinia/colada'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'

import { CHARACTER_CARD_SYNC_FLAG } from '../../libs/feature-flags'
import { configureLocalOnly } from '../../services/local-data-policy'
import { useAuthStore } from '../auth'
import { useFeatureFlagsStore } from '../feature-flags'
import { useAiriCardStore } from './airi-card'
import { useSpeechStore } from './speech'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ locale: { value: 'en' }, t: (key: string) => key }) }))
configureLocalOnly()
const contexts: Array<{ pinia: ReturnType<typeof createPinia>, runtime?: SyncedPiniaRuntime }> = []

function context(runtime?: SyncedPiniaRuntime) {
  const pinia = createPinia()
  if (runtime)
    pinia.use(runtime.plugin)
  createApp({}).use(pinia).use(PiniaColada)
  setActivePinia(pinia)
  contexts.push({ pinia, runtime })
  return { pinia, cards: useAiriCardStore(pinia), auth: useAuthStore(pinia), speech: useSpeechStore(pinia) }
}
function thumbnail() {
  const canvas = document.createElement('canvas')
  canvas.width = 16
  canvas.height = 16
  canvas.getContext('2d')!.fillRect(0, 0, 16, 16)
  return canvas.toDataURL('image/png')
}
function input(avatar: string | null, expectedAvatar: string | null = null, cardId = 'default') {
  return { cardId, ownerId: 'local', activeCardId: 'default', avatar, expectedAvatar }
}
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new Error('Unexpected network')
  }))
})
afterEach(() => {
  for (const { runtime, pinia } of contexts.splice(0).reverse()) {
    runtime?.dispose()
    disposePinia(pinia)
  }
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('avatar updates use the original AIRI card owner', () => {
  it('replicates a follower update, restores a new owner, removes only the avatar and leaves modules alone', async () => {
    const namespace = `avatar-${crypto.randomUUID()}`
    const leaderRuntime = createSyncedPiniaPlugin({ namespace, leadership: 'leader-only' })
    const leader = context(leaderRuntime)
    await expect.poll(() => leaderRuntime.isLeader()).toBe(true)
    await leader.cards.initialize()
    await leader.cards.updateCard('default', { ...leader.cards.activeCard!, metadata: { note: 'preserved' } })
    await nextTick()
    const before = JSON.stringify(leader.cards.activeCard)
    const applySpeech = vi.spyOn(leader.speech, 'selectProviderModel')
    const follower = context(createSyncedPiniaPlugin({ namespace, leadership: 'follower-only' }))
    await expect.poll(() => follower.cards.activeCard?.metadata?.note).toBe('preserved')
    const avatar = thumbnail()
    await follower.cards.updateCardAvatar(input(avatar))
    await expect.poll(() => leader.cards.activeCard?.metadata?.avatar).toBe(avatar)
    await expect.poll(() => follower.cards.activeCard?.metadata?.avatar).toBe(avatar)
    expect(applySpeech).not.toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem('airi-cards')!).find(([id]: [string]) => id === 'default')[1].metadata.avatar).toBe(avatar)
    const reopened = context()
    expect(reopened.cards.activeCard?.metadata?.avatar).toBe(avatar)
    await reopened.cards.updateCardAvatar(input(null, avatar))
    expect(reopened.cards.activeCard?.metadata?.avatar).toBeUndefined()
    expect(JSON.stringify(reopened.cards.activeCard)).toBe(before)
  })

  it('preserves the current avatar when an older non-avatar editor saves later', async () => {
    const { cards } = context()
    await cards.initialize()
    const first = thumbnail()
    await cards.updateCardAvatar(input(first))
    const stale = JSON.parse(JSON.stringify(cards.activeCard))
    const canvas = document.createElement('canvas')
    canvas.width = 8
    canvas.height = 8
    const second = canvas.toDataURL('image/png')
    await cards.updateCardAvatar(input(second, first))
    await cards.updateCard('default', { ...stale, name: 'New editor name' }, { preserveAvatar: true })
    expect(cards.activeCard?.metadata?.avatar).toBe(second)
    expect(cards.activeCard?.name).toBe('New editor name')
    await cards.updateCardAvatar(input(null, second))
    await cards.updateCard('default', stale, { preserveAvatar: true })
    expect(cards.activeCard?.metadata?.avatar).toBeUndefined()
    expect(stale.metadata?.avatar).toBe(first)
    // Existing callers without the option retain their full-card update behavior.
    await cards.updateCard('default', { ...stale, metadata: { ...stale.metadata, avatar: first } })
    expect(cards.activeCard?.metadata?.avatar).toBe(first)
  })

  it('cancels through a second window before arrival and while the leader decodes', async () => {
    const namespace = `avatar-cancel-${crypto.randomUUID()}`
    const leaderRuntime = createSyncedPiniaPlugin({ namespace, leadership: 'leader-only' })
    const leader = context(leaderRuntime)
    await expect.poll(() => leaderRuntime.isLeader()).toBe(true)
    await leader.cards.initialize()
    await nextTick()
    const originalBytes = localStorage.getItem('airi-cards')
    const follower = context(createSyncedPiniaPlugin({ namespace, leadership: 'follower-only' }))
    await expect.poll(() => follower.cards.activeCard).toBeDefined()
    const early = { requestId: crypto.randomUUID(), requestedAt: Date.now(), ownerId: 'local' }
    await follower.cards.cancelCardAvatar(early)
    await expect(follower.cards.updateCardAvatar({ ...input(thumbnail()), ...early })).rejects.toThrow('changed')

    const gate = Promise.withResolvers<void>()
    const decoding = Promise.withResolvers<void>()
    const original = HTMLImageElement.prototype.decode
    vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementationOnce(async function (this: HTMLImageElement) {
      await original.call(this)
      decoding.resolve()
      await gate.promise
    })
    const token = { requestId: crypto.randomUUID(), requestedAt: Date.now(), ownerId: 'local' }
    const pending = follower.cards.updateCardAvatar({ ...input(thumbnail()), ...token })
    await decoding.promise
    await expect(follower.cards.cancelCardAvatar(token)).resolves.toBe(true)
    await expect(pending).rejects.toThrow('changed')
    gate.resolve()
    expect(leader.cards.activeCard?.metadata?.avatar).toBeUndefined()
    expect(follower.cards.activeCard?.metadata?.avatar).toBeUndefined()
    expect(localStorage.getItem('airi-cards')).toBe(originalBytes)

    const fresh = { requestId: crypto.randomUUID(), requestedAt: Date.now(), ownerId: 'local' }
    const image = thumbnail()
    await follower.cards.updateCardAvatar({ ...input(image), ...fresh })
    await follower.cards.cancelCardAvatar(token)
    await expect(follower.cards.cancelCardAvatar(fresh)).resolves.toBe(false)
    expect(leader.cards.activeCard?.metadata?.avatar).toBe(image)
  })

  it('does not publish a failed storage write', async () => {
    const { cards } = context()
    await cards.initialize()
    await nextTick()
    const before = JSON.stringify(cards.activeCard)
    const persisted = localStorage.getItem('airi-cards')
    const original = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'airi-cards')
        throw new DOMException('Synthetic full storage', 'QuotaExceededError')
      original.call(this, key, value)
    })
    await expect(cards.updateCardAvatar(input(thumbnail()))).rejects.toThrow('storage')
    expect(JSON.stringify(cards.activeCard)).toBe(before)
    expect(localStorage.getItem('airi-cards')).toBe(persisted)
  })

  it('merges against the latest fields and rejects a conflicting avatar', async () => {
    const { cards } = context()
    await cards.initialize()
    const gate = Promise.withResolvers<void>()
    const decoding = Promise.withResolvers<void>()
    const original = HTMLImageElement.prototype.decode
    vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementationOnce(async function (this: HTMLImageElement) {
      await original.call(this)
      decoding.resolve()
      await gate.promise
    })
    const avatar = thumbnail()
    const updating = cards.updateCardAvatar(input(avatar))
    await decoding.promise
    await cards.updateCard('default', { ...cards.activeCard!, description: 'Concurrent newer description', metadata: { note: 'new metadata' } })
    gate.resolve()
    await updating
    expect(cards.activeCard?.description).toBe('Concurrent newer description')
    expect(cards.activeCard?.metadata).toEqual({ note: 'new metadata', avatar })
    await expect(cards.updateCardAvatar(input(null, 'stale-avatar'))).rejects.toThrow('changed')
    expect(cards.activeCard?.metadata?.avatar).toBe(avatar)
  })

  it('rejects a decoded result after a role change and keeps old cloud flags offline', async () => {
    const { cards, pinia, auth } = context()
    await cards.initialize()
    const alternate = await cards.addCard({ name: 'Synthetic alternate', version: '1.0.0' }, 'scratch')
    const gate = Promise.withResolvers<void>()
    const decoding = Promise.withResolvers<void>()
    const original = HTMLImageElement.prototype.decode
    vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementationOnce(async function (this: HTMLImageElement) {
      await original.call(this)
      decoding.resolve()
      await gate.promise
    })
    const updating = cards.updateCardAvatar(input(thumbnail()))
    await decoding.promise
    await cards.activateCard(alternate)
    gate.resolve()
    await expect(updating).rejects.toThrow('changed')
    expect(cards.cards.get('default')?.metadata?.avatar).toBeUndefined()
    auth.user = { id: 'synthetic-user', name: 'Synthetic', email: 'synthetic@example.invalid', emailVerified: false, createdAt: new Date(), updatedAt: new Date() }
    useFeatureFlagsStore(pinia).setPreference(CHARACTER_CARD_SYNC_FLAG.key, true)
    expect(cards.cloudSyncEnabled).toBe(false)
    await cards.synchronizeCards()
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/character-cards'))).toBe(false)
  })
  it.each(['account', 'delete'] as const)('rejects a late save after %s changes', async (change) => {
    const { cards, auth } = context()
    await cards.initialize()
    const target = await cards.addCard({ name: 'Synthetic target', version: '1.0.0' }, 'scratch')
    const gate = Promise.withResolvers<void>()
    const decoding = Promise.withResolvers<void>()
    const original = HTMLImageElement.prototype.decode
    vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementationOnce(async function (this: HTMLImageElement) {
      await original.call(this)
      decoding.resolve()
      await gate.promise
    })
    const updating = cards.updateCardAvatar(input(thumbnail(), null, target))
    await decoding.promise
    if (change === 'account')
      auth.user = { id: 'other-owner', name: 'Synthetic', email: 'synthetic@example.invalid', emailVerified: false, createdAt: new Date(), updatedAt: new Date() }
    else
      await cards.removeCard(target)
    gate.resolve()
    await expect(updating).rejects.toThrow(change === 'account' ? 'changed' : 'missing')
    expect(cards.cards.get(target)?.metadata?.avatar).toBeUndefined()
  })
})
