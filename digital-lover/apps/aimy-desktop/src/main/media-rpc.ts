import { app, desktopCapturer, systemPreferences } from 'electron'
import type { BrowserWindow, DesktopCapturerSource, IpcMainEvent, Streams } from 'electron'
import type { createContext } from '@moeru/eventa/adapters/electron/main'
import { defineInvokeHandler } from '@moeru/eventa'
import { resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { safeParse, object, string, picklist, boolean, optional, pipe, maxLength } from 'valibot'
import type { ChatReply, ChatRequest, ChatUpdate, MediaReply, PublicSettings, ScreenSource } from '../shared/contracts'
import { audioSettingsSave, mediaGet, mediaSet, mediaChanged, transcribeAudio, synthesizeAudio, interpretScreen, publishScreenObservation, cancelMedia, screenSources } from '../shared/contracts'
import type { createSettingsStore } from './settings-store'
import type { createDesktopChat } from './chat-service'
import { createAudioService } from './audio-service'
import { createVisionService } from './vision-service'
import { createMediaAuthority } from './media-authority'

const controlSchema = object({ kind: picklist(['mic', 'screen', 'speech']), enabled: boolean(), sourceId: optional(pipe(string(), maxLength(200))) })
export const emptySettings = (): PublicSettings => ({ model: '', visionModel: '', baseUrl: '', api: 'chat-completions', configured: false, protectedStorage: false })
const deniedReply = (requestId = ''): MediaReply => ({ requestId, status: 'cancelled', message: '当前操作未获授权。' })
// Electron 43's runtime accepts null for denial; its generated Streams type omits it.
// Empty {} instead enters the "video requested but missing" error branch.
const denyDisplay = (callback: (streams: Streams) => void) => (callback as (streams: Streams | null) => void)(null)

/** Device permissions, main-owned model ports and source selection for this window only. */
export function createDesktopMedia(options: {
  window: BrowserWindow
  context: ReturnType<typeof createContext>['context']
  settings: Awaited<ReturnType<typeof createSettingsStore>>
  chat: ReturnType<typeof createDesktopChat>
  trusted: (event?: IpcMainEvent) => boolean
  allowedUrl: () => string
}) {
  const { window, context, settings, chat, trusted } = options
  const requestedTestMode = process.env.AIMY_TEST_MODE === '1'
  const fakeDevices = requestedTestMode && Boolean(process.env.APP_USER_DATA_PATH)
    && resolve(process.env.APP_USER_DATA_PATH!).startsWith(resolve(tmpdir()) + sep)
    && app.commandLine.hasSwitch('use-fake-device-for-media-stream')
  const availableSources = new Map<string, DesktopCapturerSource>()
  let selectedSource: DesktopCapturerSource | undefined
  let fakeSourceSelected = false
  let sourceVersion = 0
  let sourcesListedAt = 0
  let speechTurn: { id: string; text: string; valid: boolean; source: 'text' | 'voice' | 'screen'; requests: Set<string> } | undefined
  let visualRequestId = ''
  const revokeModels = () => {
    chat.cancel()
    if (speechTurn) speechTurn.valid = false
    visualRequestId = ''
    audio.cancelAll()
    vision.cancelAll()
  }
  const authority = createMediaAuthority({
    async authorize(input) {
      const config = settings.publicSettings()
      if (!window.isVisible()) return { ok: false, message: '请显示窗口后再开启。' }
      if (input.kind === 'speech') return { ok: Boolean(config.tts?.configured), message: '请先配置语音合成模型和音色。' }
      if (!config.configured) return { ok: false, message: '请先配置对话与识图服务。' }
      if (requestedTestMode && !fakeDevices) return { ok: false, message: '测试设备条件未满足，采集保持关闭。' }
      if (input.kind === 'mic') {
        if (!config.asr?.configured) return { ok: false, message: '请先配置语音识别服务。' }
        if (fakeDevices || process.platform !== 'darwin') return { ok: true }
        const status = systemPreferences.getMediaAccessStatus('microphone')
        if (status === 'granted') return { ok: true }
        if (status === 'not-determined') return { ok: await systemPreferences.askForMediaAccess('microphone'), message: '麦克风权限未开启，可以继续用文字。' }
        return { ok: false, message: '系统麦克风权限关闭，请在系统设置中允许后重试。' }
      }
      if (fakeDevices && input.sourceId === 'window:aimy-media-fixture') {
        fakeSourceSelected = true
        return { ok: true, sourceName: '模拟测试窗口' }
      }
      const source = input.sourceId ? availableSources.get(input.sourceId) : undefined
      if (!source || Date.now() - sourcesListedAt > 60_000) return { ok: false, message: '共享来源已过期，请重新选择窗口或屏幕。' }
      if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') !== 'granted')
        return { ok: false, message: '系统屏幕录制权限未开启，请允许后重新选择共享源。' }
      selectedSource = source
      fakeSourceSelected = false
      return { ok: true, sourceName: source.name.slice(0, 160) }
    },
    changed: state => { if (!window.isDestroyed()) void context.emit(mediaChanged, state).catch(() => {}) },
    revoked(kind) {
      if (kind === 'screen') { sourceVersion++; selectedSource = undefined; fakeSourceSelected = false }
      if (kind === 'mic') {
        audio.cancelAll('asr')
        if (speechTurn?.source === 'voice') { speechTurn.valid = false; chat.cancel(speechTurn.id); audio.cancelAll('tts') }
      } else if (kind === 'screen') {
        visualRequestId = ''
        vision.cancelAll()
        if (speechTurn?.source === 'screen') { speechTurn.valid = false; audio.cancelAll('tts') }
      } else {
        audio.cancelAll('tts')
        if (speechTurn) speechTurn.valid = false
      }
    },
  })
  const audio = createAudioService({ getConfiguration: kind => settings.privateMediaSettings(kind), acquire: (kind, token) => authority.acquire(kind, token), isSpeechTextAllowed: (turnId, text) => Boolean(authority.enabled('speech') && speechTurn?.valid && speechTurn.id === turnId && speechTurn.text.includes(text)) })
  const vision = createVisionService({ getConfiguration: () => settings.privateSettings(), acquire: token => authority.acquire('screen', token), isCurrent: id => id === visualRequestId && !chat.isBusy() && authority.enabled('screen') })
  const ownSurface = (id: number | undefined, url: string | undefined, mainFrame: boolean) => id === window.webContents.id && mainFrame && url === options.allowedUrl() && window.webContents.getURL() === options.allowedUrl() && window.isVisible()
  const diagnostic = (phase: string, value: Record<string, unknown>) => { if (fakeDevices) console.info('Aimy-test-permission', JSON.stringify({ phase, ...value })) }
  window.webContents.session.setPermissionCheckHandler((wc, permission, _origin, details) => {
    const own = ownSurface(wc?.id, details.requestingUrl, details.isMainFrame)
    const allowed = permission === 'media' && details.mediaType === 'audio' && authority.enabled('mic') && own
    diagnostic('check', { permission, mediaType: details.mediaType, mainFrame: details.isMainFrame, sameUrl: details.requestingUrl === options.allowedUrl(), own, mic: authority.enabled('mic'), screen: authority.enabled('screen'), allowed })
    return allowed
  })
  window.webContents.session.setPermissionRequestHandler((wc, permission, callback, details) => {
    diagnostic('request', { permission, mainFrame: details.isMainFrame, sameUrl: details.requestingUrl === options.allowedUrl(), mediaTypes: 'mediaTypes' in details ? details.mediaTypes : undefined, mic: authority.enabled('mic'), screen: authority.enabled('screen') })
    if (permission === 'display-capture') {
      callback(authority.enabled('screen') && Boolean(selectedSource || fakeSourceSelected) && ownSurface(wc.id, details.requestingUrl, details.isMainFrame))
      return
    }
    const types = 'mediaTypes' in details ? details.mediaTypes : undefined
    // Electron 43 reports getDisplayMedia as media with an empty type list.
    // Camera requests carry video (or audio+video) and remain denied here.
    if (permission === 'media' && Array.isArray(types) && types.length === 0) {
      callback(authority.enabled('screen') && Boolean(selectedSource || fakeSourceSelected) && ownSurface(wc.id, details.requestingUrl, details.isMainFrame))
      return
    }
    callback(permission === 'media' && types?.length === 1 && types[0] === 'audio' && authority.enabled('mic') && ownSurface(wc.id, details.requestingUrl, details.isMainFrame))
  })
  window.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
    const current = authority.state().screen
    diagnostic('display', { enabled: current.enabled, video: request.videoRequested, audio: request.audioRequested, gesture: request.userGesture, mainFrame: request.frame === window.webContents.mainFrame, sameUrl: request.frame?.url === options.allowedUrl(), fakeSource: fakeSourceSelected, selected: Boolean(selectedSource) })
    if (!current.enabled || !request.videoRequested || request.audioRequested || !request.userGesture || request.frame !== window.webContents.mainFrame || request.frame?.url !== options.allowedUrl()) { denyDisplay(callback); return }
    if (fakeDevices && fakeSourceSelected) { callback({ video: window.webContents.mainFrame }); return }
    if (!selectedSource) { denyDisplay(callback); return }
    callback({ video: selectedSource })
  })
  const allowed = (raw?: IpcMainEvent) => trusted(raw) && window.isVisible()
  defineInvokeHandler(context, mediaGet, (_input, invocation) => trusted(invocation?.raw?.ipcMainEvent) ? authority.state() : { mic: { enabled: false }, screen: { enabled: false }, speech: { enabled: false } })
  defineInvokeHandler(context, mediaSet, async (value, invocation) => {
    const parsed = safeParse(controlSchema, value)
    if (!allowed(invocation?.raw?.ipcMainEvent) || !parsed.success) return { ok: false, state: authority.state(), message: '设备请求已拒绝。' }
    return authority.set(parsed.output)
  })
  defineInvokeHandler(context, audioSettingsSave, async (input, invocation) => {
    if (!allowed(invocation?.raw?.ipcMainEvent)) return { ok: false, settings: emptySettings(), message: '请求已拒绝。' }
    authority.revokeAll(); revokeModels()
    return settings.saveAudio(input)
  })
  defineInvokeHandler(context, transcribeAudio, (input, invocation) => allowed(invocation?.raw?.ipcMainEvent) ? audio.transcribe(input) : deniedReply())
  defineInvokeHandler(context, synthesizeAudio, (input, invocation) => {
    if (!allowed(invocation?.raw?.ipcMainEvent) || !input || !speechTurn?.valid || typeof input.requestId !== 'string' || input.turnId !== speechTurn.id) return deniedReply()
    if (speechTurn.requests.size >= 32) return { requestId: input.requestId, status: 'failed' as const, message: '本轮朗读较长，已停止后续语音，文字回复仍可查看。' }
    speechTurn.requests.add(input.requestId)
    return audio.synthesize(input)
  })
  defineInvokeHandler(context, cancelMedia, (input, invocation) => { if (trusted(invocation?.raw?.ipcMainEvent) && input && typeof input.requestId === 'string') audio.cancel(input.requestId) })
  defineInvokeHandler(context, screenSources, async (_input, invocation): Promise<ScreenSource[]> => {
    if (!allowed(invocation?.raw?.ipcMainEvent)) return []
    if (requestedTestMode && !fakeDevices) return []
    if (fakeDevices) return [{ id: 'window:aimy-media-fixture', name: '模拟测试窗口', kind: 'window' }]
    if (!settings.publicSettings().configured) return []
    const requestedVersion = ++sourceVersion
    const items = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false }).catch(() => [])
    if (!window.isVisible() || sourceVersion !== requestedVersion) return []
    availableSources.clear()
    sourcesListedAt = Date.now()
    for (const item of items.slice(0, 50)) availableSources.set(item.id, item)
    return [...availableSources.values()].map(item => ({ id: item.id, name: item.name.replace(/[\x00-\x1f]/g, '').slice(0, 160), kind: item.id.startsWith('screen:') ? 'screen' : 'window' }))
  })
  defineInvokeHandler(context, interpretScreen, (input, invocation) => {
    if (!allowed(invocation?.raw?.ipcMainEvent) || !input || typeof input.requestId !== 'string' || chat.isBusy()) return deniedReply()
    visualRequestId = input.requestId
    return vision.interpret(input)
  })
  defineInvokeHandler(context, publishScreenObservation, (input, invocation) => {
    if (!allowed(invocation?.raw?.ipcMainEvent) || !input || typeof input.text !== 'string' || input.requestId !== visualRequestId || chat.isBusy() || !vision.consumeObservation(input.receiptId, input.token, input.text)) return deniedReply()
    speechTurn = { id: input.requestId, text: input.text, valid: true, source: 'screen', requests: new Set() }
    return { requestId: input.requestId, status: 'complete' as const, text: input.text }
  })
  return {
    authority,
    revokeAll() { authority.revokeAll(); availableSources.clear(); revokeModels() },
    setVisible(visible: boolean) { authority.setVisible(visible); if (!visible) { availableSources.clear(); revokeModels() } },
    remember(update: ChatUpdate) { if (speechTurn?.valid && speechTurn.id === update.requestId) speechTurn.text = update.text },
    cancel() { revokeModels() },
    async send(input: ChatRequest): Promise<ChatReply> {
      let lease: ReturnType<typeof authority.acquire>
      const deny: ChatReply = { requestId: typeof input?.requestId === 'string' ? input.requestId : '', status: 'cancelled', messages: [], preserveHistory: true, message: '这段输入的授权已失效，请重新输入。' }
      if (input?.source === 'voice') {
        lease = authority.acquire('mic', input.captureToken || '')
        if (!lease || !audio.consumeTranscript(input.receiptId || '', input.captureToken || '', input.text)) { lease?.finish(); return deny }
      } else if (input?.source && input.source !== 'text') return deny
      if (chat.isBusy()) { lease?.finish(); return chat.send(input) }
      if (!input || typeof input.requestId !== 'string') { lease?.finish(); return chat.send(input) }
      audio.cancelAll()
      vision.cancelAll()
      visualRequestId = ''
      const owned = { id: input.requestId, text: '', valid: true, source: input.source === 'voice' ? 'voice' as const : 'text' as const, requests: new Set<string>() }
      speechTurn = owned
      const onRevoke = () => { owned.valid = false; chat.cancel(input.requestId); audio.cancelAll() }
      lease?.signal.addEventListener('abort', onRevoke, { once: true })
      try {
        const reply = await chat.send(input)
        if (reply.status !== 'complete') owned.valid = false
        const last = reply.messages.at(-1)
        if (last?.role === 'assistant' && typeof last.content === 'string') owned.text = last.content
        return reply
      } finally { lease?.signal.removeEventListener('abort', onRevoke); lease?.finish() }
    },
  }
}
