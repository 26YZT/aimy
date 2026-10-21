import type { ChatHistoryItem } from '../types/chat'
import type { ChatMemoryEligibility, ChatSessionRecord } from '../types/chat-session'
import type { MemorySourceRef } from '../types/memory'

/** The existing chat owner calls this port. Unconfigured applications do not enroll history. */
export interface MemorySessionPort {
  prepareInput: (record: ChatSessionRecord, messageId: string) => Promise<{ eligibility: ChatMemoryEligibility, source?: MemorySourceRef } | null>
  beforeHistoryChange: () => void
  reconcileSources: (previous: ChatSessionRecord, next: ChatHistoryItem[]) => Promise<MemorySourceRef[]>
  completeHistoryChange: (sessionId: string) => Promise<void>
  drainJournal: (sessionId: string) => Promise<void>
  removeSessionSources: (record: ChatSessionRecord) => Promise<void>
}

let port: MemorySessionPort | undefined

export function configureMemorySessionPort(value: MemorySessionPort | undefined) {
  port = value
}

export function getMemorySessionPort() {
  return port
}

/** Stable source fingerprint. Raw text is neither logged nor copied to the memory database. */
export async function memoryContentHash(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
