import type { CaptureKind, ResourceSnapshot } from '@proj-airi/stage-ui/services/resource-policy'
import type { BrowserWindow, IpcMainEvent, WebContents } from 'electron'

import type { ShutdownReceipt } from '../../../shared/eventa/aimy-lifecycle'

import { randomUUID } from 'node:crypto'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { ipcMain } from 'electron'
import { array, boolean, integer, maxLength, minValue, number, object, parse, picklist, pipe, string } from 'valibot'

import { resourceChanged, resourceSetEnabled, resourceSnapshot, shutdownCompleted, shutdownRequested, windowCloseAborted } from '../../../shared/eventa/aimy-lifecycle'
import { isTrustedSender, onTrustedWindowRegistered } from './trusted-windows'

const changeSchema = object({
  kind: picklist(['microphone', 'screen']),
  enabled: boolean(),
  appEpoch: pipe(number(), integer(), minValue(0)),
})
const receiptSchema = object({
  shutdownId: pipe(string(), maxLength(128)),
  phase: picklist(['prepare', 'finalize']),
  stopped: boolean(),
  persisted: boolean(),
  failed: pipe(array(pipe(string(), maxLength(160))), maxLength(100)),
})

/** Owns capture consent in main. Hiding the stage revokes both resources without restoring them on show. */
export class ResourceAuthority {
  private snapshot: ResourceSnapshot = {
    revision: 0,
    appEpoch: 0,
    active: false,
    reason: 'initial',
    microphone: { enabled: false, epoch: 0 },
    screen: { enabled: false, epoch: 0 },
  }

  get state(): ResourceSnapshot {
    return { ...this.snapshot, microphone: { ...this.snapshot.microphone }, screen: { ...this.snapshot.screen } }
  }

  setActive(active: boolean, reason: string): ResourceSnapshot {
    if (!active) {
      this.snapshot.appEpoch++
      for (const kind of ['microphone', 'screen'] as const) {
        this.snapshot[kind] = { enabled: false, epoch: this.snapshot[kind].epoch + 1 }
      }
    }
    this.snapshot = { ...this.snapshot, active, reason, revision: this.snapshot.revision + 1 }
    return this.state
  }

  setEnabled(kind: CaptureKind, enabled: boolean, appEpoch: number): ResourceSnapshot {
    if (appEpoch !== this.snapshot.appEpoch || (enabled && !this.snapshot.active))
      throw new Error('Capture choice expired')
    if (this.snapshot[kind].enabled === enabled)
      return this.state
    this.snapshot[kind] = { enabled, epoch: this.snapshot[kind].epoch + 1 }
    this.snapshot = { ...this.snapshot, reason: enabled ? 'permission-on' : 'permission-off', revision: this.snapshot.revision + 1 }
    return this.state
  }

  allows(kind: CaptureKind): boolean {
    return this.snapshot.active && this.snapshot[kind].enabled
  }

  captureGuard(kind: CaptureKind): () => boolean {
    const appEpoch = this.snapshot.appEpoch
    const epoch = this.snapshot[kind].epoch
    return () => this.allows(kind) && appEpoch === this.snapshot.appEpoch && epoch === this.snapshot[kind].epoch
  }
}

/** Bridges host consent and bounded renderer shutdown through the existing Eventa transport. */
export class DesktopResourceLifecycle {
  readonly authority = new ResourceAuthority()
  private readonly windows = new Map<number, { window: BrowserWindow, context: ReturnType<typeof createContext>['context'], dispose: () => void }>()
  private readonly disposers: (() => void)[] = []
  private readonly pending = new Map<string, { phase: ShutdownReceipt['phase'], expected: Set<number>, receipts: Map<number, ShutdownReceipt>, complete: () => void }>()
  private readonly closing = new Set<number>()
  private readonly closeApproved = new WeakSet<BrowserWindow>()
  private quitting = false
  private stageWindowId: number | undefined

  constructor(context: ReturnType<typeof createContext>['context']) {
    const assertSender = (event: Pick<IpcMainEvent, 'sender' | 'senderFrame'> | undefined) => {
      if (!event?.senderFrame || event.senderFrame !== event.sender.mainFrame || !isTrustedSender(event.sender))
        throw new Error('Resource caller is not authorized')
      return event.sender
    }
    this.disposers.push(defineInvokeHandler(context, resourceSnapshot, (_, options) => {
      assertSender(options?.raw.ipcMainEvent)
      return this.authority.state
    }))
    this.disposers.push(defineInvokeHandler(context, resourceSetEnabled, (request, options) => {
      const sender = assertSender(options?.raw.ipcMainEvent)
      if (this.quitting || this.closing.has(sender.id))
        throw new Error('Resource change is not available')
      const validated = parse(changeSchema, request)
      const next = this.authority.setEnabled(validated.kind, validated.enabled, validated.appEpoch)
      this.publish()
      return next
    }))
    this.disposers.push(defineInvokeHandler(context, shutdownCompleted, (receipt, options) => {
      const sender = assertSender(options?.raw.ipcMainEvent)
      const validated = parse(receiptSchema, receipt)
      const pending = this.pending.get(validated.shutdownId)
      if (!pending || pending.phase !== validated.phase || !pending.expected.has(sender.id))
        return
      pending.receipts.set(sender.id, validated)
      if (pending.receipts.size === pending.expected.size)
        pending.complete()
    }))
    this.disposers.push(onTrustedWindowRegistered((window) => {
      const transport = createContext(ipcMain, window, { onlySameWindow: true })
      const { context } = transport
      const id = window.webContents.id
      this.windows.get(id)?.dispose()
      this.windows.set(id, { window, context, dispose: transport.dispose })
      window.once('closed', () => {
        this.windows.delete(id)
        transport.dispose()
      })
      window.webContents.on('did-finish-load', () => {
        if (!window.isDestroyed())
          context.emit(resourceChanged, this.authority.state)
      })
      window.on('close', (event) => {
        if (event.defaultPrevented || this.quitting || this.closeApproved.has(window))
          return
        event.preventDefault()
        if (this.closing.has(id))
          return
        this.closing.add(id)
        window.setEnabled(false)
        void this.requestShutdown(new Set([id]), 'window', Date.now() + 2500, 'prepare').then((result) => {
          if (this.quitting || window.isDestroyed())
            return
          if (result.status === 'succeeded') {
            this.closeApproved.add(window)
            window.close()
          }
          else {
            window.setEnabled(true)
            context.emit(windowCloseAborted, { shutdownId: result.shutdownId, reason: 'persistence-incomplete' })
            console.error('[window-close] Persistence is incomplete. The window remains open.', { windowId: id, missingWindowIds: result.missingWindowIds })
          }
        }).finally(() => this.closing.delete(id))
      })
    }))
  }

  bindStage(window: BrowserWindow): void {
    this.stageWindowId = window.webContents.id
    const update = (active: boolean, reason: string) => {
      if (this.quitting)
        return
      this.authority.setActive(active, reason)
      this.publish()
    }
    window.on('show', () => update(!window.isMinimized(), 'stage-show'))
    window.on('restore', () => update(window.isVisible(), 'stage-restore'))
    window.on('hide', () => update(false, 'stage-hide'))
    window.on('minimize', () => update(false, 'stage-minimize'))
    window.on('closed', () => update(false, 'stage-closed'))
    update(window.isVisible() && !window.isMinimized(), 'stage-bind')
  }

  authorizeCapture(sender: WebContents | null, kind: CaptureKind): boolean {
    return !!sender && !this.quitting && !this.closing.has(sender.id) && isTrustedSender(sender) && this.authority.allows(kind)
  }

  private publish(): void {
    for (const { window, context } of this.windows.values()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed())
        context.emit(resourceChanged, this.authority.state)
    }
  }

  async shutdown(timeoutMs = 2500): Promise<{ status: 'succeeded' | 'partial', missingWindowIds: number[], receipts: ShutdownReceipt[] }> {
    const deadline = Date.now() + timeoutMs
    this.quitting = true
    for (const { window } of this.windows.values()) {
      if (!window.isDestroyed())
        window.setEnabled(false)
    }
    this.authority.setActive(false, 'quit')
    this.publish()
    const expected = new Set([...this.windows].filter(([, entry]) => isTrustedSender(entry.window.webContents)).map(([id]) => id))
    const prepared = await this.requestShutdown(expected, 'application', deadline, 'prepare')
    if (prepared.status !== 'succeeded' || this.stageWindowId === undefined)
      return prepared
    // Keep the owner available until every caller has finished its accepted writes.
    // Finalization shares the original deadline and is sent only to the host-bound Stage.
    const finalized = await this.requestShutdown(new Set([this.stageWindowId]), 'application', deadline, 'finalize', prepared.shutdownId)
    return { status: finalized.status, missingWindowIds: finalized.missingWindowIds, receipts: [...prepared.receipts, ...finalized.receipts] }
  }

  private async requestShutdown(expected: Set<number>, scope: 'window' | 'application', deadline: number, phase: ShutdownReceipt['phase'], shutdownId: string = randomUUID()): Promise<{ shutdownId: string, status: 'succeeded' | 'partial', missingWindowIds: number[], receipts: ShutdownReceipt[] }> {
    const remaining = deadline - Date.now()
    if (expected.size && remaining <= 0)
      return { shutdownId, status: 'partial', missingWindowIds: [...expected], receipts: [] }
    let complete = () => {}
    const done = new Promise<void>((resolve) => {
      complete = resolve
    })
    const pending = { phase, expected, receipts: new Map<number, ShutdownReceipt>(), complete }
    this.pending.set(shutdownId, pending)
    const timer = setTimeout(complete, Math.max(0, remaining))
    for (const id of expected)
      this.windows.get(id)?.context.emit(shutdownRequested, { shutdownId, deadline, scope, phase })
    if (expected.size)
      await done
    clearTimeout(timer)
    const receipts = [...pending.receipts.values()]
    const missingWindowIds = [...expected].filter(id => !pending.receipts.has(id))
    this.pending.delete(shutdownId)
    return { shutdownId, status: missingWindowIds.length || receipts.some(item => !item.stopped || !item.persisted || item.failed.length) ? 'partial' : 'succeeded', missingWindowIds, receipts }
  }

  dispose(): void {
    this.disposers.forEach(dispose => dispose())
    this.windows.forEach(entry => entry.dispose())
    this.windows.clear()
  }
}
