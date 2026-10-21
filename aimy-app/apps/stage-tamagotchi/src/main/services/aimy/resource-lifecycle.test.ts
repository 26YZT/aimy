import type { ShutdownRequest } from '../../../shared/eventa/aimy-lifecycle'

import { createContext } from '@moeru/eventa/adapters/electron/main'
import { BrowserWindow, ipcMain } from 'electron'
import { createPinia, defineStore, disposePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PersistenceDrain, WindowShutdownCoordinator } from '../../../renderer/bridges/persistence-drain'
import { resourceSetEnabled, shutdownCompleted } from '../../../shared/eventa/aimy-lifecycle'
import { DesktopResourceLifecycle, ResourceAuthority } from './resource-lifecycle'
import { isTrustedSender, registerTrustedWindow } from './trusted-windows'

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (input: unknown, metadata: unknown) => unknown>(),
  requests: [] as (ShutdownRequest & { windowId: number })[],
  renderers: new Map<number, (request: ShutdownRequest) => void>(),
  nextId: 1,
}))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    ipcMain: new EventEmitter(),
    BrowserWindow: class extends EventEmitter {
      webContents = Object.assign(new EventEmitter(), {
        id: ipc.nextId++,
        isDestroyed: () => false,
        getURL: () => 'file:///app/index.html',
        mainFrame: { url: 'file:///app/index.html' },
      })

      isDestroyed = () => false
      isMinimized = () => false
      isVisible = () => true
      close = vi.fn()
      setEnabled = vi.fn()
    },
  }
})
vi.mock('@moeru/eventa/adapters/electron/main', () => ({ createContext: (_ipc: unknown, window?: { webContents: { id: number } }) => ({ dispose: vi.fn(), context: {
  emit: vi.fn((_event: unknown, body: Partial<ShutdownRequest>) => {
    if (window && body.shutdownId && body.scope && body.phase && body.deadline !== undefined) {
      const request = body as ShutdownRequest
      ipc.requests.push({ ...request, windowId: window.webContents.id })
      ipc.renderers.get(window.webContents.id)?.(request)
    }
  }),
} }) }))
vi.mock('@moeru/eventa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@moeru/eventa')>()
  return {
    ...actual,
    defineInvokeHandler: (_context: unknown, event: { sendEvent: { id: string } }, handler: (input: unknown, metadata: unknown) => unknown) => {
      ipc.handlers.set(event.sendEvent.id, handler)
      return () => ipc.handlers.delete(event.sendEvent.id)
    },
  }
})

afterEach(() => {
  ipc.handlers.clear()
  ipc.requests.length = 0
  ipc.renderers.clear()
  vi.useRealTimers()
})

describe('desktop resource authority', () => {
  it('reads an already-visible stage at binding and does not revoke on focus loss', () => {
    const { context } = createContext(ipcMain)
    const service = new DesktopResourceLifecycle(context)
    const window = new BrowserWindow()
    service.bindStage(window)
    expect(service.authority.state.active).toBe(true)
    service.authority.setEnabled('microphone', true, service.authority.state.appEpoch)
    window.emit('blur')
    expect(service.authority.allows('microphone')).toBe(true)
    window.emit('hide')
    expect(service.authority.allows('microphone')).toBe(false)
    window.emit('show')
    expect(service.authority.state.active).toBe(true)
    expect(service.authority.allows('microphone')).toBe(false)
    service.dispose()
  })

  it('keeps resources off at startup and after hide/restore, and ignores repeated grants', () => {
    const authority = new ResourceAuthority()
    expect(authority.allows('microphone')).toBe(false)
    authority.setActive(true, 'show')
    authority.setEnabled('microphone', true, 0)
    const guard = authority.captureGuard('microphone')
    authority.setEnabled('microphone', true, 0)
    expect(guard()).toBe(true)
    expect(authority.allows('screen')).toBe(false)
    authority.setActive(false, 'hide')
    authority.setActive(true, 'show')
    expect(guard()).toBe(false)
    expect(authority.allows('microphone')).toBe(false)
    expect(() => authority.setEnabled('screen', true, 0)).toThrow('expired')
  })

  it('requires a host-registered main frame and revokes its capability after navigation', () => {
    const { context } = createContext(ipcMain)
    const service = new DesktopResourceLifecycle(context)
    const window = new BrowserWindow()
    const invoke = ipc.handlers.get(resourceSetEnabled.sendEvent.id)!
    const request = { kind: 'microphone', enabled: true, appEpoch: 0 }
    const metadata = { raw: { ipcMainEvent: { sender: window.webContents, senderFrame: window.webContents.mainFrame } } }
    expect(() => invoke(request, metadata)).toThrow('not authorized')
    registerTrustedWindow(window, 'file:///app/index.html')
    service.authority.setActive(true, 'show')
    expect(() => invoke(request, { raw: { ipcMainEvent: { sender: window.webContents, senderFrame: {} } } })).toThrow('not authorized')
    expect(() => invoke(request, metadata)).not.toThrow()
    expect(isTrustedSender(window.webContents)).toBe(true)
    window.webContents.emit('did-navigate', {}, 'https://example.invalid/')
    expect(isTrustedSender(window.webContents)).toBe(false)
    window.emit('closed')
    service.dispose()
  })

  it('reports missing renderer acknowledgements at the finite deadline', async () => {
    vi.useFakeTimers()
    const { context } = createContext(ipcMain)
    const service = new DesktopResourceLifecycle(context)
    const window = new BrowserWindow()
    registerTrustedWindow(window, 'file:///app/index.html')
    service.authority.setActive(true, 'show')
    service.authority.setEnabled('screen', true, 0)
    const exiting = service.shutdown(50)
    expect(service.authority.allows('screen')).toBe(false)
    await vi.advanceTimersByTimeAsync(50)
    await expect(exiting).resolves.toMatchObject({ status: 'partial', missingWindowIds: [window.webContents.id] })
    window.emit('closed')
    service.dispose()
  })

  it('does not accept an unrelated or forged shutdown receipt', async () => {
    vi.useFakeTimers()
    const { context } = createContext(ipcMain)
    const service = new DesktopResourceLifecycle(context)
    const window = new BrowserWindow()
    registerTrustedWindow(window, 'file:///app/index.html')
    const exiting = service.shutdown(10)
    const invoke = ipc.handlers.get(shutdownCompleted.sendEvent.id)!
    invoke({ shutdownId: 'another-shutdown', phase: 'prepare', stopped: true, persisted: true, failed: [] }, { raw: { ipcMainEvent: { sender: window.webContents, senderFrame: window.webContents.mainFrame } } })
    await vi.advanceTimersByTimeAsync(10)
    await expect(exiting).resolves.toMatchObject({ status: 'partial' })
    window.emit('closed')
    service.dispose()
  })

  it('holds a settings window open until its own flush completes without stopping the stage', async () => {
    const { context } = createContext(ipcMain)
    const service = new DesktopResourceLifecycle(context)
    const window = new BrowserWindow()
    registerTrustedWindow(window, 'file:///app/index.html')
    service.authority.setActive(true, 'show')
    service.authority.setEnabled('microphone', true, 0)
    const preventDefault = vi.fn()
    window.emit('close', { defaultPrevented: false, preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(window.close).not.toHaveBeenCalled()
    expect(service.authority.allows('microphone')).toBe(true)
    expect(service.authorizeCapture(window.webContents, 'microphone')).toBe(false)
    const request = ipc.requests.at(-1)!
    expect(request.scope).toBe('window')
    const invoke = ipc.handlers.get(shutdownCompleted.sendEvent.id)!
    invoke({ shutdownId: request.shutdownId, phase: 'prepare', stopped: true, persisted: true, failed: [] }, { raw: { ipcMainEvent: { sender: window.webContents, senderFrame: window.webContents.mainFrame } } })
    await vi.waitFor(() => expect(window.close).toHaveBeenCalledOnce())
    window.emit('closed')
    service.dispose()
  })

  it('keeps the window open when its flush reports failure', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { context } = createContext(ipcMain)
    const service = new DesktopResourceLifecycle(context)
    const window = new BrowserWindow()
    registerTrustedWindow(window, 'file:///app/index.html')
    window.emit('close', { defaultPrevented: false, preventDefault: vi.fn() })
    const request = ipc.requests.at(-1)!
    const invoke = ipc.handlers.get(shutdownCompleted.sendEvent.id)!
    invoke({ shutdownId: request.shutdownId, phase: 'prepare', stopped: true, persisted: false, failed: ['provider:flush'] }, { raw: { ipcMainEvent: { sender: window.webContents, senderFrame: window.webContents.mainFrame } } })
    await vi.waitFor(() => expect(log).toHaveBeenCalled())
    expect(window.close).not.toHaveBeenCalled()
    window.emit('closed')
    service.dispose()
    log.mockRestore()
  })

  it('waits for a settings secure-save prefix and its owner commit before finalizing the Stage', async () => {
    const { context } = createContext(ipcMain)
    const service = new DesktopResourceLifecycle(context)
    const stage = new BrowserWindow()
    const settings = new BrowserWindow()
    registerTrustedWindow(stage, 'file:///app/index.html')
    registerTrustedWindow(settings, 'file:///app/index.html')
    service.bindStage(stage)
    const secureWrite = Promise.withResolvers<void>()
    const durableCommit = Promise.withResolvers<void>()
    const order: string[] = []
    const stagePinia = createPinia()
    const settingsPinia = createPinia()
    const owner = defineStore('shutdown-owner', {
      actions: {
        async commit() {
          order.push('owner:commit-start')
          await durableCommit.promise
          order.push('owner:committed')
        },
      },
    })(stagePinia)
    const caller = defineStore('shutdown-caller', {
      actions: {
        async saveConfiguration() {
          await secureWrite.promise
          order.push('settings:secure-written')
          await owner.commit()
          order.push('settings:saved')
        },
      },
    })(settingsPinia)
    const stageDrain = new PersistenceDrain()
    const settingsDrain = new PersistenceDrain()
    stageDrain.track(owner, ['commit'])
    settingsDrain.track(caller, ['saveConfiguration'])
    for (const [window, drain, label] of [[stage, stageDrain, 'stage'], [settings, settingsDrain, 'settings']] as const) {
      const coordinator = new WindowShutdownCoordinator(new Set([{
        id: label,
        begin: (request: ShutdownRequest) => drain.begin(request.shutdownId),
        drain: (request: ShutdownRequest) => drain.waitFor(request.shutdownId, request.deadline),
        stop: () => { order.push(`${label}:stop`) },
        flush: () => { order.push(`${label}:flush`) },
        finalize: () => { order.push(`${label}:disposed`) },
      }]))
      ipc.renderers.set(window.webContents.id, (request) => {
        void coordinator.run(request).then((receipt) => {
          order.push(`${label}:${request.phase}:ack`)
          ipc.handlers.get(shutdownCompleted.sendEvent.id)!(receipt, { raw: { ipcMainEvent: { sender: window.webContents, senderFrame: window.webContents.mainFrame } } })
        })
      })
    }
    const saving = caller.saveConfiguration()
    const exiting = service.shutdown(1500)
    await vi.waitFor(() => expect(order).toContain('stage:prepare:ack'))
    expect(ipc.requests.map(request => request.phase)).toEqual(['prepare', 'prepare'])
    expect(order).not.toContain('stage:disposed')
    secureWrite.resolve()
    await vi.waitFor(() => expect(order).toContain('owner:commit-start'))
    expect(order).not.toContain('settings:prepare:ack')
    durableCommit.resolve()
    await saving
    await expect(exiting).resolves.toMatchObject({ status: 'succeeded', missingWindowIds: [] })
    expect(order.indexOf('stage:disposed')).toBeGreaterThan(order.indexOf('settings:prepare:ack'))
    expect(order.indexOf('settings:prepare:ack')).toBeGreaterThan(order.indexOf('owner:committed'))
    expect(order).not.toContain('settings:disposed')
    expect(ipc.requests.filter(request => request.phase === 'finalize').map(request => request.windowId)).toEqual([stage.webContents.id])
    expect(new Set(ipc.requests.map(request => request.deadline)).size).toBe(1)
    expect(new Set(ipc.requests.map(request => request.shutdownId)).size).toBe(1)
    stage.emit('closed')
    settings.emit('closed')
    service.dispose()
    disposePinia(stagePinia)
    disposePinia(settingsPinia)
  })

  it('rejects a late prepare receipt during finalize and keeps one deadline across both phases', async () => {
    vi.useFakeTimers()
    const { context } = createContext(ipcMain)
    const service = new DesktopResourceLifecycle(context)
    const stage = new BrowserWindow()
    registerTrustedWindow(stage, 'file:///app/index.html')
    service.bindStage(stage)
    const exiting = service.shutdown(100)
    const request = ipc.requests.at(-1)!
    const invoke = ipc.handlers.get(shutdownCompleted.sendEvent.id)!
    const metadata = { raw: { ipcMainEvent: { sender: stage.webContents, senderFrame: stage.webContents.mainFrame } } }
    const receipt = { shutdownId: request.shutdownId, phase: 'prepare', stopped: true, persisted: true, failed: [] }
    await vi.advanceTimersByTimeAsync(75)
    invoke(receipt, metadata)
    await vi.advanceTimersByTimeAsync(0)
    expect(ipc.requests.at(-1)?.phase).toBe('finalize')
    invoke(receipt, metadata)
    await vi.advanceTimersByTimeAsync(25)
    await expect(exiting).resolves.toMatchObject({ status: 'partial', missingWindowIds: [stage.webContents.id] })
    expect(new Set(ipc.requests.map(item => item.deadline)).size).toBe(1)
    stage.emit('closed')
    service.dispose()
  })

  it('does not finalize the owner when another window reports a pending save failure', async () => {
    const { context } = createContext(ipcMain)
    const service = new DesktopResourceLifecycle(context)
    const stage = new BrowserWindow()
    const settings = new BrowserWindow()
    for (const window of [stage, settings])
      registerTrustedWindow(window, 'file:///app/index.html')
    service.bindStage(stage)
    const exiting = service.shutdown(100)
    const invoke = ipc.handlers.get(shutdownCompleted.sendEvent.id)!
    for (const window of [stage, settings]) {
      invoke({ shutdownId: ipc.requests[0].shutdownId, phase: 'prepare', stopped: true, persisted: window === stage, failed: window === stage ? [] : ['settings:drain'] }, { raw: { ipcMainEvent: { sender: window.webContents, senderFrame: window.webContents.mainFrame } } })
    }
    await expect(exiting).resolves.toMatchObject({ status: 'partial' })
    expect(ipc.requests.every(request => request.phase === 'prepare')).toBe(true)
    stage.emit('closed')
    settings.emit('closed')
    service.dispose()
  })
})
