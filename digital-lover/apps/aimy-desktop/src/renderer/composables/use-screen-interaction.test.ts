import type { AimyBridge, MediaState } from '../../shared/contracts'
import type { useLocalConversation } from './use-local-conversation'

import { effectScope } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useScreenInteraction } from './use-screen-interaction'

function harness(configured = true, getInitialState?: () => Promise<MediaState>) {
  const scope = effectScope()
  const stop = vi.fn()
  const pause = vi.fn()
  const clearPixels = vi.fn()
  const video = { videoWidth: 160, videoHeight: 90, srcObject: null, play: async () => {}, pause, removeAttribute() {} }
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage() {}, clearRect: clearPixels }), toBlob: (callback: (blob: Blob) => void) => callback(new Blob([new Uint8Array([255, 216, 255, 217])], { type: 'image/jpeg' })) }
  const getDisplayMedia = vi.fn(async () => ({ getTracks: () => [{ stop, addEventListener() {} }] }))
  vi.stubGlobal('document', { hidden: false, createElement: (type: string) => type === 'video' ? video : canvas })
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} })
  vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } })
  let tick: () => void = () => {}
  vi.spyOn(globalThis, 'setInterval').mockImplementation(((callback: () => void) => { tick = callback; return 123 }) as any)
  vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {})
  let state: MediaState = { revision: 0, mic: { enabled: false }, screen: { enabled: false }, speech: { enabled: false } }
  let changed: (value: MediaState) => void = () => {}
  const bridge = {
    getMediaState: getInitialState || (async () => state),
    onMediaState: (listener: typeof changed) => { changed = listener; return () => {} },
    setMediaState: vi.fn(async (input: { enabled: boolean }) => {
      state = { ...state, revision: state.revision + 1, screen: { enabled: input.enabled, token: input.enabled ? 'screen-token' : undefined } }
      changed(state)
      return { ok: true, state }
    }),
    listScreenSources: vi.fn(async () => []),
    cancelMedia: vi.fn(async () => {}),
    interpretScreen: vi.fn(async () => ({ status: 'complete', text: '一个测试画面', receiptId: 'receipt' })),
    publishObservation: vi.fn(async () => ({ status: 'complete' })),
  } as unknown as AimyBridge
  const appendObservation = vi.fn(async () => true)
  const conversation = { appendObservation } as unknown as ReturnType<typeof useLocalConversation>
  const openSettings = vi.fn()
  const stopTurn = vi.fn()
  const screen = scope.run(() => useScreenInteraction(bridge, conversation, { configured: () => configured, openSettings, isBusy: () => false, isPreempted: () => false, stopTurn }))!
  return { scope, screen, bridge, stop, pause, video, clearPixels, getDisplayMedia, appendObservation, stopTurn, openSettings, tick: () => tick(), changed: (next: MediaState) => changed(next) }
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('screen capture boundaries (fake browser inputs)', () => {
  it('keeps a live display stream when initial state and duplicate events arrive late', async () => {
    let releaseInitial!: (state: MediaState) => void
    const test = harness(true, () => new Promise(resolve => { releaseInitial = resolve }))
    await test.screen.selectSource('window:fixture')
    const current = JSON.parse(JSON.stringify(test.screen.state.value)) as MediaState
    const initial: MediaState = { revision: 0, mic: { enabled: false }, screen: { enabled: false }, speech: { enabled: false } }
    releaseInitial(initial)
    await Promise.resolve()
    test.changed(initial)
    test.changed(current)
    expect(test.screen.enabled.value).toBe(true)
    expect(test.screen.state.value.revision).toBe(current.revision)
    expect(test.stop).not.toHaveBeenCalled()
    test.scope.stop()
  })

  it('starts the matching display grant after a newer unrelated channel update', async () => {
    const test = harness()
    const off: MediaState = { revision: 1, mic: { enabled: false }, screen: { enabled: false }, speech: { enabled: false } }
    const granted: MediaState = { ...off, revision: 2, screen: { enabled: true, token: 'screen-token' } }
    let release!: (reply: any) => void
    vi.mocked(test.bridge.setMediaState).mockImplementation(async (input) => {
      if (!input.enabled) { test.changed(off); return { ok: true, state: off } }
      test.changed(granted)
      return new Promise(resolve => { release = resolve })
    })
    const selecting = test.screen.selectSource('window:fixture')
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    test.changed({ ...granted, revision: 3, mic: { enabled: true, token: 'mic-token' } })
    release({ ok: true, state: granted })
    await selecting
    expect(test.getDisplayMedia).toHaveBeenCalledOnce()
    expect(test.screen.state.value.revision).toBe(3)
    expect(test.screen.state.value.mic.enabled).toBe(true)
    test.scope.stop()
  })

  it('does not capture after a screen enable reply arrives behind a newer revoke', async () => {
    const test = harness()
    const off: MediaState = { revision: 1, mic: { enabled: false }, screen: { enabled: false }, speech: { enabled: false } }
    const granted: MediaState = { ...off, revision: 2, screen: { enabled: true, token: 'screen-token' } }
    let release!: (reply: any) => void
    vi.mocked(test.bridge.setMediaState).mockImplementation(async (input) => {
      if (!input.enabled) { test.changed(off); return { ok: true, state: off } }
      test.changed(granted)
      return new Promise(resolve => { release = resolve })
    })
    const selecting = test.screen.selectSource('window:fixture')
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    test.changed({ ...off, revision: 3 })
    release({ ok: true, state: granted })
    await selecting
    expect(test.getDisplayMedia).not.toHaveBeenCalled()
    expect(test.screen.enabled.value).toBe(false)
    expect(test.screen.state.value.revision).toBe(3)
    test.scope.stop()
  })

  it('opens settings before any source enumeration when unconfigured', async () => {
    const test = harness(false)
    await test.screen.openPicker()
    expect(test.openSettings).toHaveBeenCalledOnce()
    expect(test.bridge.listScreenSources).not.toHaveBeenCalled()
    expect(test.getDisplayMedia).not.toHaveBeenCalled()
    test.scope.stop()
  })

  it('captures video only, publishes once and skips a completely identical frame', async () => {
    const test = harness()
    await test.screen.selectSource('window:fixture')
    await vi.waitFor(() => expect(test.appendObservation).toHaveBeenCalledOnce())
    expect(test.getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false }))
    expect(test.bridge.publishObservation).toHaveBeenCalledWith(expect.objectContaining({ token: 'screen-token', receiptId: 'receipt', text: '一个测试画面' }))
    test.tick()
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(test.bridge.interpretScreen).toHaveBeenCalledOnce()
    await test.screen.disable()
    expect(test.stop).toHaveBeenCalledOnce()
    expect(test.pause).toHaveBeenCalled()
    expect(test.video.srcObject).toBeNull()
    expect(test.clearPixels).toHaveBeenCalled()
    expect(test.stopTurn).toHaveBeenCalledOnce()
    test.scope.stop()
  })

  it('drops a late interpretation after disable without publishing or storing it', async () => {
    const test = harness()
    let release!: (value: any) => void
    vi.mocked(test.bridge.interpretScreen).mockImplementation(() => new Promise(resolve => { release = resolve }))
    await test.screen.selectSource('window:fixture')
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const disabling = test.screen.disable()
    expect(test.stop).toHaveBeenCalledOnce()
    await disabling
    release({ status: 'complete', text: '旧画面结果', receiptId: 'old' })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(test.bridge.publishObservation).not.toHaveBeenCalled()
    expect(test.appendObservation).not.toHaveBeenCalled()
    test.scope.stop()
  })
})
