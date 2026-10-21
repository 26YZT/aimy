import type { ContextMessage, Conversation } from '@proj-airi/core-agent'

/** A desktop capture owner supplies text only. No frame or credential enters this projection. */
export interface ScreenContextRead {
  text: string
  /** A capture generation changes on stop, source, identity, or provider changes. */
  revision: string
  available: boolean
}

type ScreenContextReader = (sessionId?: string) => ScreenContextRead

export const SCREEN_CONTEXT_SOURCE = 'system:aimy-screen-sharing'
let reader: ScreenContextReader | undefined

/** Only the main Stage installs a reader. Disposing it removes its private context without resetting other modules. */
export function installScreenContextReader(next: ScreenContextReader) {
  if (reader)
    throw new Error('Screen context already has an owner')
  reader = next
  return () => {
    if (reader === next) {
      reader = undefined
    }
  }
}

/** Removes legacy screen publications before the existing chat runtime takes a context snapshot. */
export function filterScreenContextSnapshot(snapshot: Record<string, ContextMessage[]>) {
  if (!reader)
    return snapshot
  const filtered: Record<string, ContextMessage[]> = {}
  for (const [source, messages] of Object.entries(snapshot)) {
    const kept = messages.filter((message) => {
      const screen = message.contextId?.startsWith('vision:screen:') || message.contextId === SCREEN_CONTEXT_SOURCE
      return !screen
    })
    if (kept.length)
      filtered[source] = kept
  }
  return filtered
}

/** Rechecks screen evidence after asynchronous attachment processing and before the provider receives a request. */
export function projectScreenConversation(context: Conversation, sessionId?: string) {
  const ownedReader = reader
  if (!ownedReader)
    return { context, assertCurrent: () => {} }
  const current = ownedReader(sessionId)
  const projected = structuredClone(context)
  for (const turn of projected.turns) {
    if (turn.type !== 'user')
      continue
    turn.content = turn.content.flatMap<typeof turn.content[number]>((part) => {
      if (part.type !== 'runtime-context')
        return [part]
      const entries = part.entries.filter(entry => entry.source !== SCREEN_CONTEXT_SOURCE)
      return entries.length ? [{ ...part, entries }] : []
    })
  }
  const lastUser = projected.turns.findLast(turn => turn.type === 'user')
  if (lastUser?.type === 'user')
    lastUser.content.push({ type: 'runtime-context', entries: [{ source: SCREEN_CONTEXT_SOURCE, text: current.text }] })
  return {
    context: projected,
    assertCurrent() {
      if (!current.available)
        return
      const next = reader === ownedReader ? ownedReader(sessionId) : undefined
      if (!next?.available || next.revision !== current.revision)
        throw new DOMException('Screen sharing changed', 'AbortError')
    },
  }
}
