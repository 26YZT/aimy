import type { usePiniaSynced } from '@proj-airi/stage-ui/libs/pinia'

import { setupSynced } from '@proj-airi/stage-ui/libs/pinia'
import { configureLocalOnly } from '@proj-airi/stage-ui/services/local-data-policy'
import { getResourcePolicy, installResourcePolicy, ResourcePolicy } from '@proj-airi/stage-ui/services/resource-policy'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useVisionOrchestratorStore, useVisionStore } from '@proj-airi/stage-ui/stores/modules/vision'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createApp, defineComponent, h, ref } from 'vue'

import ScreenShareControl from './screen-share-control.vue'

import { useScreenSharingStore } from '../stores/screen-sharing'

import '@proj-airi/ui/main.css'
import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

// The Electron capture boundary supplies an actual canvas stream, never a desktop frame.
const native = vi.hoisted(() => ({ getSources: vi.fn(), selectWithSource: vi.fn() }))
// Capture uses the shared Eventa renderer adapter; these are native boundaries only.
vi.mock('@proj-airi/electron-vueuse', async importOriginal => ({
  ...await importOriginal<typeof import('@proj-airi/electron-vueuse')>(),
  getElectronEventaContext: () => ({}),
}))
vi.mock('@proj-airi/electron-screen-capture/renderer', () => ({ setupElectronScreenCapture: () => ({
  getSources: native.getSources,
  selectWithSource: native.selectWithSource,
}) }))
vi.mock('@proj-airi/electron-screen-capture/vue', () => ({ useElectronScreenCapture: () => ({
  getSources: native.getSources,
  selectWithSource: native.selectWithSource,
  checkMacOSPermission: async () => 'granted',
  requestMacOSPermission: async () => {},
}) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ locale: ref('en'), t: (key: string) => key, te: () => true }) }))
vi.mock('@proj-airi/stage-ui/libs/auth-fetch', () => ({ authedFetch: () => {
  throw new Error('No cloud in screen fixture')
} }))

const views: Array<Awaited<ReturnType<typeof render>>> = []

const contexts: Array<{ app: ReturnType<typeof createApp>, pinia: ReturnType<typeof createPinia>, store: ReturnType<typeof useScreenSharingStore>, runtime: ReturnType<typeof usePiniaSynced> }> = []
let revision = 0
let stream: MediaStream | undefined
let interval: ReturnType<typeof setInterval> | undefined

async function context(leadership: 'leader-only' | 'follower-only') {
  const pinia = createPinia()
  const sync = setupSynced({ leadership })
  pinia.use(sync.pinia)
  let runtime: ReturnType<typeof usePiniaSynced> | undefined
  // setupSynced installs the same production runtime used by App.
  const { usePiniaSynced } = await import('@proj-airi/stage-ui/libs/pinia')
  const app = createApp(defineComponent(() => {
    runtime = usePiniaSynced()
    return () => h('div')
  }))
  app.use(pinia).use(sync.vue).mount(document.createElement('div'))
  setActivePinia(pinia)
  const store = useScreenSharingStore()
  const result = { app, pinia, store, runtime: runtime! }
  contexts.push(result)
  await vi.waitFor(() => expect(runtime!.getLeaderId()).toBeTruthy())
  return result
}

async function fixture() {
  configureLocalOnly()
  vi.stubGlobal('electron', { ipcRenderer: {} })
  vi.stubGlobal('platform', 'linux')
  if (!getResourcePolicy()) {
    installResourcePolicy(new ResourcePolicy({ setEnabled: async (kind, enabled) => {
      const previous = getResourcePolicy()!.state
      if (previous[kind].enabled === enabled)
        return previous
      return { ...previous, revision: ++revision, [kind]: { enabled, epoch: previous[kind].epoch + 1 } }
    } }))
  }
  getResourcePolicy()!.apply({ revision: ++revision, appEpoch: revision, active: true, reason: 'fixture', microphone: { enabled: false, epoch: 0 }, screen: { enabled: false, epoch: 0 } })
  native.getSources.mockResolvedValue([{ id: 'window:fixture', name: 'Synthetic window', thumbnail: [], appIcon: [] }])
  native.selectWithSource.mockImplementation(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 160
    canvas.height = 90
    const painter = canvas.getContext('2d')!
    painter.fillRect(0, 0, 160, 90)
    stream = canvas.captureStream(12)
    interval = setInterval(() => {
      painter.fillStyle = '#25a'
      painter.fillRect(0, 0, 160, 90)
    }, 50)
    return stream
  })
  const leader = await context('leader-only')
  setActivePinia(leader.pinia)
  useAuthStore().user = null
  useChatSessionStore().activeSessionId = 'screen-session'
  useChatSessionStore().sessionMetas['screen-session'] = { sessionId: 'screen-session', userId: 'local', characterId: useAiriCardStore().activeCardId, createdAt: 1, updatedAt: 1 }
  useVisionStore().activeProvider = 'fixture'
  useVisionStore().activeModel = 'fixture'
  const inference = vi.spyOn(useVisionOrchestratorStore(), 'processCapture').mockResolvedValue({ text: 'SYNTHETIC_RED_SQUARE', contextUpdates: 0 })
  leader.store.initialize(leader.runtime)
  return { leader, inference }
}

afterEach(async () => {
  for (const view of views.splice(0))
    view.unmount()
  for (const context of contexts.splice(0).reverse()) {
    await context.store.dispose()
    context.app.unmount()
    disposePinia(context.pinia)
  }
  stream?.getTracks().forEach(track => track.stop())
  clearInterval(interval)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  native.getSources.mockReset()
  native.selectWithSource.mockReset()
})

async function mountControl(pinia: ReturnType<typeof createPinia>, onInteractionChange?: (active: boolean) => void) {
  await page.viewport(900, 700)
  const view = await render(ScreenShareControl, { attrs: { onInteractionChange }, global: { plugins: [pinia] } })
  views.push(view)
  return view
}

const startLabel = 'tamagotchi.screenSharing.start'
const cancelLabel = 'tamagotchi.screenSharing.cancel'

describe('screen share control with the real capture owner', () => {
  it('lists sources without capturing, then starts only after a source click', async () => {
    const { leader } = await fixture()
    const interaction = vi.fn()
    await mountControl(leader.pinia, interaction)
    expect(native.getSources).not.toHaveBeenCalled()
    expect(native.selectWithSource).not.toHaveBeenCalled()
    await page.getByRole('button', { name: startLabel, exact: true }).click()
    await expect.element(page.getByRole('dialog')).toBeVisible()
    expect(interaction).toHaveBeenLastCalledWith(true)
    await expect.element(page.getByRole('button', { name: 'Synthetic window', exact: true })).toBeVisible()
    expect(native.selectWithSource).not.toHaveBeenCalled()
    await page.getByRole('button', { name: 'Synthetic window', exact: true }).click()
    await vi.waitFor(() => expect(leader.store.status).toBe('sharing'))
    expect(native.selectWithSource).toHaveBeenCalledOnce()
    await page.getByRole('button', { name: 'tamagotchi.screenSharing.stop', exact: true }).click()
    expect(stream!.getVideoTracks()[0].readyState).toBe('ended')
    await vi.waitFor(() => expect(interaction).toHaveBeenLastCalledWith(false))
  })

  it('cancels a pending source lookup and does not reopen from its late result', async () => {
    const { leader } = await fixture()
    const pending = Promise.withResolvers<Array<{ id: string, name: string, thumbnail: never[], appIcon: never[] }>>()
    native.getSources.mockReturnValueOnce(pending.promise)
    await mountControl(leader.pinia)
    await page.getByRole('button', { name: startLabel, exact: true }).click()
    await page.getByRole('button', { name: cancelLabel, exact: true }).click()
    pending.resolve([{ id: 'window:fixture', name: 'Late source', thumbnail: [], appIcon: [] }])
    await vi.waitFor(() => expect(leader.store.status).toBe('off'))
    expect(native.selectWithSource).not.toHaveBeenCalled()
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  })

  it('cancels a pending media start when its UI unmounts', async () => {
    const { leader } = await fixture()
    const nativeOpen = native.selectWithSource.getMockImplementation()!
    const pending = Promise.withResolvers<MediaStream>()
    native.selectWithSource.mockReturnValueOnce(pending.promise)
    const view = await mountControl(leader.pinia)
    await page.getByRole('button', { name: startLabel, exact: true }).click()
    await page.getByRole('button', { name: 'Synthetic window', exact: true }).click()
    await vi.waitFor(() => expect(leader.store.status).toBe('starting'))
    view.unmount()
    views.splice(views.indexOf(view), 1)
    pending.resolve(await nativeOpen())
    await vi.waitFor(() => expect(leader.store.status).toBe('off'))
    expect(stream!.getVideoTracks()[0].readyState).toBe('ended')
  })

  it('does not let an old component cancel or start another window choice', async () => {
    const { leader } = await fixture()
    const view = await mountControl(leader.pinia)
    await page.getByRole('button', { name: startLabel, exact: true }).click()
    await vi.waitFor(() => expect(leader.store.sources).toHaveLength(1))
    const oldRequest = leader.store.choiceRequestId
    expect(oldRequest).not.toBe('')
    const follower = await context('follower-only')
    await follower.store.choose('game', 'screen-session', 'new-window-choice')
    expect(leader.store.error).toBe('')
    expect(leader.store.choiceRequestId).toBe('new-window-choice')
    view.unmount()
    views.splice(views.indexOf(view), 1)
    await expect(follower.store.start('window:fixture', oldRequest)).rejects.toThrow('SCREEN_CHOICE_EXPIRED')
    expect(leader.store.choiceRequestId).toBe('new-window-choice')
    expect(leader.store.status).toBe('choosing')
    await follower.store.start('window:fixture', 'new-window-choice')
    expect(leader.store.status).toBe('sharing')
    expect(native.selectWithSource).toHaveBeenCalledOnce()
  })

  it('shows a permission error and can open the picker again', async () => {
    const { leader } = await fixture()
    native.getSources.mockRejectedValueOnce(new Error('Synthetic permission denied'))
    await mountControl(leader.pinia)
    await page.getByRole('button', { name: startLabel, exact: true }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('tamagotchi.screenSharing.errors.SCREEN_PERMISSION_FAILED')
    expect(native.selectWithSource).not.toHaveBeenCalled()
    await page.getByRole('button', { name: cancelLabel, exact: true }).click()
    await page.getByRole('button', { name: startLabel, exact: true }).click()
    await expect.element(page.getByRole('dialog')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Synthetic window', exact: true })).toBeVisible()
  })
})
