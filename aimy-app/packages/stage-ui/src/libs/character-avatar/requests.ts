import type { CharacterAvatarCancellation, CharacterAvatarUpdate } from './index'

import { CharacterAvatarError } from './index'

/** Avatar save intents expire even if a renderer or decoder never completes. */
export const AVATAR_REQUEST_LIFETIME_MS = 120_000
const MAX_REQUESTS = 128
const CLOCK_SKEW_MS = 5_000
interface RequestEntry extends CharacterAvatarCancellation {
  expiresAt: number
  state: 'pending' | 'cancelled' | 'complete'
  controller?: AbortController
  timer?: ReturnType<typeof setTimeout>
}

/** Owns bounded save permits and pre-arrival cancellation tombstones in the elected card owner only. */
export class CharacterAvatarRequests {
  private readonly entries = new Map<string, RequestEntry>()
  private blockedUntil = 0
  private disposed = false

  constructor(private readonly now: () => number = Date.now) {}

  private prune(now: number) {
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.cancelEntry(entry)
        this.entries.delete(id)
      }
    }
  }

  /** A missing token preserves the existing direct-call API. Tokenized commands cannot be replayed. */
  begin(input: CharacterAvatarUpdate) {
    if (this.disposed)
      throw new CharacterAvatarError('changed')
    if (input.requestId === undefined)
      return undefined
    const now = this.now()
    this.prune(now)
    if (input.requestedAt === undefined || input.requestedAt > now + CLOCK_SKEW_MS
      || input.requestedAt + AVATAR_REQUEST_LIFETIME_MS <= now || now < this.blockedUntil
      || this.entries.has(input.requestId) || this.entries.size >= MAX_REQUESTS) {
      throw new CharacterAvatarError('changed')
    }
    const entry: RequestEntry = {
      requestId: input.requestId,
      requestedAt: input.requestedAt,
      ownerId: input.ownerId,
      expiresAt: input.requestedAt + AVATAR_REQUEST_LIFETIME_MS,
      state: 'pending',
      controller: new AbortController(),
    }
    this.entries.set(entry.requestId, entry)
    entry.timer = setTimeout(() => this.cancelEntry(entry), entry.expiresAt - now)
    return {
      signal: entry.controller!.signal,
      current: () => !this.disposed && this.entries.get(entry.requestId) === entry
        && entry.state === 'pending' && this.now() < entry.expiresAt,
      complete: () => {
        clearTimeout(entry.timer)
        entry.controller = undefined
        entry.state = 'complete'
      },
      cancel: () => {
        if (this.entries.get(entry.requestId) === entry && entry.state === 'pending')
          this.cancelEntry(entry)
      },
    }
  }

  /** Cancellation can arrive before a save. Completed saves never roll back. Old tokens cannot cancel replacement intents. */
  cancel(input: CharacterAvatarCancellation): boolean {
    if (this.disposed)
      return false
    const now = this.now()
    this.prune(now)
    const expiresAt = input.requestedAt + AVATAR_REQUEST_LIFETIME_MS
    if (input.requestedAt > now + CLOCK_SKEW_MS)
      throw new CharacterAvatarError('changed')
    if (expiresAt <= now)
      return false
    const entry = this.entries.get(input.requestId)
    if (entry) {
      if (entry.ownerId !== input.ownerId || entry.requestedAt !== input.requestedAt || entry.state === 'complete')
        return false
      this.cancelEntry(entry)
      return true
    }
    if (this.entries.size >= MAX_REQUESTS) {
      // If a tombstone cannot fit, reject new starts until this missing tombstone expires.
      // Dropping it without this barrier could revive the cancelled intent after another entry expires.
      this.blockedUntil = Math.max(this.blockedUntil, expiresAt)
      return true
    }
    this.entries.set(input.requestId, { ...input, expiresAt, state: 'cancelled' })
    return true
  }

  private cancelEntry(entry: RequestEntry): void {
    if (entry.state !== 'pending')
      return
    entry.state = 'cancelled'
    clearTimeout(entry.timer)
    entry.controller?.abort(new CharacterAvatarError('changed'))
    entry.controller = undefined
  }

  cancelPending(): void {
    for (const entry of this.entries.values())
      this.cancelEntry(entry)
  }

  dispose(): void {
    this.disposed = true
    this.cancelPending()
    this.entries.clear()
  }
}
