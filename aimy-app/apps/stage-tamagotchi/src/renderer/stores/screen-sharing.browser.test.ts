import type { usePiniaSynced } from '@proj-airi/stage-ui/libs/pinia'

import { setupSynced } from '@proj-airi/stage-ui/libs/pinia'
import { configureLocalOnly } from '@proj-airi/stage-ui/services/local-data-policy'
import { getResourcePolicy, installResourcePolicy, ResourcePolicy } from '@proj-airi/stage-ui/services/resource-policy'
import { projectScreenConversation } from '@proj-airi/stage-ui/services/screen-context'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useVisionOrchestratorStore, useVisionStore } from '@proj-airi/stage-ui/stores/modules/vision'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, ref } from 'vue'

import { useScreenSharingStore } from './screen-sharing'

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

function outgoing(sessionId = 'screen-session') {
  return projectScreenConversation({ turns: [{ id: 'turn', type: 'user', content: [{ type: 'text', text: 'Look' }] }] }, sessionId)
}

describe('desktop screen sharing ownership', () => {
  it('routes two windows through one owner and removes stopped evidence from outgoing requests', async () => {
    const { leader, inference } = await fixture()
    const follower = await context('follower-only')
    await follower.store.choose('screen')
    await vi.waitFor(() => expect(follower.store.sources).toHaveLength(1))
    await follower.store.start('window:fixture')
    await vi.waitFor(() => expect(leader.store.lastObservedAt).not.toBeNull())
    expect(native.selectWithSource).toHaveBeenCalledOnce()
    expect(inference).toHaveBeenCalledWith(expect.objectContaining({ publishContext: false }))
    expect(JSON.stringify(outgoing().context)).toContain('SYNTHETIC_RED_SQUARE')
    expect(JSON.stringify(outgoing('other-session').context)).not.toContain('SYNTHETIC_RED_SQUARE')
    const beforeStop = outgoing()
    await follower.store.stop()
    expect(stream!.getVideoTracks()[0].readyState).toBe('ended')
    expect(() => beforeStop.assertCurrent()).toThrow('Screen sharing changed')
    expect(JSON.stringify(outgoing().context)).not.toContain('SYNTHETIC_RED_SQUARE')
    await vi.waitFor(() => expect(follower.store.status).toBe('off'))
    expect(leader.store.lastObservedAt).toBeNull()
  })

  it('keeps cancellation and a missing model closed without opening a stream', async () => {
    const { leader } = await fixture()
    await leader.store.choose('screen')
    await leader.store.cancelChoice()
    expect(leader.store.status).toBe('off')
    expect(getResourcePolicy()!.state.screen.enabled).toBe(false)
    useVisionStore().activeModel = ''
    await leader.store.choose('game')
    expect(leader.store.error).toBe('SCREEN_MODEL_REQUIRED')
    expect(leader.store.status).toBe('error')
    expect(native.selectWithSource).not.toHaveBeenCalled()
  })

  it('drops delayed inference after stop and revokes sharing when the character changes', async () => {
    const { leader, inference } = await fixture()
    const pending = Promise.withResolvers<{ text: string, contextUpdates: number }>()
    inference.mockReturnValueOnce(pending.promise)
    await leader.store.choose('game')
    await leader.store.start('window:fixture')
    await vi.waitFor(() => expect(inference).toHaveBeenCalledOnce())
    await leader.store.stop()
    pending.resolve({ text: 'LATE_PRIVATE_FRAME', contextUpdates: 0 })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(JSON.stringify(outgoing().context)).not.toContain('LATE_PRIVATE_FRAME')
    await leader.store.choose('screen')
    await leader.store.start('window:fixture')
    useAiriCardStore().activeCardId = 'another-character'
    await vi.waitFor(() => expect(leader.store.status).toBe('off'))
    expect(stream!.getVideoTracks()[0].readyState).toBe('ended')
  })

  it('expires stale frames without blocking ordinary text and rejects future timestamps', async () => {
    const { leader } = await fixture()
    await leader.store.choose('screen')
    await leader.store.start('window:fixture')
    await vi.waitFor(() => expect(leader.store.lastObservedAt).not.toBeNull())
    const capturedAt = leader.store.lastObservedAt!
    vi.spyOn(Date, 'now').mockReturnValue(capturedAt + 31000)
    expect(JSON.stringify(outgoing().context)).not.toContain('SYNTHETIC_RED_SQUARE')
    expect(JSON.stringify(outgoing().context)).toContain('no current usable frame')
    vi.mocked(Date.now).mockReturnValue(capturedAt - 1)
    expect(JSON.stringify(outgoing().context)).not.toContain('SYNTHETIC_RED_SQUARE')
  })
  it('does not restore a cancelled source lookup and stops on hide or provider change', async () => {
    const { leader } = await fixture()
    const pending = Promise.withResolvers<Array<{ id: string, name: string, thumbnail: never[], appIcon: never[] }>>()
    native.getSources.mockReturnValueOnce(pending.promise)
    const choosing = leader.store.choose('screen')
    await vi.waitFor(() => expect(native.getSources).toHaveBeenCalledOnce())
    await leader.store.cancelChoice()
    pending.resolve([{ id: 'window:fixture', name: 'Late source', thumbnail: [], appIcon: [] }])
    await choosing
    expect(leader.store.status).toBe('off')
    expect(leader.store.sources).toHaveLength(0)
    await leader.store.choose('screen')
    await leader.store.start('window:fixture')
    useVisionStore().activeModel = 'changed-model'
    await vi.waitFor(() => expect(leader.store.status).toBe('off'))
    expect(stream!.getVideoTracks()[0].readyState).toBe('ended')
    await leader.store.choose('screen')
    await leader.store.start('window:fixture')
    const previous = getResourcePolicy()!.state
    getResourcePolicy()!.apply({ ...previous, revision: ++revision, appEpoch: previous.appEpoch + 1, active: false, reason: 'hidden' })
    expect(leader.store.status).toBe('off')
    expect(stream!.getVideoTracks()[0].readyState).toBe('ended')
    expect(JSON.stringify(outgoing().context)).not.toContain('SYNTHETIC_RED_SQUARE')
  })

  it('reports a denied source listing without starting media', async () => {
    const { leader } = await fixture()
    native.getSources.mockRejectedValueOnce(new Error('Synthetic permission denied'))
    await leader.store.choose('screen')
    expect(leader.store.status).toBe('error')
    expect(leader.store.error).toBe('SCREEN_PERMISSION_FAILED')
    expect(getResourcePolicy()!.state.screen.enabled).toBe(false)
    expect(native.selectWithSource).not.toHaveBeenCalled()
  })
  it('uses the focused chat for a sidebar start without changing the Stage selection', async () => {
    const { leader } = await fixture()
    const sessions = useChatSessionStore(leader.pinia)
    sessions.sessionMetas['focused-session'] = { ...sessions.sessionMetas['screen-session'], sessionId: 'focused-session' }
    const follower = await context('follower-only')
    await useChatSessionStore(follower.pinia).setInteractionSession('focused-session')
    await leader.store.choose('screen')
    await leader.store.start('window:fixture')
    await vi.waitFor(() => expect(leader.store.lastObservedAt).not.toBeNull())
    expect(sessions.activeSessionId).toBe('screen-session')
    expect(JSON.stringify(outgoing('focused-session').context)).toContain('SYNTHETIC_RED_SQUARE')
    expect(JSON.stringify(outgoing('screen-session').context)).not.toContain('SYNTHETIC_RED_SQUARE')
    await leader.store.stop()
    delete sessions.sessionMetas['focused-session']
    expect(sessions.resolveInteractionSessionId()).toBe('')
    await leader.store.choose('screen')
    expect(leader.store.error).toBe('SCREEN_SESSION_UNAVAILABLE')
  })

  it('stops capture when focus moves to a different valid conversation', async () => {
    const { leader } = await fixture()
    const sessions = useChatSessionStore(leader.pinia)
    sessions.sessionMetas.other = { ...sessions.sessionMetas['screen-session'], sessionId: 'other' }
    await sessions.setInteractionSession('screen-session', 'first-window')
    await leader.store.choose('screen')
    await leader.store.start('window:fixture')
    await vi.waitFor(() => expect(leader.store.lastObservedAt).not.toBeNull())
    await sessions.setInteractionSession('other', 'second-window')
    await vi.waitFor(() => expect(leader.store.status).toBe('off'))
    expect(stream!.getVideoTracks()[0].readyState).toBe('ended')
    expect(JSON.stringify(outgoing('screen-session').context)).not.toContain('SYNTHETIC_RED_SQUARE')
    expect(JSON.stringify(outgoing('other').context)).not.toContain('SYNTHETIC_RED_SQUARE')
  })

  it('rejects a foreign focused chat without replacing the authorized input target', async () => {
    const { leader } = await fixture()
    const sessions = useChatSessionStore(leader.pinia)
    await sessions.setInteractionSession('screen-session')
    sessions.sessionMetas.foreign = { ...sessions.sessionMetas['screen-session'], sessionId: 'foreign', userId: 'another-user' }
    await expect(sessions.setInteractionSession('foreign')).rejects.toThrow('INTERACTION_SESSION_UNAVAILABLE')
    expect(sessions.resolveInteractionSessionId()).toBe('screen-session')
  })

  it('binds a follower selected session without changing the main Stage selection', async () => {
    const { leader } = await fixture()
    const sessions = useChatSessionStore()
    sessions.sessionMetas['follower-session'] = { ...sessions.sessionMetas['screen-session'], sessionId: 'follower-session' }
    const follower = await context('follower-only')
    await follower.store.choose('screen', 'follower-session')
    await follower.store.start('window:fixture')
    await vi.waitFor(() => expect(leader.store.lastObservedAt).not.toBeNull())
    expect(sessions.activeSessionId).toBe('screen-session')
    expect(JSON.stringify(outgoing('follower-session').context)).toContain('SYNTHETIC_RED_SQUARE')
    expect(JSON.stringify(outgoing('screen-session').context)).not.toContain('SYNTHETIC_RED_SQUARE')
    delete sessions.sessionMetas['follower-session']
    await vi.waitFor(() => expect(leader.store.status).toBe('off'))
    expect(stream!.getVideoTracks()[0].readyState).toBe('ended')
  })
})
