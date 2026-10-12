import type { AimyBridge, MediaState, ScreenSource } from '../../shared/contracts'
import type { useLocalConversation } from './use-local-conversation'

import { computed, onScopeDispose, ref } from 'vue'
import { copyMediaState, newerMediaState } from './media-state-order'

interface ScreenOptions {
  configured: () => boolean
  openSettings: () => void
  isBusy: () => boolean
  isPreempted: () => boolean
  stopTurn: (turnId: string) => void
}

/** Explicit source sharing; one bounded frame at a time, no frame persistence. */
export function useScreenInteraction(bridge: AimyBridge, conversation: ReturnType<typeof useLocalConversation>, options: ScreenOptions) {
  const state = ref<MediaState>({ revision: -1, mic: { enabled: false }, screen: { enabled: false }, speech: { enabled: false } })
  const pickerOpen = ref(false)
  const loadingSources = ref(false)
  const sources = ref<ScreenSource[]>([])
  const error = ref('')
  const observing = ref(false)
  const starting = ref(false)
  const enabled = computed(() => state.value.screen.enabled)
  let epoch = 0
  let disposed = false
  let stream: MediaStream | undefined
  let video: HTMLVideoElement | undefined
  let canvas: HTMLCanvasElement | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let lastDigest = ''
  let activeRequest: string | undefined
  let lastTurn: string | undefined

  function applyState(next: MediaState) {
    if (!newerMediaState(state.value, next))
      return false
    const previous = state.value.screen
    state.value = copyMediaState(next)
    if ((previous.enabled && !next.screen.enabled) || (previous.token && previous.token !== next.screen.token))
      void suspend()
    return true
  }

  const current = (identity: number, token: string) => !disposed && identity === epoch && state.value.screen.enabled && state.value.screen.token === token && !document.hidden

  function suspend(): Promise<boolean> {
    epoch++
    let failed = false
    // Stop every video track before the first asynchronous cleanup operation.
    stream?.getTracks().forEach((track) => {
      try { track.stop() }
      catch { failed = true }
    })
    stream = undefined
    if (video) {
      video.pause()
      video.srcObject = null
      video.removeAttribute('src')
    }
    video = undefined
    if (canvas) {
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
      canvas.width = 0
      canvas.height = 0
    }
    canvas = undefined
    if (timer)
      clearInterval(timer)
    timer = undefined
    if (activeRequest)
      void bridge.cancelMedia({ requestId: activeRequest }).catch(() => {})
    activeRequest = undefined
    if (lastTurn)
      options.stopTurn(lastTurn)
    lastTurn = undefined
    lastDigest = ''
    observing.value = false
    starting.value = false
    pickerOpen.value = false
    return Promise.resolve(!failed)
  }

  async function disable() {
    const stopped = suspend()
    try {
      const result = await bridge.setMediaState({ kind: 'screen', enabled: false })
      applyState(result.state)
      if (!result.ok)
        error.value = result.message || '屏幕共享状态未能更新，请重试关闭。'
    }
    catch { error.value = '屏幕共享状态未能更新，请重试关闭。' }
    return stopped
  }

  async function openPicker() {
    if (!options.configured()) { options.openSettings(); return }
    error.value = ''
    pickerOpen.value = true
    loadingSources.value = true
    try {
      sources.value = await bridge.listScreenSources()
      if (!sources.value.length)
        error.value = '没有可共享的窗口或屏幕，请检查系统屏幕录制权限。'
    }
    catch { error.value = '无法列出共享来源，请检查系统屏幕录制权限。' }
    finally { loadingSources.value = false }
  }

  async function observe() {
    const identity = epoch
    const token = state.value.screen.token
    const frameVideo = video
    const frameCanvas = canvas
    if (!token || !current(identity, token) || observing.value || options.isBusy() || !frameVideo?.videoWidth || !frameCanvas)
      return
    observing.value = true
    const requestId = crypto.randomUUID()
    activeRequest = requestId
    let bytes: Uint8Array<ArrayBuffer> | undefined
    try {
      const scale = Math.min(1, 960 / frameVideo.videoWidth, 720 / frameVideo.videoHeight)
      frameCanvas.width = Math.max(1, Math.round(frameVideo.videoWidth * scale))
      frameCanvas.height = Math.max(1, Math.round(frameVideo.videoHeight * scale))
      const context = frameCanvas.getContext('2d')
      if (!context)
        throw new Error('Frame encoder unavailable')
      context.drawImage(frameVideo, 0, 0, frameCanvas.width, frameCanvas.height)
      const blob = await new Promise<Blob | null>(resolve => frameCanvas.toBlob(resolve, 'image/jpeg', 0.72))
      if (!blob || blob.size > 2 * 1024 * 1024)
        throw new Error('Invalid observation frame')
      bytes = new Uint8Array(await blob.arrayBuffer())
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
      if (!current(identity, token) || options.isBusy() || digest === lastDigest)
        return
      lastDigest = digest
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
      const interpreted = await bridge.interpretScreen({ requestId, token, imageBase64: btoa(binary) })
      bytes.fill(0)
      bytes = undefined
      binary = ''
      if (!current(identity, token) || options.isBusy())
        return
      if (interpreted.status !== 'complete' || !interpreted.text?.trim() || !interpreted.receiptId) {
        if (interpreted.status !== 'cancelled') {
          error.value = interpreted.message || '看屏服务暂时不可用，已停止共享。文字对话仍可使用。'
          await disable()
        }
        return
      }
      const published = await bridge.publishObservation({ requestId, token, receiptId: interpreted.receiptId, text: interpreted.text })
      const permitted = () => current(identity, token) && !options.isPreempted()
      if (published.status !== 'complete' || !permitted() || options.isBusy())
        return
      // Main authorizes this exact observation for readout. No second LLM call.
      lastTurn = requestId
      const saved = await conversation.appendObservation(interpreted.text, requestId, permitted)
      if (!saved && lastTurn === requestId)
        lastTurn = undefined
      if (!current(identity, token))
        options.stopTurn(requestId)
    }
    catch {
      if (current(identity, token)) {
        error.value = '画面观察未完成，已停止共享。文字对话仍可使用。'
        await disable()
      }
    }
    finally {
      bytes?.fill(0)
      // The canvas is a temporary encoder, not a retained frame preview.
      if (frameCanvas === canvas)
        frameCanvas.getContext('2d')?.clearRect(0, 0, frameCanvas.width, frameCanvas.height)
      if (activeRequest === requestId) {
        activeRequest = undefined
        observing.value = false
      }
    }
  }

  async function selectSource(sourceId: string) {
    await disable()
    const identity = ++epoch
    starting.value = true
    error.value = ''
    try {
      const result = await bridge.setMediaState({ kind: 'screen', enabled: true, sourceId })
      if (identity !== epoch || disposed)
        return
      applyState(result.state)
      const token = state.value.screen.token
      if (!result.ok || !token) { error.value = result.message || '屏幕共享未能开启。'; return }
      if (!state.value.screen.enabled || token !== result.state.screen.token)
        return
      const acquired = await navigator.mediaDevices.getDisplayMedia({ video: { width: { max: 960 }, height: { max: 720 }, frameRate: { max: 1 } }, audio: false })
      if (!current(identity, token)) {
        acquired.getTracks().forEach(track => track.stop())
        return
      }
      stream = acquired
      acquired.getTracks().forEach(track => track.addEventListener('ended', () => { if (current(identity, token)) void disable() }, { once: true }))
      video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.srcObject = acquired
      canvas = document.createElement('canvas')
      await video.play()
      if (!current(identity, token))
        return
      timer = setInterval(() => { void observe() }, 5000)
      void observe()
    }
    catch {
      if (identity === epoch) {
        error.value = '无法共享所选画面，请检查系统权限。'
        await disable()
      }
    }
    finally { if (identity === epoch) starting.value = false }
  }

  const removeState = bridge.onMediaState(applyState)
  void bridge.getMediaState().then(applyState).catch(() => {})
  const pageStop = () => { void suspend() }
  window.addEventListener('pagehide', pageStop)
  window.addEventListener('beforeunload', pageStop)
  onScopeDispose(() => {
    disposed = true
    removeState()
    window.removeEventListener('pagehide', pageStop)
    window.removeEventListener('beforeunload', pageStop)
    void suspend()
  })
  return { state, enabled, pickerOpen, loadingSources, sources, error, observing, starting, openPicker, selectSource, disable, suspend }
}
