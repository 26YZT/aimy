import { app, BrowserWindow, ipcMain, safeStorage, globalShortcut, Menu, session, dialog } from 'electron'
import type { IpcMainEvent } from 'electron'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { defineInvoke, defineInvokeHandler } from '@moeru/eventa'
import { settingsGet, settingsSave, chatSend, chatCancel, windowHide, windowQuit, chatUpdate, prepareShutdown, prepareSuspend } from '../shared/contracts'
import { createSettingsStore } from './settings-store'
import { createDesktopChat } from './chat-service'
import { createDesktopMedia, emptySettings } from './media-rpc'

/**
 * Minimal composition adapted from AIRI stage-tamagotchi's window/IPC ownership.
 * main -> settings store -> protected window -> Eventa -> Core Agent -> provider
 * User-enabled devices use ephemeral grants; no hosted account, tools or plugin host.
 */
async function main() {
  app.setName('Aimy')
  app.setPath('userData', process.env.APP_USER_DATA_PATH || resolve(app.getPath('appData'), 'Aimy'))
  await app.whenReady()
  const store = await createSettingsStore(app.getPath('userData'), safeStorage)
  const ownedSession = session.fromPartition('persist:aimy')
  ownedSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ownedSession.setPermissionCheckHandler(() => false)
  const bounds = store.bounds()
  const window = new BrowserWindow({
    title: 'Aimy', width: bounds?.width ?? 1040, height: bounds?.height ?? 760,
    x: bounds?.x, y: bounds?.y, minWidth: 760, minHeight: 580, show: false,
    frame: false, titleBarStyle: process.platform === 'darwin' ? 'hidden' : undefined,
    backgroundColor: '#f6faf8',
    webPreferences: { preload: resolve(import.meta.dirname, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, session: ownedSession },
  })
  let allowedUrl = ''
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => { if (url !== allowedUrl) event.preventDefault() })
  const trusted = (event?: IpcMainEvent) => Boolean(event && event.sender.id === window.webContents.id && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === allowedUrl)
  const adapter = createContext(ipcMain, window, { onlySameWindow: true })
  let media: ReturnType<typeof createDesktopMedia> | undefined
  const chat = createDesktopChat(store, update => {
    media?.remember(update)
    if (!window.isDestroyed() && window.isVisible()) void adapter.context.emit(chatUpdate, update).catch(() => {})
  }, () => {
    const state = media?.authority.state()
    return `${state?.mic.enabled ? '麦克风已获用户授权，只能使用成功转写的语音输入。' : '麦克风关闭。'}${state?.screen.enabled ? '看屏已获用户授权，只能使用已收到的画面观察，不猜测未观测内容。' : '屏幕关闭。'}`
  })
  media = createDesktopMedia({ window, context: adapter.context, settings: store, chat, trusted, allowedUrl: () => allowedUrl })
  defineInvokeHandler(adapter.context, settingsGet, (_value, options) => trusted(options?.raw?.ipcMainEvent) ? store.publicSettings() : emptySettings())
  defineInvokeHandler(adapter.context, settingsSave, (input, options) => { if (!trusted(options?.raw?.ipcMainEvent)) return { ok: false, settings: emptySettings(), message: '请求已拒绝。' }; media!.revokeAll(); return store.save(input) })
  defineInvokeHandler(adapter.context, chatSend, (input, options) => trusted(options?.raw?.ipcMainEvent) ? media!.send(input) : { requestId: '', status: 'failed' as const, messages: [], preserveHistory: true, message: '请求已拒绝。' })
  defineInvokeHandler(adapter.context, chatCancel, (_value, options) => { if (trusted(options?.raw?.ipcMainEvent)) media!.cancel() })
  defineInvokeHandler(adapter.context, windowHide, async (_value, options) => { if (trusted(options?.raw?.ipcMainEvent)) await hideSafely() })
  defineInvokeHandler(adapter.context, windowQuit, (_value, options) => { if (trusted(options?.raw?.ipcMainEvent)) setImmediate(() => app.quit()) })
  let quitting = false
  let preparingQuit = false
  let boundsTimer: ReturnType<typeof setTimeout> | undefined
  let preparingHide = false
  const invokePrepareSuspend = defineInvoke(adapter.context, prepareSuspend)
  async function hideSafely() {
    if (preparingHide || quitting || window.isDestroyed()) return
    preparingHide = true
    media!.revokeAll()
    try {
      if (!await invokePrepareSuspend(undefined, { signal: AbortSignal.timeout(3_000) })) throw new Error()
      media!.setVisible(false)
      window.hide()
    } catch {
      await dialog.showMessageBox(window, { type: 'error', title: 'Aimy', message: '尚未确认设备停止，窗口已保留。请重试关闭。', buttons: ['返回 Aimy'] })
    } finally { preparingHide = false }
  }
  window.on('close', (event) => { if (!quitting) { event.preventDefault(); void hideSafely() } })
  window.on('hide', () => media!.setVisible(false))
  window.on('minimize', () => { media!.setVisible(false); void invokePrepareSuspend(undefined, { signal: AbortSignal.timeout(3_000) }).catch(() => {}) })
  window.on('restore', () => media!.setVisible(true))
  window.webContents.on('did-start-navigation', details => { if (details.isMainFrame && !details.isSameDocument) media!.revokeAll() })
  window.webContents.on('render-process-gone', () => media!.revokeAll())
  const show = () => { if (!window.isDestroyed()) { media!.setVisible(true); if (window.isMinimized()) window.restore(); window.show(); window.focus() } }
  app.on('activate', show)
  if (process.platform === 'darwin') app.dock?.setMenu(Menu.buildFromTemplate([{ label: '显示 Aimy', click: show }]))
  globalShortcut.register('CommandOrControl+Shift+A', show)
  const invokePrepareShutdown = defineInvoke(adapter.context, prepareShutdown)
  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    if (preparingQuit) return
    preparingQuit = true
    clearTimeout(boundsTimer)
    boundsTimer = undefined
    media!.revokeAll()
    void (async () => {
      try {
        if (!window.isDestroyed()) {
          const saved = await invokePrepareShutdown(undefined, { signal: AbortSignal.timeout(10_000) })
          if (!saved) throw new Error()
          // Queue behind all earlier configuration/position writes, then await the final bounds.
          await store.setBounds(window.getBounds())
        }
        quitting = true
        adapter.dispose()
        globalShortcut.unregisterAll()
        app.quit()
      } catch {
        preparingQuit = false
        show()
        if (!window.isDestroyed()) await dialog.showMessageBox(window, { type: 'error', title: 'Aimy', message: '本地记录尚未完成保存，窗口已保留。请重试保存后退出。', buttons: ['返回 Aimy'] })
      }
    })()
  })
  const scheduleBounds = () => {
    if (preparingQuit || quitting) return
    clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => { void store.setBounds(window.getBounds()).catch(() => {}) }, 150)
  }
  window.on('resize', scheduleBounds); window.on('move', scheduleBounds)
  window.once('ready-to-show', show)
  if (process.env.ELECTRON_RENDERER_URL) {
    allowedUrl = new URL(process.env.ELECTRON_RENDERER_URL).href
    await window.loadURL(allowedUrl)
    allowedUrl = window.webContents.getURL()
  } else {
    const file = resolve(import.meta.dirname, '../renderer/index.html')
    allowedUrl = pathToFileURL(file).href
    await window.loadFile(file)
    allowedUrl = window.webContents.getURL()
  }
}
void main().catch(() => { console.error('Aimy 启动失败，请检查本地安装。'); app.exit(1) })
