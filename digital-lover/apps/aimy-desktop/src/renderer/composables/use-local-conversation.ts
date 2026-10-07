import type { ChatHistoryItem } from '@proj-airi/core-agent'
import type { AimyBridge, ChatRequest } from '../../shared/contracts'
import type { ChatSessionRecord } from '../airi-local/types/chat-session'

import { computed, onScopeDispose, ref } from 'vue'

import { chatSessionsRepo } from '../airi-local/database/repos/chat-sessions.repo'

export const CHARACTER_ID = 'prototype-vroid-sample-a'
const USER_ID = 'local'

export interface SharedImage {
  name: string
  mimeType: string
  data: string
  url: string
}

export type CaptureOrigin = Pick<ChatRequest, 'source' | 'captureToken' | 'receiptId'>
export interface ConversationTurnListener {
  start?: (requestId: string) => void
  update?: (requestId: string, text: string) => void
  end?: (requestId: string, text: string, complete: boolean) => void
  cancel?: () => void
}

function newRecord(): ChatSessionRecord {
  const now = Date.now()
  return {
    meta: { sessionId: crypto.randomUUID(), userId: USER_ID, characterId: CHARACTER_ID, createdAt: now, updatedAt: now },
    messages: [],
  }
}

/** Local-only composition around AIRI's repository; no cloud session store is mounted. */
export function useLocalConversation(bridge: AimyBridge) {
  const record = ref<ChatSessionRecord>(newRecord())
  const ready = ref(false)
  const restoring = ref(true)
  const writing = ref(false)
  const activeRequestId = ref<string>()
  const streamText = ref('')
  const error = ref('')
  const notice = ref('')
  const unsaved = ref<ChatSessionRecord>()
  const shuttingDown = ref(false)
  const busy = computed(() => shuttingDown.value || !!activeRequestId.value || writing.value || !ready.value)
  const messages = computed(() => record.value.messages.filter(message => ['user', 'assistant', 'error'].includes(message.role)))
  let disposed = false
  let cancellationRequestedId: string | undefined
  let writes = Promise.resolve()
  let activeSend: Promise<boolean> | undefined
  let pendingObservation: Promise<boolean> | undefined
  let shutdownPromise: Promise<boolean> | undefined
  const operations = new Set<Promise<unknown>>()
  const turnListeners = new Set<ConversationTurnListener>()

  function notify(event: (listener: ConversationTurnListener) => void) {
    for (const listener of turnListeners) {
      try { event(listener) }
      catch { /* Presentation observers cannot prevent saving a conversation. */ }
    }
  }

  function onTurn(listener: ConversationTurnListener) {
    turnListeners.add(listener)
    return () => { turnListeners.delete(listener) }
  }

  function track<T>(operation: Promise<T>) {
    operations.add(operation)
    void operation.then(() => operations.delete(operation), () => operations.delete(operation))
    return operation
  }

  // Serial writes let a clear wait for the prior write before deleting the old session.
  function enqueueWrite(operation: () => Promise<void>) {
    const result = writes.then(operation)
    writes = result.catch(() => {})
    return result
  }

  async function writeRecord(next: ChatSessionRecord) {
      await chatSessionsRepo.saveSession(next.meta.sessionId, next)
      await chatSessionsRepo.saveIndex({
        userId: USER_ID,
        characters: { [CHARACTER_ID]: { activeSessionId: next.meta.sessionId, sessions: { [next.meta.sessionId]: next.meta } } },
      })
  }

  async function save(next: ChatSessionRecord) {
    await enqueueWrite(() => writeRecord(next))
  }

  async function restoreImpl() {
    restoring.value = true
    ready.value = false
    error.value = ''
    try {
      const index = await chatSessionsRepo.getIndex(USER_ID)
      const activeId = index?.characters[CHARACTER_ID]?.activeSessionId
      if (activeId) {
        const stored = await chatSessionsRepo.getSession(activeId)
        if (!stored || !Array.isArray(stored.messages) || stored.meta.sessionId !== activeId)
          throw new Error('Invalid local session')
        record.value = stored
      }
      else {
        const next = newRecord()
        await save(next)
        record.value = next
      }
      ready.value = true
    }
    catch {
      error.value = '无法读取本地对话。请重试，或确认后清空本地对话；当前不会发送消息。'
    }
    finally {
      restoring.value = false
    }
  }

  function restore() {
    if (shuttingDown.value || disposed)
      return Promise.resolve()
    return track(restoreImpl())
  }

  const unsubscribe = bridge.onChatUpdate((update) => {
    if (!disposed && update.requestId === activeRequestId.value) {
      streamText.value = update.text
      notify(listener => listener.update?.(update.requestId, update.text))
    }
  })

  async function sendImpl(text: string, image?: SharedImage, onAccepted?: () => void, origin?: CaptureOrigin) {
    if (busy.value || (!text.trim() && !image))
      return false

    error.value = ''
    notice.value = ''
    streamText.value = ''
    const requestId = crypto.randomUUID()
    const sessionId = record.value.meta.sessionId
    const prior = JSON.parse(JSON.stringify(record.value.messages)) as ChatHistoryItem[]
    const user: ChatHistoryItem = {
      id: crypto.randomUUID(), role: 'user', createdAt: Date.now(),
      content: image
        ? [{ type: 'text', text: text.trim() }, { type: 'image_url', image_url: { url: image.url } }]
        : text.trim(),
    }
    let pendingWrite: ChatSessionRecord | undefined
    cancellationRequestedId = undefined
    activeRequestId.value = requestId
    try {
      // Persist the user's input before making an external call or clearing the composer.
      const pending = { meta: { ...record.value.meta, updatedAt: Date.now() }, messages: [...prior, user] }
      pendingWrite = pending
      await save(pending)
      pendingWrite = undefined
      if (disposed || activeRequestId.value !== requestId || record.value.meta.sessionId !== sessionId)
        return false
      record.value = pending
      onAccepted?.()
      if (cancellationRequestedId === requestId) {
        notice.value = '已停止生成；你的消息已保存在本地。'
        return true
      }
      notify(listener => listener.start?.(requestId))
      const reply = await bridge.send({
        requestId, sessionId, messages: prior, text: text.trim(),
        attachments: image ? [{ type: 'image', data: image.data, mimeType: image.mimeType }] : undefined,
        ...origin,
      })
      if (disposed || reply.requestId !== requestId || activeRequestId.value !== requestId || record.value.meta.sessionId !== sessionId)
        return false
      // Preflight failures have no new authoritative runtime transcript. Keep the
      // user's already committed message and the prior session rather than dropping them.
      const next = {
        meta: { ...record.value.meta, updatedAt: Date.now() },
        messages: reply.preserveHistory
          ? JSON.parse(JSON.stringify(record.value.messages)) as ChatHistoryItem[]
          : reply.messages,
      }
      pendingWrite = next
      await save(next)
      pendingWrite = undefined
      if (disposed || activeRequestId.value !== requestId || record.value.meta.sessionId !== sessionId)
        return false
      record.value = next
      const last = [...reply.messages].reverse().find(message => message.role === 'assistant')
      notify(listener => listener.end?.(requestId, typeof last?.content === 'string' ? last.content : '', reply.status === 'complete'))
      if (reply.status === 'failed' || reply.status === 'configuration-required' || reply.status === 'busy')
        error.value = reply.message || '这次回复未完成。请检查模型服务后再试。'
      else if (reply.status === 'cancelled')
        notice.value = '已停止生成；已收到的内容保存在本地。'
      return true
    }
    catch {
      if (disposed || activeRequestId.value !== requestId || record.value.meta.sessionId !== sessionId)
        return false
      notify(listener => listener.cancel?.())
      // Never reflect an IPC exception, provider response or stack into the renderer.
      if (pendingWrite) {
        unsaved.value = pendingWrite
        ready.value = false
        error.value = '这轮消息未能保存。请重试保存；保存成功前不会发送新消息。'
      }
      else {
        error.value = '这次对话未能完成。已保存的记录仍在本地，请检查服务后再试。'
      }
      return false
    }
    finally {
      if (activeRequestId.value === requestId) {
        activeRequestId.value = undefined
        streamText.value = ''
      }
    }
  }

  function send(text: string, image?: SharedImage, onAccepted?: () => void, origin?: CaptureOrigin) {
    if (disposed || busy.value || (!text.trim() && !image))
      return Promise.resolve(false)
    const operation = track(sendImpl(text, image, onAccepted, origin))
    activeSend = operation
    void operation.then(() => {
      if (activeSend === operation)
        activeSend = undefined
    }, () => {
      if (activeSend === operation)
        activeSend = undefined
    })
    return operation
  }

  async function recoverImpl() {
    if (writing.value || restoring.value)
      return
    if (!unsaved.value) {
      await restoreImpl()
      return
    }
    writing.value = true
    try {
      const next = JSON.parse(JSON.stringify(unsaved.value)) as ChatSessionRecord
      await save(next)
      record.value = next
      unsaved.value = undefined
      ready.value = true
      error.value = ''
      notice.value = '本地对话已重新保存。'
    }
    catch {
      error.value = '仍然无法保存，请检查磁盘或重试。当前不会发送新消息。'
    }
    finally {
      writing.value = false
    }
  }

  function recover() {
    if (shuttingDown.value || disposed)
      return Promise.resolve()
    return track(recoverImpl())
  }

  async function cancel() {
    notify(listener => listener.cancel?.())
    if (!activeRequestId.value)
      return
    const requestId = activeRequestId.value
    // The user can stop while the initial IndexedDB write is still pending.
    cancellationRequestedId = requestId
    try {
      await bridge.cancel()
      if (activeRequestId.value === requestId)
        notice.value = '正在停止生成…'
    }
    catch {
      if (activeRequestId.value === requestId)
        error.value = '未能确认停止。请稍后重试。'
    }
  }

  async function clearImpl() {
    if (writing.value)
      return
    writing.value = true
    notify(listener => listener.cancel?.())
    ready.value = false
    // Invalidate before awaiting cancel, so a completed old request cannot repopulate the UI.
    activeRequestId.value = undefined
    streamText.value = ''
    try {
      await bridge.cancel()
      const next = newRecord()
      await enqueueWrite(async () => { await chatSessionsRepo.clear(USER_ID) })
      await save(next)
      record.value = next
      unsaved.value = undefined
      error.value = ''
      notice.value = '本地对话已清空，已开始新的会话。'
      ready.value = true
    }
    catch {
      error.value = '本地对话未能完整清空。请重试；当前不会发送消息。'
    }
    finally {
      writing.value = false
    }
  }

  function clear() {
    if (shuttingDown.value || disposed)
      return Promise.resolve()
    return track((async () => {
      if (pendingObservation)
        await pendingObservation
      await clearImpl()
    })())
  }

  function appendObservation(text: string, turnId: string, currentGuard: () => boolean): Promise<boolean> {
    if (disposed || busy.value || !currentGuard() || !text.trim())
      return Promise.resolve(false)
    const prior = JSON.parse(JSON.stringify(record.value)) as ChatSessionRecord
    const sessionId = prior.meta.sessionId
    const current = () => !disposed && !shuttingDown.value && !activeRequestId.value && record.value.meta.sessionId === sessionId && currentGuard()
    writing.value = true
    const operation = track((async () => {
      let committed = false
      try {
        await enqueueWrite(async () => {
          if (!current())
            return
          const next: ChatSessionRecord = {
            meta: { ...prior.meta, updatedAt: Date.now() },
            messages: [...prior.messages, { id: `screen-${turnId}`, role: 'assistant', content: text, slices: [{ type: 'text', text }], tool_results: [], createdAt: Date.now() }],
          }
          try {
            await writeRecord(next)
            if (!current()) {
              await writeRecord(prior)
              return
            }
            record.value = next
            committed = true
            // No await between the last guard and presentation: a revoked observation
            // cannot enter the UI/readout after its asynchronous write completes.
            notify(listener => listener.start?.(turnId))
            notify(listener => listener.update?.(turnId, text))
            notify(listener => listener.end?.(turnId, text, true))
          }
          catch {
            try { await writeRecord(prior) }
            catch {
              unsaved.value = prior
              ready.value = false
            }
            error.value = '画面观察未能安全保存，已保留原对话。请检查本地存储。'
          }
        })
      }
      finally { writing.value = false }
      return committed
    })())
    pendingObservation = operation
    const clearPending = () => { if (pendingObservation === operation) pendingObservation = undefined }
    void operation.then(clearPending, clearPending)
    return operation
  }

  function shutdown(): Promise<boolean> {
    if (disposed)
      return Promise.resolve(false)
    if (shutdownPromise)
      return shutdownPromise

    // Lock synchronously before any await, including the user's initial save.
    shuttingDown.value = true
    let abandoned = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const flush = (async () => {
      await cancel()
      const sending = activeSend
      if (sending)
        await sending
      const settled = await Promise.allSettled([...operations])
      await writes
      if (abandoned || settled.some(result => result.status === 'rejected'))
        return false
      if (unsaved.value) {
        await track(recoverImpl())
        await writes
      }
      return !abandoned && ready.value && !unsaved.value && !writing.value && !restoring.value && !activeRequestId.value
    })()
    const deadline = new Promise<boolean>((resolve) => {
      // Leave time for the main process's 10-second RPC and bounds flush.
      timeout = setTimeout(() => resolve(false), 8_000)
    })
    shutdownPromise = Promise.race([flush, deadline]).catch(() => false).then((saved) => {
      if (!saved) {
        abandoned = true
        shuttingDown.value = false
        error.value = '本地对话尚未保存，已保留窗口。请重试保存或再次退出。'
      }
      return saved
    }).finally(() => {
      if (timeout)
        clearTimeout(timeout)
      shutdownPromise = undefined
    })
    return shutdownPromise
  }

  onScopeDispose(() => {
    disposed = true
    activeRequestId.value = undefined
    unsubscribe()
    turnListeners.clear()
  })

  return { record, messages, ready, restoring, writing, activeRequestId, streamText, error, notice, unsaved, shuttingDown, busy, restore, recover, send, cancel, clear, shutdown, onTurn, appendObservation, waitForSend: () => activeSend ?? Promise.resolve(true) }
}
