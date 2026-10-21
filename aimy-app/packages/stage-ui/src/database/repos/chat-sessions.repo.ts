import type { ChatSessionRecord, ChatSessionsIndex } from '../../types/chat-session'
import type { MemorySourceRef } from '../../types/memory'

import { storage, updateRawLocal, updateRawLocalMany } from '../storage'

const tombstoneKey = (userId: string) => `local:chat/tombstones/${userId}`
const outboxKey = (userId: string) => `local:chat/outbox/${userId}`

/**
 * Pending cloud send. Persisted in IDB so a tab close / reload / offline
 * window does not drop messages the user has already typed locally.
 *
 * `cloudChatId` is captured snapshot-style at enqueue time when known;
 * when absent (session not yet reconciled), drain looks it up from the
 * live `sessionMetas` ref and skips the entry until the mapping lands.
 */
export interface ChatSendOutboxEntry {
  /** Stable id matching the local message; reused on every retry so the server can dedup. */
  messageId: string
  sessionId: string
  cloudChatId?: string
  role: 'user' | 'assistant'
  content: string
  replyToMessageId?: string
  attempts: number
  lastError?: string
  queuedAt: number
}

export const chatSessionsRepo = {
  async getIndex(userId: string) {
    const key = `local:chat/index/${userId}`
    return await storage.getItemRaw<ChatSessionsIndex>(key)
  },

  async saveIndex(index: ChatSessionsIndex) {
    const key = `local:chat/index/${index.userId}`
    await storage.setItemRaw(key, index)
  },

  async getSession(sessionId: string) {
    const key = `local:chat/sessions/${sessionId}`
    return await storage.getItemRaw<ChatSessionRecord>(key)
  },

  async saveSession(sessionId: string, record: ChatSessionRecord) {
    const key = `local:chat/sessions/${sessionId}`
    await updateRawLocal<ChatSessionRecord>(key, current => ({
      meta: record.meta,
      messages: record.messages,
      ...(current?.memoryJournal ? { memoryJournal: current.memoryJournal } : {}),
      ...(current?.memoryEligibility ? { memoryEligibility: current.memoryEligibility } : {}),
    }))
  },

  /** A user input and its eligibility marker become discoverable in the same transaction. */
  async commitSessionSnapshotAndIndex(sessionId: string, record: ChatSessionRecord, index: ChatSessionsIndex, sources: MemorySourceRef[] = []) {
    if (record.meta.sessionId !== sessionId || record.meta.userId !== index.userId
      || !index.characters[record.meta.characterId]?.sessions[sessionId]) {
      throw new Error('A chat snapshot requires its owning index entry.')
    }
    await updateRawLocalMany([`local:chat/sessions/${sessionId}`, `local:chat/index/${index.userId}`], ([value]) => {
      const previous = value as ChatSessionRecord | undefined
      const memoryJournal = [...(previous?.memoryJournal ?? [])]
      const memoryEligibility = [...(previous?.memoryEligibility ?? [])]
      for (const input of record.memoryEligibility ?? []) {
        if (!memoryEligibility.some(existing => existing.messageId === input.messageId))
          memoryEligibility.push(input)
      }
      for (const source of sources) {
        if (source.kind !== 'chat-message' || source.sessionId !== sessionId
          || source.principalId !== record.meta.userId || source.characterId !== record.meta.characterId) {
          throw new Error('A memory source must belong to the committed chat.')
        }
        const existing = memoryJournal.find(entry => entry.source.sourceId === source.sourceId && entry.source.sourceRevision === source.sourceRevision)
        if (existing && JSON.stringify(existing.source) !== JSON.stringify(source))
          throw new Error('A journal version cannot be replaced with different evidence.')
        if (!existing)
          memoryJournal.push({ source, acknowledged: false })
      }
      return [{
        meta: record.meta,
        messages: record.messages,
        ...(memoryJournal.length ? { memoryJournal } : {}),
        ...(memoryEligibility.length ? { memoryEligibility } : {}),
      }, index]
    })
  },

  /** An acknowledgment changes no chat text and cannot recreate a deleted session. */
  async acknowledgeMemorySource(sessionId: string, source: MemorySourceRef) {
    await updateRawLocalMany([`local:chat/sessions/${sessionId}`], ([value]) => {
      const record = value as ChatSessionRecord | undefined
      if (!record)
        return [undefined]
      for (const entry of record.memoryJournal ?? []) {
        if (entry.source.sourceId === source.sourceId && entry.source.sourceRevision === source.sourceRevision
          && entry.source.contentHash === source.contentHash) {
          entry.acknowledged = true
        }
      }
      return [record]
    })
  },

  // Cleanup
  async deleteSession(sessionId: string) {
    await storage.removeItem(`local:chat/sessions/${sessionId}`)
  },

  /**
   * Cloud-delete tombstones. When a user deletes a session offline (or before
   * the fire-and-forget DELETE response arrives) the cloud row may still be
   * present on the server's next `listChats`. Without these tombstones the
   * reconcile `adopt` branch would re-import the row and the deleted session
   * would visibly reappear.
   *
   * Stored as a flat array of `cloudChatId`s per user, keyed independently of
   * the index so the data survives index rewrites.
   */
  async getTombstones(userId: string): Promise<string[]> {
    const stored = await storage.getItemRaw<string[]>(tombstoneKey(userId))
    return stored ?? []
  },

  async addTombstone(userId: string, cloudChatId: string) {
    const current = await this.getTombstones(userId)
    if (current.includes(cloudChatId))
      return
    current.push(cloudChatId)
    await storage.setItemRaw(tombstoneKey(userId), current)
  },

  async removeTombstones(userId: string, cloudChatIds: string[]) {
    if (cloudChatIds.length === 0)
      return
    const current = await this.getTombstones(userId)
    const drop = new Set(cloudChatIds)
    const next = current.filter(id => !drop.has(id))
    if (next.length === current.length)
      return
    await storage.setItemRaw(tombstoneKey(userId), next)
  },

  /**
   * Outbox of message sends pending cloud delivery. Drained on every
   * reconcile + WS-open. Survives tab close / reload — the whole point
   * of the outbox is to never lose a write that landed locally but
   * never made it to the server.
   */
  async getOutbox(userId: string): Promise<ChatSendOutboxEntry[]> {
    const stored = await storage.getItemRaw<ChatSendOutboxEntry[]>(outboxKey(userId))
    return stored ?? []
  },

  async enqueueOutbox(userId: string, entry: ChatSendOutboxEntry) {
    const current = await this.getOutbox(userId)
    // Idempotent on messageId — re-queue overwrites in place rather than
    // duplicating, so a flap between online/offline doesn't multiply rows.
    const existingIndex = current.findIndex(e => e.messageId === entry.messageId)
    if (existingIndex >= 0)
      current[existingIndex] = entry
    else
      current.push(entry)
    await storage.setItemRaw(outboxKey(userId), current)
  },

  async dequeueOutbox(userId: string, messageIds: string[]) {
    if (messageIds.length === 0)
      return
    const current = await this.getOutbox(userId)
    const drop = new Set(messageIds)
    const next = current.filter(e => !drop.has(e.messageId))
    if (next.length === current.length)
      return
    await storage.setItemRaw(outboxKey(userId), next)
  },

  async updateOutboxEntries(userId: string, updates: Array<Pick<ChatSendOutboxEntry, 'messageId' | 'attempts' | 'lastError'>>) {
    if (updates.length === 0)
      return
    const current = await this.getOutbox(userId)
    const byId = new Map(updates.map(u => [u.messageId, u]))
    let changed = false
    const next = current.map((entry) => {
      const update = byId.get(entry.messageId)
      if (!update)
        return entry
      changed = true
      return { ...entry, attempts: update.attempts, lastError: update.lastError }
    })
    if (changed)
      await storage.setItemRaw(outboxKey(userId), next)
  },

  /** Remove every outbox entry for a session. Called when the session is deleted locally. */
  async dropOutboxForSession(userId: string, sessionId: string) {
    const current = await this.getOutbox(userId)
    const next = current.filter(e => e.sessionId !== sessionId)
    if (next.length === current.length)
      return
    await storage.setItemRaw(outboxKey(userId), next)
  },

  async clear(userId: string) {
    const index = await this.getIndex(userId)
    if (index) {
      for (const charIndex of Object.values(index.characters)) {
        for (const sessionId of Object.keys(charIndex.sessions)) {
          await this.deleteSession(sessionId)
        }
      }
      await storage.removeItem(`local:chat/index/${userId}`)
    }
    await storage.removeItem(tombstoneKey(userId))
    await storage.removeItem(outboxKey(userId))
  },
}
