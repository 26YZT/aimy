import { BrowserWindow, desktopCapturer } from 'electron'
import { describe, expect, it, vi } from 'vitest'

import { screenCapture } from '..'
import { hasSelectedScreenCaptureSource, initScreenCaptureForMain, initScreenCaptureForWindow } from './index'

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (input: unknown, metadata: unknown) => Promise<unknown>>(),
  display: undefined as undefined | ((request: { frame: unknown }, callback: (streams: object) => void) => Promise<void>),
}))
vi.mock('electron', () => ({
  app: { commandLine: { getSwitchValue: () => '', hasSwitch: () => false, appendSwitch: vi.fn() } },
  ipcMain: {},
  desktopCapturer: { getSources: vi.fn(async () => []) },
  session: { defaultSession: { setDisplayMediaRequestHandler: (handler: typeof ipc.display) => { ipc.display = handler } } },
  BrowserWindow: class {
    id = 1
    webContents = { id: 1, mainFrame: {} }
    isDestroyed = () => false
    getTitle = () => 'Synthetic window'
  },
}))
vi.mock('@moeru/eventa/adapters/electron/main', () => ({ createContext: () => ({ context: {} }) }))
vi.mock('@moeru/eventa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@moeru/eventa')>()
  return {
    ...actual,
    defineInvokeHandler: (_context: unknown, event: { sendEvent: { id: string } }, handler: (input: unknown, metadata: unknown) => Promise<unknown>) => {
      ipc.handlers.set(event.sendEvent.id, handler)
      return () => ipc.handlers.delete(event.sendEvent.id)
    },
  }
})

describe('screen capture host guard', () => {
  it('guards thumbnails, pending source selection, and the final display callback with the same frame and epoch', async () => {
    let enabled = false
    let epoch = 0
    initScreenCaptureForMain({
      authorizeCapture(window, frame) {
        if (!enabled || frame !== window.webContents.mainFrame)
          throw new Error('Capture denied')
        const captured = epoch
        return () => enabled && captured === epoch
      },
    })
    const window = new BrowserWindow()
    initScreenCaptureForWindow(window)
    const metadata = { raw: { ipcMainEvent: { sender: window.webContents, senderFrame: window.webContents.mainFrame } } }
    const sources = ipc.handlers.get(screenCapture.getSources.sendEvent.id)!
    const select = ipc.handlers.get(screenCapture.setSource.sendEvent.id)!
    const reset = ipc.handlers.get(screenCapture.resetSource.sendEvent.id)!
    await expect(sources({ types: ['screen'] }, metadata)).rejects.toThrow('denied')
    expect(desktopCapturer.getSources).not.toHaveBeenCalled()
    enabled = true
    await expect(sources({ types: ['screen'] }, { raw: { ipcMainEvent: { sender: window.webContents, senderFrame: {} } } })).rejects.toThrow('denied')

    let finish: (value: []) => void = () => {}
    vi.mocked(desktopCapturer.getSources).mockImplementationOnce(() => new Promise((resolve) => {
      finish = resolve
    }))
    const pending = sources({ types: ['screen'] }, metadata)
    epoch++
    finish([])
    await expect(pending).rejects.toThrow('expired')

    const request = { sourceId: 'screen:synthetic', options: { types: ['screen'] } }
    const handle = await select(request, metadata)
    expect(hasSelectedScreenCaptureSource(window.webContents.id)).toBe(true)
    expect(hasSelectedScreenCaptureSource(window.webContents.id + 1)).toBe(false)
    const waiting = select(request, metadata)
    const denied = expect(waiting).rejects.toThrow('expired')
    enabled = false
    epoch++
    const callback = vi.fn()
    const before = vi.mocked(desktopCapturer.getSources).mock.calls.length
    await ipc.display?.({ frame: window.webContents.mainFrame }, callback)
    expect(callback).toHaveBeenCalledWith({})
    expect(desktopCapturer.getSources).toHaveBeenCalledTimes(before)
    await reset(handle, metadata)
    await denied
  })
})
