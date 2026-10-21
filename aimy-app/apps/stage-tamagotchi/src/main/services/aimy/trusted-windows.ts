import type { BrowserWindow, WebContents } from 'electron'

import { isLocalAppURL } from '../../libs/electron/url'

const windows = new Map<number, { window: BrowserWindow, document: string }>()
const listeners = new Set<(window: BrowserWindow) => void>()

function documentIdentity(raw: string): string {
  const url = new URL(raw)
  return `${url.protocol}//${url.host}${url.pathname}`
}

/** Only the host loader grants this capability. Renderer URLs cannot register a window. */
export function registerTrustedWindow(window: BrowserWindow, documentUrl: string): void {
  const id = window.webContents.id
  if (!isLocalAppURL(documentUrl)) {
    windows.delete(id)
    return
  }
  const document = documentIdentity(documentUrl)
  const previous = windows.get(id)
  if (previous) {
    if (previous.document !== document)
      windows.delete(id)
    return
  }
  windows.set(id, { window, document })
  window.once('closed', () => windows.delete(id))
  window.webContents.on('did-navigate', (_, url) => {
    if (documentIdentity(url) !== document)
      windows.delete(id)
  })
  for (const listener of listeners)
    listener(window)
}

export function isTrustedSender(sender: WebContents): boolean {
  const entry = windows.get(sender.id)
  if (!entry || sender.isDestroyed() || entry.window.isDestroyed() || entry.window.webContents !== sender)
    return false
  try {
    return isLocalAppURL(sender.getURL())
      && documentIdentity(sender.getURL()) === entry.document
      && documentIdentity(sender.mainFrame.url) === entry.document
  }
  catch {
    return false
  }
}

export function onTrustedWindowRegistered(listener: (window: BrowserWindow) => void): () => void {
  listeners.add(listener)
  for (const { window } of windows.values())
    listener(window)
  return () => listeners.delete(listener)
}
